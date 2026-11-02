// 转成 PDF 的后台线程（pdf-lib）：
// - 图片拼成 PDF：一张图一页。JPEG 原样嵌入（不重新压缩），PNG 无损；按 EXIF 方向摆正（照片的像素常常是横着存的），按纸张、方向、边距等比缩放后居中
// - op: 'titles'：修正打印出来的书签标题（见 fixTitles）
import { PDFDocument, PDFName, PDFDict, PDFRef, PDFString, PDFHexString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from '../vendor/pdf-lib/pdf-lib.esm.min.js';

const MM = 72 / 25.4;
const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGIN = { none: 0, narrow: 10 * MM, wide: 20 * MM };
const MAX_PT = 14400;                      // PDF 页面最大 200 英寸

// 把按存储方向的图片放进 (x, y, w, h) 这个框，同时按 EXIF 方向（1–8）转正 / 翻转：返回 cm 矩阵。
// 图片空间里 (0,1) 是存储的左上角；方向 5–8 时 w、h 是转过之后看到的宽高
function placement(o, x, y, w, h) {
  switch (o) {
    case 2: return [-w, 0, 0, h, x + w, y];            // 左右镜像
    case 3: return [-w, 0, 0, -h, x + w, y + h];       // 转 180°
    case 4: return [w, 0, 0, -h, x, y + h];            // 上下镜像
    case 5: return [0, -h, -w, 0, x + w, y + h];       // 第 0 行在左、第 0 列在上
    case 6: return [0, -h, w, 0, x, y + h];            // 顺时针转 90°
    case 7: return [0, h, w, 0, x, y];                 // 第 0 行在右、第 0 列在下
    case 8: return [0, h, -w, 0, x + w, y];            // 逆时针转 90°
    default: return [w, 0, 0, h, x, y];
  }
}

// Chromium 按标题生成书签时，碰上标题被挤到下一页重新排版（标题带行高、上边距，后面跟一张放不下的大图之类），
// 书签标题会把字收两遍（「插图」变成「插图插图」）。headings 是网页里真正的标题：书签标题正好是某个标题重复几遍、本身又不是标题的，改回来。
// 都不用改就返回 null（不重新存）
const norm = s => s.replace(/\s+/g, ' ').trim();
async function fixTitles(bytes, headings) {
  const known = new Set(headings.map(norm));
  const fix = s => {
    if (known.has(norm(s))) return s;
    for (let k = 2; k <= 4; k++) {
      if (s.length % k) continue;
      const part = s.slice(0, s.length / k);
      if (part.repeat(k) === s && known.has(norm(part))) return part;
    }
    return s;
  };
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const N = n => PDFName.of(n), seen = new Set();
  let changed = 0;
  const walk = r => {
    while (r instanceof PDFRef && !seen.has(r.toString())) {
      seen.add(r.toString());
      const it = doc.context.lookup(r);
      if (!(it instanceof PDFDict)) return;
      const t = it.lookup(N('Title'));
      if (t instanceof PDFString || t instanceof PDFHexString) {
        const s = t.decodeText(), f = fix(s);
        if (f !== s) { it.set(N('Title'), PDFHexString.fromText(f)); changed++; }
      }
      walk(it.get(N('First')));
      r = it.get(N('Next'));
    }
  };
  const root = doc.catalog.lookup(N('Outlines'));
  if (root instanceof PDFDict) walk(root.get(N('First')));
  return changed ? doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }) : null;
}

self.onmessage = async ({ data }) => {
  if (data.op === 'titles') {
    try {
      const out = await fixTitles(data.bytes, data.headings);
      self.postMessage({ ok: true, bytes: out }, out ? [out.buffer] : []);
    } catch (e) { self.postMessage({ ok: false, error: String(e?.message || e) }); }
    return;
  }
  try {
    const { images, opts = {}, title = '' } = data;
    const doc = await PDFDocument.create();
    const margin = MARGIN[opts.margin] ?? MARGIN.narrow;
    for (const [i, im] of images.entries()) {
      const img = im.type === 'jpg' ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
      const turned = im.orient >= 5 && im.orient <= 8;
      const sw = turned ? img.height : img.width, sh = turned ? img.width : img.height;     // 看上去的宽高（像素）
      let pw, ph, w, h;                    // 页面大小、图片在页面上占的框（单位：点）
      if (opts.paper === 'fit') {
        // 跟图片一样大：按图片里记的分辨率换算（扫描件通常有；没有或低于 100 dpi 就按 96 dpi）。转过 90° 的图，横纵分辨率也跟着对调
        const dx = im.dpiX >= 100 ? im.dpiX : 96, dy = im.dpiY >= 100 ? im.dpiY : dx;
        w = sw * 72 / (turned ? dy : dx);
        h = sh * 72 / (turned ? dx : dy);
        const k = Math.min(1, (MAX_PT - 2 * margin) / Math.max(w, h));       // 超过 PDF 的页面上限就整体缩小
        w *= k; h *= k;
        pw = w + 2 * margin;
        ph = h + 2 * margin;
      } else {
        const [a, b] = PAPER[opts.paper] || PAPER.a4;
        const land = opts.orient === 'landscape' || (opts.orient !== 'portrait' && sw > sh);
        [pw, ph] = land ? [b, a] : [a, b];
        const s = Math.min(Math.max(1, pw - 2 * margin) / sw, Math.max(1, ph - 2 * margin) / sh);
        w = sw * s; h = sh * s;
      }
      const x = (pw - w) / 2, y = (ph - h) / 2;
      const page = doc.addPage([pw, ph]);
      const name = `Im${i}`;
      page.node.setXObject(PDFName.of(name), img.ref);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...placement(im.orient, x, y, w, h)), drawObject(name), popGraphicsState());
    }
    if (title) doc.setTitle(title);
    doc.setCreator('PDF 查看器');
    doc.setProducer('PDF 查看器（pdf-lib）');
    const out = await doc.save({ useObjectStreams: true });
    self.postMessage({ ok: true, bytes: out }, [out.buffer]);
  } catch (e) {
    self.postMessage({ ok: false, error: String(e?.message || e) });
  }
};
