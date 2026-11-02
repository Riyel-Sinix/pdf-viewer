// 转成 PDF：图片、Office 文档、文本 / Markdown / 表格、网页 → PDF。转好的由 main.js 开成新标签页（还没保存），或者加进合并列表。
// - 图片：后台线程里用 pdf-lib 拼（convert-worker.js），JPEG、PNG 原样嵌入；别的格式先在画布上解码；TIFF、HEIC 由桌面版用 Windows 的 WIC 解码
// - Office 文档（桌面版）：交给本机装的 Microsoft Office / WPS / LibreOffice，后台隐藏运行（src-tauri/src/office.ps1）
// - 文本、Markdown、CSV、网页（桌面版）：拼成网页，在看不见、不跑脚本的 WebView2 窗口里打印成 PDF——标题变成书签，页脚有页码
import { esc } from './util.js';
import { icon } from './icons.js';
import { prefs, savePrefs } from './store.js';
import * as platform from './platform.js';
import { openDialog, closeDialog, dlgHead } from './ui.js';
import { pdfjsLib, DOC_OPTS, getMergeWorker } from './pdfjs.js';
import { loadPdf, destroyPdf, destPageIndex } from './reader.js';
import { postProcess } from './merge.js';
import { marked } from '../vendor/marked/marked.esm.js';

/* ---------- 认得哪些文件 ---------- */
const EXTS = {
  image: 'jpg jpeg jpe jfif png apng gif webp bmp dib avif ico svg',
  wic: 'tif tiff heic heif hif jxr wdp',
  word: 'doc docx docm dot dotx dotm rtf odt ott wps wpt',
  excel: 'xls xlsx xlsm xlsb xlt xltx xltm ods ots et ett',
  powerpoint: 'ppt pptx pptm pps ppsx ppsm pot potx potm odp otp dps dpt',
  markdown: 'md markdown mdown mkd',
  table: 'csv tsv',
  html: 'html htm xhtml mht mhtml',
  text: 'txt text log nfo json jsonc json5 xml yaml yml toml ini cfg conf properties env srt vtt tex bib diff patch '
    + 'js mjs cjs jsx ts tsx vue svelte py pyw c h cpp cc cxx hpp hh hxx cs java kt kts go rs rb php swift m mm lua r pl dart scala groovy gradle '
    + 'sh bash zsh fish ps1 psm1 bat cmd sql css scss sass less',
};
const KIND = new Map(Object.entries(EXTS).flatMap(([k, v]) => v.split(' ').map(e => [e, k])));
const exts = (...kinds) => kinds.flatMap(k => EXTS[k].split(' '));
const PROSE = new Set(['txt', 'text', 'nfo', 'srt', 'vtt']);          // 这些按正文排，别的文本按代码（等宽）排
const LABEL = { image: '图片', wic: '图片', word: 'Word 文档', excel: 'Excel 表格', powerpoint: '演示文稿', markdown: 'Markdown', table: '表格', html: '网页', text: '文本' };
const KIND_ICON = { image: 'image', wic: 'image', word: 'text', excel: 'layoutGrid', powerpoint: 'present', markdown: 'text', table: 'layoutGrid', html: 'open', text: 'text' };
const isImageKind = k => k === 'image' || k === 'wic';

export const extOf = name => (/\.([^.\\/]+)$/.exec(name || '')?.[1] || '').toLowerCase();
const baseName = name => String(name || '').replace(/\.[^.\\/]+$/, '') || '未命名';
// 网页版只能转图片（别的要靠本机的 Office、WebView2 打印、WIC）
export function convertKind(name) {
  const k = KIND.get(extOf(name));
  return k && (platform.isDesktop || k === 'image') ? k : null;
}
export const canConvert = name => !!convertKind(name);

// 文件选择框的筛选项；withPdf：PDF 也一起列出来（打开、合并用）
export function convertFilters({ withPdf = false } = {}) {
  const pdf = withPdf ? ['pdf'] : [];
  if (!platform.isDesktop) return [{ name: withPdf ? 'PDF 和图片' : '图片', extensions: [...pdf, ...exts('image')] }];
  const img = exts('image', 'wic'), office = exts('word', 'excel', 'powerpoint'), text = exts('markdown', 'table', 'html', 'text');
  return [
    { name: withPdf ? 'PDF 和能转成 PDF 的文件' : '能转成 PDF 的文件', extensions: [...pdf, ...img, ...office, ...text] },
    { name: '图片', extensions: img },
    { name: 'Office 文档（Word、Excel、PPT、WPS）', extensions: office },
    { name: '文本、Markdown、表格、网页', extensions: text },
  ];
}

