// 「转成 PDF」的桌面测试：窗口开在屏幕外（不抢焦点、不截桌面），通过 WebView2 的 DevTools 协议驱动
//   python -P tools/make-convert-tests.py      # 先生成测试文件（.cache/test/convert）
//   node tools/convert-smoke.mjs [exe 路径]
// 检查：把 Word / Excel / PPT（本机没装 Office、WPS 或 LibreOffice 就跳过这三项）、Markdown、GBK 文本、代码、CSV、网页、多页 TIFF
//       一个个拖进首页，各自转成一份「还没保存」的 PDF（页数、书签、文字、图片）；几个文件在对话框里勾上「合成一份」；
//       拖进合并页的先转换再加入（顺序不变）；加了密码的文档、认不得的文件给出提示；关掉刚转出来的文档会先问；
//       保存时默认存到源文件所在的文件夹（拦下「另存为」对话框，直接给一个路径，免得系统对话框跑到用户眼前）。
//       打印用的隐藏窗口用完就关，主窗口一直在屏幕外。截图存到 .cache/shots/convert-*.png
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const exe = process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'pdf-viewer.exe');
const CV = path.join(root, '.cache', 'test', 'convert');
const C = n => path.join(CV, n);
if (!fs.existsSync(C('报告.docx'))) { console.error('先运行 python -P tools/make-convert-tests.py 生成测试文件'); process.exit(2); }
const shots = path.join(root, '.cache', 'shots');
fs.mkdirSync(shots, { recursive: true });
const SAVE_TO = path.join(root, '.cache', 'out', '转换保存测试.pdf');
fs.mkdirSync(path.dirname(SAVE_TO), { recursive: true });
fs.rmSync(SAVE_TO, { force: true });
fs.writeFileSync(C('认不得.xyz'), 'not a document');
const PORT = 9336;
const testData = path.join(root, '.cache', 'wv2-convert');
fs.rmSync(testData, { recursive: true, force: true });
const env = { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1', PDFVIEWER_TEST_DATA: testData,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const app = spawn(exe, [], { env, stdio: 'ignore' });
let ws, seq = 0;
const pending = new Map(), logs = [];
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page' && /tauri\.localhost/.test(t.url)); } catch {}
  }
  if (!target) throw new Error('DevTools 端口没起来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    else if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
  };
  const send = (method, params = {}, ms = 30000) => new Promise((r, rej) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`DevTools 调用超时：${method}`)); }, ms);
    pending.set(id, m => { clearTimeout(t); r(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr, ms = 30000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ms);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const geo = [];
  const offscreenOk = async step => {
    const g = JSON.parse(await evaluate(`(async () => { const w = __TAURI__.window.getCurrentWindow(); const p = await w.outerPosition(); return JSON.stringify({ x: p.x, y: p.y, max: await w.isMaximized(), full: await w.isFullscreen(), focused: await w.isFocused() }); })()`));
    geo.push({ step, ...g });
    return g.x < -5000 && !g.max && !g.full;
  };
  const shot = async name => {
    if (!await offscreenOk(name)) throw new Error(`窗口跑到屏幕上了（${name}）`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(shots, name), Buffer.from(r.result.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  let placed = false;
  for (let i = 0; i < 20 && !placed; i++) { try { placed = await offscreenOk('刚启动'); break; } catch { await sleep(150); } }
  if (!placed) throw new Error('窗口不在屏幕外');
  for (let i = 0; i < 40; i++) { await sleep(250); if (await evaluate('!!window.__pv').catch(() => false)) break; }

  // 页面里的小工具：模拟拖放、等转换出来的标签页、读出一份 PDF 的页数 / 书签 / 文字 / 图片
  await evaluate(`(async () => {
    const { pdfjsLib } = await import('./js/pdfjs.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    window.__cv = {
      sleep,
      drop: paths => __TAURI__.event.emit('tauri://drag-drop', { paths, position: { x: 300, y: 300 } }),
      toasts: () => [...document.querySelectorAll('.toast .tx')].map(x => x.textContent),
      // 拖进来以后等：出现转换选项就点「转成 PDF」（comb：顺便勾上 / 去掉「合成一份」）；直到多出 n 个加载好的标签页，或者出现新的出错提示
      async dropAndWait(paths, n = 1, { comb = null, ms = 150000 } = {}) {
        __pv.activate('home');
        const before = __pv.state.tabs.length, errs = document.querySelectorAll('.toast.err').length, t0 = Date.now();
        let dialog = null;
        await this.drop(paths);
        while (Date.now() - t0 < ms) {
          await sleep(200);
          const d = document.querySelector('#dlg.cvdlg[open]');
          if (d && !dialog) {
            dialog = { items: [...d.querySelectorAll('.cvlist .nm')].map(x => x.textContent), comb: d.querySelector('#cvComb')?.checked ?? null };
            const box = d.querySelector('#cvComb');
            if (box && comb !== null && box.checked !== comb) box.click();
            d.querySelector('[data-dlg="ok"]').click();
          }
          const tabs = __pv.state.tabs;
          if (tabs.length >= before + n && tabs.slice(before).every(t => !t.loading)) return { tabs: tabs.slice(before), dialog };
          if (document.querySelectorAll('.toast.err').length > errs && !document.querySelector('#dlg[open]')) return { tabs: tabs.slice(before), dialog, errors: [...document.querySelectorAll('.toast.err .tx')].slice(errs).map(x => x.textContent) };
        }
        return { tabs: __pv.state.tabs.slice(before), dialog, timeout: true };
      },
      async info(t) {
        const pdf = t.pdf, outline = [];
        const walk = (items, d) => { for (const o of items || []) { outline.push('  '.repeat(d) + o.title); walk(o.items, d + 1); } };
        walk(await pdf.getOutline().catch(() => null), 0);
        let text = '', images = 0;
        for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
          const pg = await pdf.getPage(p);
          text += (await pg.getTextContent()).items.map(i => i.str).join('') + '\\n';
          images += (await pg.getOperatorList()).fnArray.filter(f => f === pdfjsLib.OPS.paintImageXObject).length;
        }
        const v = (await pdf.getPage(1)).getViewport({ scale: 1 });
        return { name: t.name, pages: pdf.numPages, dirty: __pv.isDirty(t), dir: t.converted?.dir ?? null, outline, images, size: [Math.round(v.width), Math.round(v.height)], text };
      },
    };
    return true;
  })()`);
  await shot('convert-1-home.png');

  // 一个文件拖进首页 → 一份还没保存的 PDF
  const one = async (file, expect, opts = {}) => {
    const r = await evaluate(`(async () => { const r = await __cv.dropAndWait(${JSON.stringify([C(file)])}, 1, ${JSON.stringify(opts)}); return JSON.stringify({ ...r, tabs: await Promise.all(r.tabs.map(t => __cv.info(t))) }); })()`, 200000);
    const res = JSON.parse(r), t = res.tabs[0];
    return { res, t };
  };
  const office = {};
  for (const [file, kind, test] of [
    ['报告.docx', 'Word', t => t.pages === 2 && t.outline.some(o => o.includes('天真之歌')) && t.outline.some(o => o.includes('The Tyger')) && /Tyger/.test(t.text) && t.images >= 1],
    ['表格.xlsx', 'Excel', t => t.pages === 2 && /合计/.test(t.text) && /45/.test(t.text)],
    ['幻灯片.pptx', 'PowerPoint', t => t.pages === 2 && /The Tyger/.test(t.text)],
  ]) {
    const { res, t } = await one(file);
    if (res.errors?.some(e => /没找到能打开它的软件/.test(e))) { check(`${kind} 文档转成 PDF`, null, '本机没装能转换的 Office'); continue; }
    office[kind] = t;
    const ok = !!t && t.name === file.replace(/\.[^.]+$/, '.pdf') && t.dirty && t.dir === CV && test(t);
    check(`${kind} 文档转成 PDF（还没保存，记着源文件夹）`, ok, JSON.stringify({ ...res, tabs: undefined, t: t && { ...t, text: t.text.slice(0, 120) } }));
  }
  for (const [file, label, test, opts] of [
    // 「插图」后面跟着一张放不下的大图，被挤到下一页：Chromium 给的书签标题是「插图插图」，要改回来
    ['说明.md', 'Markdown（标题变书签且不重复、插图、表格、生僻字）', t => t.outline.includes('天真与经验之歌') && t.outline.some(o => o.trim() === '插图') && !t.outline.some(o => o.includes('插图插图'))
      && t.outline.some(o => o.includes('表格')) && t.images >= 1 && /1789/.test(t.text) && /𪚥/.test(t.text) && t.size[0] === 595],
    ['诗-GBK.txt', 'GBK 编码的文本', t => /老虎！老虎！/.test(t.text) && /Tyger Tyger/.test(t.text)],
    ['代码.py', '代码（等宽、很长的行自动换行）', t => /def songs/.test(t.text) && /第 119 行/.test(t.text)],
    ['目录.csv', 'CSV 表格（带引号、逗号、换行的字段）', t => /插图编号/.test(t.text) && /有逗号, 也有"引号"/.test(t.text) && /The Tyger/.test(t.text)],
    ['网页.html', '网页（脚本不执行、不跳转、图片在）', t => /原样印出来/.test(t.text) && !/脚本执行了/.test(t.text) && t.images >= 1],
    ['网页存档.mht', 'MHT 网页存档（图片从存档里取）', t => /图片在存档里面/.test(t.text) && t.images >= 1 && t.outline.includes('  存档第二节')],
    ['网页存档-LF.mht', '只用 LF 换行的 MHT（换成 CRLF 再打印，不是白纸）', t => /图片在存档里面/.test(t.text) && t.images >= 1],
    ['扫描-三页.tif', '三页 TIFF 扫描件（WIC 解码）', t => t.pages === 3 && t.images === 3, { comb: null }],
  ]) {
    const { res, t } = await one(file, null, opts);
    check(label, !!t && t.dirty && test(t), JSON.stringify({ ...res, tabs: undefined, t: t && { ...t, text: t.text.slice(0, 160) } }));
  }

  // 几个文件合成一份：混着放的时候对话框默认不勾，勾上；每个文件一个书签，Word 原来的书签收在它下面
  const mix = JSON.parse(await evaluate(`(async () => { const r = await __cv.dropAndWait(${JSON.stringify([C('照片-EXIF方向6.jpg'), C('说明.md'), C('报告.docx')])}, 1, { comb: true }); return JSON.stringify({ ...r, tabs: await Promise.all(r.tabs.map(t => __cv.info(t))) }); })()`, 200000));
  const m = mix.tabs[0];
  const wordOk = !!office.Word;
  check('几个文件合成一份（顺序按文件名，每个文件一个书签）', !!m && mix.dialog?.comb === false && mix.dialog.items.join('|') === '报告.docx|说明.md|照片-EXIF方向6.jpg'
    && m.name === '报告 等 3 个文件.pdf' && m.outline[0] === '报告.docx' && (!wordOk || m.outline.includes('  天真之歌')) && m.outline.includes('说明.md') && m.outline.includes('照片-EXIF方向6.jpg'),
  JSON.stringify({ dialog: mix.dialog, t: m && { ...m, text: undefined }, errors: mix.errors }));
  await shot('convert-2-combined.png');

  // 加了密码的 Office 文档、认不得的文件：给出提示，不开标签
  const bad = JSON.parse(await evaluate(`(async () => {
    __pv.activate('home');
    const n = __pv.state.tabs.length;
    await __cv.drop(${JSON.stringify([C('加密.docx'), C('认不得.xyz')])});
    for (let i = 0; i < 50; i++) { await __cv.sleep(200); if (__cv.toasts().some(t => /打开密码/.test(t))) break; }
    return JSON.stringify({ tabs: __pv.state.tabs.length - n, toasts: __cv.toasts() });
  })()`, 60000));
  check('加了密码的文档、认不得的文件：提示，不开标签', bad.tabs === 0 && bad.toasts.some(t => /设了打开密码/.test(t)) && bad.toasts.some(t => /1 个文件打不开/.test(t)), JSON.stringify(bad));

  // 拖进合并页：PDF、Excel、图片——不是 PDF 的先转，顺序不变
  const mg = JSON.parse(await evaluate(`(async () => {
    __pv.activate('merge');
    await __cv.sleep(300);
    await __cv.drop(${JSON.stringify([path.join(root, '.cache', 'test', 'A-天真.pdf'), C('表格.xlsx'), C('透明.png')])});
    for (let i = 0; i < 400; i++) { await __cv.sleep(250); const it = __pv.merger.items; if (it.length >= 3 && it.every(x => !x.loading)) break; }
    return JSON.stringify(__pv.merger.items.map(x => [x.name, x.numPages, x.dir, x.error]));
  })()`, 150000));
  const xl = !!office.Excel;
  check('拖进合并页：先转成 PDF 再加入，顺序不变', xl ? mg.map(x => x[0]).join('|') === 'A-天真.pdf|表格.pdf|透明.pdf' && mg[1][1] === 2 && mg[2][1] === 1 && mg[2][2] === CV
    : mg.map(x => x[0]).join('|') === 'A-天真.pdf|透明.pdf', JSON.stringify(mg));
  await sleep(800);
  await shot('convert-3-merge.png');

  // 关掉刚转出来的文档：先问（点取消，标签还在）
  const ask = JSON.parse(await evaluate(`(async () => {
    const t = __pv.state.tabs[0];
    __pv.activate(t.id);
    await __cv.sleep(300);
    document.querySelector('[data-x="' + t.id + '"]').click();
    let d = null;
    for (let i = 0; i < 20 && !d; i++) { await __cv.sleep(150); d = document.querySelector('#dlg[open]'); }
    const r = { title: d?.querySelector('h3')?.textContent, body: d?.querySelector('.dlg-b')?.textContent };
    d?.querySelector('[data-dlg=""]')?.click();
    await __cv.sleep(300);
    r.still = __pv.state.tabs.includes(t);
    return JSON.stringify(r);
  })()`));
  check('关掉刚转出来的文档：先问，点取消标签还在', /保存对/.test(ask.title || '') && /刚转换出来的/.test(ask.body || '') && ask.still, JSON.stringify(ask));

  // 保存：默认存到源文件所在的文件夹，文件名是转出来的名字；存完不再算「还没保存」。
  // 「另存为」对话框由 platform.askSavePath 的测试钩子代答（系统对话框会跑到用户眼前；Tauri 的 invoke 是只读的，拦不了）
  const sv = JSON.parse(await evaluate(`(async () => {
    const t = __pv.state.tabs[0], before = t.name;
    let asked = null;
    window.__pvTest = { askSavePath: (fileName, directory) => { asked = { fileName, directory }; return ${JSON.stringify(SAVE_TO)}; } };
    try { await __pv.saveTab(t); } finally { delete window.__pvTest; }
    return JSON.stringify({ asked, before, path: t.path, name: t.name, dirty: __pv.isDirty(t), converted: t.converted });
  })()`));
  const saved = fs.existsSync(SAVE_TO) ? fs.readFileSync(SAVE_TO) : null;
  check('保存：默认存到源文件旁边，存完不再算没保存', sv.asked?.directory === CV && sv.asked?.fileName === sv.before && sv.path === SAVE_TO && !sv.dirty && sv.converted === null
    && !!saved && saved.subarray(0, 5).toString() === '%PDF-', JSON.stringify({ ...sv, bytes: saved?.length }));

  // 打印用的隐藏窗口都关掉了；主窗口一直在屏幕外
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page').map(t => t.url);
  check('打印用的隐藏窗口用完都关了', targets.length === 1, JSON.stringify(targets));
  await evaluate(`__pv.activate('home')`);
  await sleep(1500);
  await shot('convert-4-home-after.png');
  check('窗口始终在屏幕外、没最大化、没抢焦点', geo.every(g => g.x < -5000 && !g.max && !g.full && !g.focused), JSON.stringify(geo));
  const errs = logs.filter(l => /^\[(error|exception)\]/.test(l) || /Content Security Policy|Refused to/.test(l));
  check('控制台没有报错（含 CSP 拦截）', errs.length === 0, errs.slice(0, 8).join(' || '));
  if (logs.length) fs.writeFileSync(path.join(shots, 'convert-console.log'), logs.join('\n'));
} catch (e) {
  check('转换测试本身', false, e.message);
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(500);
  fs.rmSync(C('认不得.xyz'), { force: true });
}
const fail = results.filter(r => r.ok === false).length, skip = results.filter(r => r.ok === null).length;
console.log(fail ? `\n${fail} 项没通过` : `\n全部通过${skip ? `（${skip} 项跳过）` : ''}`);
process.exit(fail ? 1 : 0);