/* ---------- 图片 ---------- */
// JPEG：读出尺寸、EXIF 方向、分辨率（JFIF 或 EXIF 里的）；ok 表示 PDF 阅读器都认得这种编码（8 位、基线 / 扩展 / 渐进式）
function jpegInfo(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  const r = { w: 0, h: 0, orient: 1, dpiX: 0, dpiY: 0, ok: false };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += m === 0xFF ? 1 : 2; continue; }
    if (m === 0xD9 || m === 0xDA) break;                       // 图像数据开始了：后面没有要看的了
    const len = (b[i + 2] << 8) | b[i + 3], s = i + 4;
    if (m === 0xE0 && b[s] === 0x4A && b[s + 1] === 0x46 && b[s + 2] === 0x49 && b[s + 3] === 0x46 && b[s + 4] === 0) {    // JFIF
      const unit = b[s + 7], x = (b[s + 8] << 8) | b[s + 9], y = (b[s + 10] << 8) | b[s + 11];
      if (unit === 1) { r.dpiX = x; r.dpiY = y; } else if (unit === 2) { r.dpiX = x * 2.54; r.dpiY = y * 2.54; }
    } else if (m === 0xE1 && b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66 && b[s + 4] === 0) {   // Exif
      exif(b, s + 6, Math.min(b.length, s + len - 2), r);
    } else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {           // SOFn
      r.h = (b[s + 1] << 8) | b[s + 2];
      r.w = (b[s + 3] << 8) | b[s + 4];
      r.ok = b[s] === 8 && m <= 0xC2;
    }
    i = s + len - 2;
  }
  return r.w && r.h ? r : null;
}
// EXIF 的 IFD0：方向（0x0112）、分辨率（0x011A / 0x011B，单位 0x0128：2 = 英寸，3 = 厘米）
function exif(b, t, end, r) {
  const le = b[t] === 0x49;
  const u16 = o => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = o => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return;
  const rat = e => { const o = t + u32(e + 8); return o + 8 <= end && u32(o + 4) ? u32(o) / u32(o + 4) : 0; };
  let xr = 0, yr = 0, unit = 2;
  for (let k = 0, n = u16(ifd); k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    const tag = u16(e);
    if (tag === 0x0112) { const v = u16(e + 8); if (v >= 1 && v <= 8) r.orient = v; }
    else if (tag === 0x011A) xr = rat(e);
    else if (tag === 0x011B) yr = rat(e);
    else if (tag === 0x0128) unit = u16(e + 8);
  }
  if (!r.dpiX && xr) { const k = unit === 3 ? 2.54 : 1; r.dpiX = xr * k; r.dpiY = (yr || xr) * k; }
}
// PNG：尺寸、分辨率（pHYs，单位是每米多少像素）
function pngInfo(b) {
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) || b.length < 33) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), r = { w: dv.getUint32(16), h: dv.getUint32(20), dpiX: 0, dpiY: 0 };
  for (let i = 8; i + 12 <= b.length;) {
    const len = dv.getUint32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === 'pHYs' && len >= 9 && b[i + 16] === 1) { r.dpiX = dv.getUint32(i + 8) * 0.0254; r.dpiY = dv.getUint32(i + 12) * 0.0254; }
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + len;
  }
  return r;
}
const MIME = { svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', dib: 'image/bmp', ico: 'image/x-icon', png: 'image/png', apng: 'image/apng' };
const LOSSLESS = new Set(['gif', 'bmp', 'dib', 'ico', 'svg', 'png', 'apng']);
// 别的格式（WebP、GIF、BMP、AVIF、ICO、SVG）：画到画布上再存成 PNG（有透明、或者本来就是无损的）或 JPEG（照片）
async function rasterize(bytes, name) {
  const ext = extOf(name), blob = new Blob([bytes], { type: MIME[ext] || '' });
  const c = document.createElement('canvas');
  if (ext === 'svg') {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const iw = img.naturalWidth || 800, ih = img.naturalHeight || 600, k = Math.max(1, 3000 / Math.max(iw, ih));     // 矢量图按长边 3000 像素画
      c.width = Math.round(iw * k);
      c.height = Math.round(ih * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    } finally { URL.revokeObjectURL(url); }
  } else {
    const bmp = await createImageBitmap(blob);           // 默认按 EXIF 方向转正
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
  }
  const png = LOSSLESS.has(ext) || hasAlpha(c);
  const out = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92));
  if (!out) throw new Error('图片太大了，画不出来');
  return { type: png ? 'png' : 'jpg', bytes: new Uint8Array(await out.arrayBuffer()), orient: 1, dpiX: 0, dpiY: 0 };
}
function hasAlpha(c) {
  const k = Math.min(1, 256 / Math.max(c.width, c.height)), s = document.createElement('canvas');
  s.width = Math.max(1, Math.round(c.width * k));
  s.height = Math.max(1, Math.round(c.height * k));
  const x = s.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, s.width, s.height);
  const d = x.getImageData(0, 0, s.width, s.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}
// WIC 解出来的帧（格式见 src-tauri/src/convert.rs 的 decode_image）
function wicFrames(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  for (let i = 0, n = dv.getUint32(0, true), o = 4; i < n; i++) {
    const jpeg = dv.getUint32(o, true), len = dv.getUint32(o + 28, true);
    out.push({ type: jpeg ? 'jpg' : 'png', bytes: b.slice(o + 32, o + 32 + len), orient: 1, dpiX: dv.getFloat64(o + 12, true), dpiY: dv.getFloat64(o + 20, true) });
    o += 32 + len;
  }
  if (!out.length) throw new Error('这个文件里没有图片');
  return out;
}
async function imageSources(entry, kind) {
  if (kind === 'wic') {
    if (!entry.path) throw new Error('只有桌面版能转这种图片');
    return wicFrames(await platform.decodeImage(entry.path));
  }
  const bytes = await entry.read();
  const j = jpegInfo(bytes);
  if (j?.ok) return [{ type: 'jpg', bytes, orient: j.orient, dpiX: j.dpiX, dpiY: j.dpiY }];
  const p = !j && pngInfo(bytes);
  if (p) return [{ type: 'png', bytes, orient: 1, dpiX: p.dpiX, dpiY: p.dpiY }];
  return [await rasterize(bytes, entry.name)];
}
// 在后台线程（convert-worker.js）里跑一趟，用完就关
function inWorker(msg, transfer) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' });
    const done = () => w.terminate();
    w.onmessage = ({ data }) => { done(); data.ok ? resolve(data.bytes) : reject(new Error(data.error)); };
    w.onerror = e => { done(); reject(new Error(e.message || '后台线程出错')); };
    w.postMessage(msg, transfer);
  });
}
function imagesToPdf(images, opts, title) {
  const send = images.map(im => ({ ...im, bytes: im.bytes.slice() }));       // 复制一份再转移：原数据可能还要用（合成一份时）
  return inWorker({ images: send, opts: { paper: opts.paper, orient: opts.orient, margin: opts.margin }, title }, send.map(im => im.bytes.buffer));
}

/* ---------- 文本、Markdown、表格、网页：拼成网页再打印 ---------- */
function decodeText(b) {
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder().decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch {}
  return new TextDecoder('gb18030').decode(b);          // 不是 UTF-8 的中文文本，多半是 GBK
}
// 源文件所在的文件夹（file:// 网址）：Markdown 里用相对路径引用的图片要靠它找到
function dirUrl(path) {
  const dir = platform.dirname(path).replace(/\\/g, '/');
  if (!dir) return '';
  const unc = dir.startsWith('//'), segs = (unc ? dir.slice(2) : dir).split('/');
  return (unc ? 'file://' : 'file:///') + segs.map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/') + '/';
}
// Markdown 里可以夹 HTML：脚本、框架、表单之类的去掉（打印窗口本来就不跑脚本，这里再保险一点）
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,meta,base,link,form,noscript').forEach(el => el.remove());
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}
function sniffSep(text) {
  const line = text.slice(0, (text.indexOf('\n') + 1 || text.length + 1) - 1);
  const n = c => line.split(c).length - 1, best = [',', ';', '\t'].map(c => [c, n(c)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ',';
}
// CSV：引号里可以有分隔符、换行，两个引号表示一个引号
function parseCsv(text, sep) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  return rows;
}
function tableHtml(rows) {
  const cols = Math.max(1, ...rows.map(r => r.length)), num = /^\s*[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?\s*$/;
  const cells = (r, tag) => Array.from({ length: cols }, (_, i) => { const v = r[i] ?? ''; return `<${tag}${num.test(v) ? ' class="n"' : ''}>${esc(v).replace(/\r?\n/g, '<br>')}</${tag}>`; }).join('');
  const [head = [], ...body] = rows;
  return `<table class="csv"><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`;
}
const SANS = '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const MONO = '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace';
const BASE_CSS = `
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #22201d; font: 10.5pt/1.7 ${SANS}; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
pre.txt { font: inherit; }
pre.code { font: 9pt/1.55 ${MONO}; tab-size: 4; }`;
const MD_CSS = `
.md > :first-child { margin-top: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 1.3em 0 .55em; line-height: 1.3; font-weight: 600; break-after: avoid; }
.md h1 { font-size: 1.9em; padding-bottom: .25em; border-bottom: 1px solid #ddd5c8; }
.md h2 { font-size: 1.45em; padding-bottom: .2em; border-bottom: 1px solid #e8e1d6; }
.md h3 { font-size: 1.2em; } .md h4 { font-size: 1.05em; } .md h5, .md h6 { font-size: 1em; color: #5c554d; }
.md p, .md ul, .md ol, .md dl, .md table, .md pre, .md blockquote { margin: 0 0 .85em; }
.md ul, .md ol { padding-left: 1.8em; } .md li + li { margin-top: .2em; } .md li > ul, .md li > ol { margin: .2em 0 0; }
.md li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.3em; }
.md input[type=checkbox] { margin: 0 .45em 0 0; vertical-align: -.1em; }
.md code { font: .88em ${MONO}; background: #f3eee6; padding: .12em .36em; border-radius: 4px; }
.md pre { background: #f6f2ea; border: 1px solid #e8e1d6; border-radius: 6px; padding: .75em 1em; font: 9pt/1.55 ${MONO}; }
.md pre code { background: none; padding: 0; font: inherit; }
.md blockquote { margin-left: 0; padding: .1em 1em; border-left: 4px solid #d9c9ad; color: #5c554d; }
.md table { border-collapse: collapse; }
.md th, .md td { border: 1px solid #d8cfc1; padding: .32em .7em; }
.md th { background: #f3eee6; font-weight: 600; }
.md img { max-width: 100%; }
.md hr { border: 0; border-top: 1px solid #ddd5c8; margin: 1.4em 0; }
.md a { color: #2f5f86; text-decoration: none; }
.md img, .md tr { break-inside: avoid; }`;
const TABLE_CSS = `
table.csv { border-collapse: collapse; width: 100%; font-size: 8.5pt; line-height: 1.45; }
table.csv th, table.csv td { border: 1px solid #d8cfc1; padding: .25em .5em; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
table.csv th { background: #f3eee6; font-weight: 600; }
table.csv .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.csv thead { display: table-header-group; }
table.csv tr { break-inside: avoid; }`;
function pageHtml({ title, body, base = '', landscape = false, css = '' }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${base ? `<base href="${esc(base)}">` : ''}<title>${esc(title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 18mm 16mm;
  @bottom-center { content: counter(page) " / " counter(pages); font: 8.5pt ${SANS}; color: #8a8178; } }${BASE_CSS}${css}
</style></head><body>${body}</body></html>`;
}
// Page.printToPDF 的参数：页面大小、边距按网页里的 @page；按标题生成书签；带结构标签（读屏、复制更准）
const PRINT_DOC = { printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true, generateDocumentOutline: true };
const PRINT_WEB = { ...PRINT_DOC, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5 };
const MAX_TEXT = 16 * 1024 * 1024;

// 网页里的标题（书签就是按它们生成的）
const headingTexts = html => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('h1,h2,h3,h4,h5,h6')]
  .map(h => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
async function htmlHeadings(entry) {
  try {
    if (entry.size > MAX_TEXT) return [];
    const b = await entry.read();
    return b.length > MAX_TEXT ? [] : headingTexts(decodeText(b));
  } catch { return []; }
}
// 打印出来的书签标题有时会重复（「插图插图」，见 convert-worker.js 的 fixTitles）：照网页里的标题改回来。改不了就原样用
async function fixOutline(bytes, headings) {
  if (!headings.length) return bytes;
  try {
    const send = bytes.slice();
    return (await inWorker({ op: 'titles', bytes: send, headings }, [send.buffer])) || bytes;
  } catch (e) { console.warn(e); return bytes; }
}

async function textToPdf(entry, kind) {
  if (kind === 'html') {
    const pdf = await platform.printPdf({ path: entry.path, params: JSON.stringify(PRINT_WEB) });
    return fixOutline(pdf, await htmlHeadings(entry));
  }
  const bytes = await entry.read();
  if (bytes.length > MAX_TEXT) throw new Error('文件太大了（超过 16 MB）');
  const text = decodeText(bytes), ext = extOf(entry.name);
  let body, css = '', landscape = false;
  if (kind === 'markdown') {
    body = `<article class="md">${sanitize(marked.parse(text, { gfm: true, async: false }))}</article>`;
    css = MD_CSS;
  } else if (kind === 'table') {
    const rows = parseCsv(text, ext === 'tsv' ? '\t' : sniffSep(text));
    if (rows.length > 50000) throw new Error('表格太大了（超过 5 万行）');
    landscape = Math.max(0, ...rows.slice(0, 200).map(r => r.length)) > 6;
    body = tableHtml(rows);
    css = TABLE_CSS;
  } else {
    body = `<pre class="${PROSE.has(ext) ? 'txt' : 'code'}">${esc(text)}</pre>`;
  }
  const html = pageHtml({ title: entry.name, body, base: entry.path ? dirUrl(entry.path) : '', landscape, css });
  const pdf = await platform.printPdf({ html, params: JSON.stringify(PRINT_DOC) });
  return kind === 'markdown' ? fixOutline(pdf, headingTexts(body)) : pdf;
}

/* ---------- 一个文件 → PDF ---------- */
const OFFICE_ERR = {
  PASSWORD: '这份文档设了打开密码，转不了（先在 Office 里去掉密码再转）',
  TIMEOUT: '转换太久了（超过 4 分钟），已经停掉了',
  NOAPP: '没找到能打开它的软件：需要装 Microsoft Office、WPS 或 LibreOffice',
};
export const convertError = e => { const m = String(e?.message || e || '出错了'); return OFFICE_ERR[m] || m; };

async function convertOne(it, opts) {
  const { entry, kind } = it;
  if (isImageKind(kind)) return imagesToPdf(await imageSources(entry, kind), opts, baseName(entry.name));
  if (!platform.isDesktop || !entry.path) throw new Error('只有桌面版能转换这种文件');
  if (kind === 'word' || kind === 'excel' || kind === 'powerpoint') return platform.convertOffice(entry.path, kind);
  return textToPdf(entry, kind);
}

// 几份 PDF 拼成一份（pdf.js 的 extractPages，和合并 PDF 一样）；bookmarks：每份一个书签，原有的书签收在它下面
async function bind(parts, title, { bookmarks }) {
  const counts = [];
  for (const p of parts) {
    const d = await pdfjsLib.getDocument({ ...DOC_OPTS, data: p.bytes.slice(), worker: getMergeWorker() }).promise;
    counts.push(d.numPages);
    destroyPdf(d);
  }
  const { pdf: primary } = await loadPdf(parts[0].bytes.slice(), { name: title, worker: getMergeWorker() });
  let out;
  try { out = await primary.extractPages(parts.map((p, i) => ({ document: i === 0 ? null : p.bytes.slice() }))); } finally { destroyPdf(primary); }
  if (!out?.length) throw new Error('pdf.js 没能把它们拼起来');
  const groups = [];
  let start = 0;
  parts.forEach((p, i) => { groups.push({ title: p.title, start, count: counts[i], rotate: 0 }); start += counts[i]; });
  let topPages = null;
  if (bookmarks) {
    const chk = await pdfjsLib.getDocument({ ...DOC_OPTS, data: out.slice(), worker: getMergeWorker() }).promise;
    try {
      const ol = await chk.getOutline().catch(() => null);
      topPages = ol ? await Promise.all(ol.map(o => destPageIndex(chk, o.dest))) : [];
    } finally { destroyPdf(chk); }
  }
  return postProcess(out.slice(), { groups, topPages, bookmarks, title, total: start });
}

/* ---------- 对话框 ---------- */
function summarize(items) {
  const n = new Map();
  for (const it of items) n.set(LABEL[it.kind], (n.get(LABEL[it.kind]) || 0) + 1);
  return [...n].map(([label, c]) => `${c} ${label === '图片' ? '张' : '份'}${/^[A-Za-z]/.test(label) ? ' ' : ''}${label}`).join('、');
}
// 选项：纸张、方向、边距（有图片时）；要不要合成一份（不止一个文件时）。返回选好的设置，取消返回 null
function askOptions(items, opts) {
  const imgs = items.some(x => isImageKind(x.kind)), cur = { ...opts };
  const seg = (key, choices) => `<span class="seg" data-o="${key}">${choices.map(([v, label]) => `<button type="button" data-v="${v}"${cur[key] === v ? ' class="on"' : ''}>${label}</button>`).join('')}</span>`;
  return openDialog({
    cls: 'cvdlg',
    html: `${dlgHead('转成 PDF', { k: 'Of Changing Forms', sub: summarize(items) })}
      <div class="dlg-b" id="cvBody">
        <ol class="cvlist">${items.map(x => `<li><span class="ic">${icon(KIND_ICON[x.kind], 16)}</span><span class="nm" title="${esc(x.entry.path || x.entry.name)}">${esc(x.entry.name)}</span><span class="k">${LABEL[x.kind]}</span></li>`).join('')}</ol>
        ${imgs ? `<div class="cvopts">
          <div class="cvrow"><span class="lb">纸张</span>${seg('paper', [['a4', 'A4'], ['letter', 'Letter'], ['fit', '跟图片一样大']])}</div>
          <div class="cvrow" data-row="orient"${cur.paper === 'fit' ? ' hidden' : ''}><span class="lb">方向</span>${seg('orient', [['auto', '跟着图片'], ['portrait', '竖着'], ['landscape', '横着']])}</div>
          <div class="cvrow"><span class="lb">边距</span>${seg('margin', [['none', '没有'], ['narrow', '窄'], ['wide', '宽']])}</div>
          <div class="cvnote">图片按原样放进去（JPEG 不重新压缩），等比缩放、居中</div>
        </div>` : ''}
        ${items.length > 1 ? `<label class="chk cvcomb"><input type="checkbox" id="cvComb"${cur.combine ? ' checked' : ''}>合成一份 PDF（按上面的顺序；不勾就每个文件一份）</label>` : ''}
      </div>
      <div class="dlg-f"><button class="btn ghost" data-dlg="">取消</button><button class="btn" data-dlg="ok" autofocus>${icon('convert', 18)}转成 PDF</button></div>`,
    onOpen(d) {
      const body = d.querySelector('#cvBody');
      body.addEventListener('click', e => {
        const b = e.target.closest('.seg button');
        if (!b) return;
        const key = b.parentElement.dataset.o;
        cur[key] = b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        if (key === 'paper') body.querySelector('[data-row="orient"]').hidden = cur.paper === 'fit';
      });
      body.querySelector('#cvComb')?.addEventListener('change', e => { cur.combine = e.target.checked; });
    },
  }).then(v => {
    if (v !== 'ok') return null;
    Object.assign(prefs, { convPaper: cur.paper, convOrient: cur.orient, convMargin: cur.margin });
    savePrefs();
    return cur;
  });
}
// 进度：快的（一两张图片）一闪而过就不弹了
function progress(total) {
  let shown = false, text = '';
  const show = () => {
    shown = true;
    openDialog({
      dismissable: false,
      html: `${dlgHead('正在转成 PDF', { k: 'Of Changing Forms', sub: total > 1 ? `${total} 个文件` : '' })}<div class="dlg-b"><div class="prog ind"><i></i></div><div class="sub" id="cvStage" style="margin-top:8px">${esc(text)}</div></div>`,
    });
  };
  const timer = setTimeout(show, 300);
  const set = t => { text = t; const s = document.getElementById('cvStage'); if (shown && s) s.textContent = t; };
  const how = k => (k === 'word' || k === 'excel' || k === 'powerpoint' ? '用本机的 Office 转换' : k === 'html' ? '打印网页' : isImageKind(k) ? '放进图片' : '排版');
  return {
    step: (i, it) => set(`${total > 1 ? `第 ${i + 1} / ${total} 个：` : ''}${how(it.kind)}「${it.entry.name}」…`),
    stage: set,
    close() { clearTimeout(timer); if (shown) closeDialog(null); },
  };
}

/* ---------- 一批文件 → PDF ----------
 * entries：{ name, path, size, read() }。ask：有图片、或者不止一个文件时，先问纸张、边距、要不要合成一份；
 * combine：不问的时候要不要合成一份（加进合并列表时是 false）。文件按名字排序（见 byName）。
 * 返回 { results: [{ name, bytes, dir, sources, entry }], failed: [{ name, error }] }；在对话框里取消返回 null */
const collator = new Intl.Collator('zh-CN', { numeric: true });
const hanFirst = s => (/^[㐀-鿿豈-﫿]/.test(s) ? 1 : 0);
// 和资源管理器一样：数字、字母开头的在前，汉字开头的在后（按拼音）；数字按大小比（scan2 在 scan10 前面）
const byName = (a, b) => hanFirst(a) - hanFirst(b) || collator.compare(a, b);

export async function convertEntries(entries, { ask = true, combine = null } = {}) {
  const items = entries.map(entry => ({ entry, kind: convertKind(entry.name) })).filter(x => x.kind);
  items.sort((a, b) => byName(a.entry.name, b.entry.name));
  const results = [], failed = [];
  if (!items.length) return { results, failed };
  const allImages = items.every(x => isImageKind(x.kind));
  let opts = { paper: prefs.convPaper || 'a4', orient: prefs.convOrient || 'auto', margin: prefs.convMargin || 'narrow', combine: combine ?? allImages };
  if (ask && (items.some(x => isImageKind(x.kind)) || items.length > 1)) {
    opts = await askOptions(items, opts);
    if (!opts) return null;
  }
  const dirOf = en => (en.path ? platform.dirname(en.path) : '');
  const prog = progress(items.length);
  try {
    if (opts.combine && items.length > 1) {
      // 合成一份：连在一起的图片拼成一段，文档各自一段，最后装订起来（混着放的时候，每个文件一个书签）
      const base = baseName(items[0].entry.name), title = allImages ? `${base} 等 ${items.length} 张图片` : `${base} 等 ${items.length} 个文件`;
      const parts = [];
      let run = [];
      const flush = async () => {
        if (!run.length) return;
        const label = run.length > 1 ? `${run[0].name} 等 ${run.length} 张图片` : run[0].name;
        parts.push({ title: label, bytes: await imagesToPdf(run.flatMap(r => r.images), opts, title) });
        run = [];
      };
      for (const [i, it] of items.entries()) {
        prog.step(i, it);
        try {
          if (isImageKind(it.kind)) run.push({ name: it.entry.name, images: await imageSources(it.entry, it.kind) });
          else { await flush(); parts.push({ title: it.entry.name, bytes: await convertOne(it, opts) }); }
        } catch (e) { console.warn(e); failed.push({ name: it.entry.name, error: convertError(e) }); }
      }
      try { await flush(); } catch (e) { console.warn(e); failed.push({ name: '图片', error: convertError(e) }); }
      if (parts.length) {
        prog.stage('装订成一份…');
        const bytes = parts.length === 1 ? parts[0].bytes : await bind(parts, title, { bookmarks: !allImages });
        results.push({ name: `${title}.pdf`, bytes, dir: dirOf(items[0].entry), sources: items.map(x => x.entry.name), entry: items[0].entry });
      }
    } else {
      for (const [i, it] of items.entries()) {
        prog.step(i, it);
        try { results.push({ name: `${baseName(it.entry.name)}.pdf`, bytes: await convertOne(it, opts), dir: dirOf(it.entry), sources: [it.entry.name], entry: it.entry }); }
        catch (e) { console.warn(e); failed.push({ name: it.entry.name, error: convertError(e) }); }
      }
    }
  } finally { prog.close(); }
  return { results, failed };
}
