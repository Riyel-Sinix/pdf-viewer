// 桌面版冒烟测试：窗口开在屏幕外（不抢焦点、不截桌面），通过 WebView2 的 DevTools 协议检查
//   node tools/desktop-smoke.mjs [exe 路径]
// 检查：启动时带的 PDF 能打开、控制台没有报错（含 CSP）、读写文件的 IPC、合并引擎（pdf.js worker + pdf-lib worker）、
//       单实例转发（再启动一次会在原窗口开新标签）、拖放；编辑：批注（文字 / 画笔 / 高亮）存盘后重新载入、
//       pdf.js 编辑器的中文、整理页面（后台线程 pdf-lib）和撤销、签名对话框、有没保存的修改时关窗会先问；
//       背景（选择框、打包进程序的水彩、自己的图片存进 IndexedDB 用 blob: 地址显示）。
//       会弹系统对话框的操作（另存为、提取）不测，免得窗口跑到用户眼前。截图存到 .cache/shots/
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const exe = process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'pdf-viewer.exe');
const T = n => path.join(root, '.cache', 'test', n);
const shots = path.join(root, '.cache', 'shots');
fs.mkdirSync(shots, { recursive: true });
const PORT = 9333;
const testData = path.join(root, '.cache', 'wv2-test');      // 测试专用的 WebView2 数据目录，每次从空的开始
fs.rmSync(testData, { recursive: true, force: true });
const env = { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1', PDFVIEWER_TEST_DATA: testData,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SAVE_TEST = T('保存测试.pdf');                           // 编辑后要存盘的文件：A 的一份副本
fs.copyFileSync(T('A-天真.pdf'), SAVE_TEST);
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const app = spawn(exe, [T('A-天真.pdf')], { env, detached: false, stdio: 'ignore' });
let ws, seq = 0;
const pending = new Map(), logs = [];
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
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
  const send = (method, params = {}) => new Promise((r, rej) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`DevTools 调用超时：${method}`)); }, 20000);
    pending.set(id, m => { clearTimeout(t); r(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const shot = async name => {
    if (!await offscreenOk(name)) throw new Error(`窗口跑到屏幕上了（${name}）：${JSON.stringify(geo.at(-1))}`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(shots, name), Buffer.from(r.result.data, 'base64'));
  };
  // 窗口必须一直待在屏幕外、不最大化不全屏——否则就会出现在用户眼前
  const geo = [];
  const offscreenOk = async step => {
    const g = JSON.parse(await evaluate(`(async () => { const w = __TAURI__.window.getCurrentWindow(); const p = await w.outerPosition(); return JSON.stringify({ x: p.x, y: p.y, max: await w.isMaximized(), full: await w.isFullscreen(), focused: await w.isFocused() }); })()`));
    geo.push({ step, ...g });
    return g.x < -5000 && !g.max && !g.full;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // 一连上就先确认窗口在屏幕外；不在就立刻结束（finally 里会关掉程序）
  let placed = false;
  for (let i = 0; i < 20 && !placed; i++) { try { placed = await offscreenOk('刚启动'); break; } catch { await sleep(100); } }
  if (!placed) throw new Error(`窗口不在屏幕外：${JSON.stringify(geo.at(-1) || '查不到')}`);

  // 1. 启动参数里的 PDF
  let st = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    st = await evaluate(`window.__pv && JSON.stringify({ tabs: __pv.state.tabs.map(t => [t.name, t.numPages, t.loading]), active: __pv.state.active, title: document.title, cls: document.documentElement.className, canvases: document.querySelectorAll('.vc.on canvas').length, thumbs: document.querySelectorAll('#thumbs img').length })`).catch(() => null);
    if (st && JSON.parse(st).canvases > 0 && JSON.parse(st).thumbs > 0) break;
  }
  st = JSON.parse(st || '{}');
  check('启动参数里的 PDF 打开了', st.tabs?.[0]?.[1] === 3 && st.canvases > 0, JSON.stringify(st));
  check('桌面模式（自绘标题栏）', /desktop/.test(st.cls || ''), st.cls);
  await sleep(600);
  await shot('desktop-1-reader.png');

  // 2. 读写文件 IPC（二进制、中文路径）
  const io = await evaluate(`(async () => {
    const p = ${JSON.stringify(T('写入测试.bin'))};
    const data = new Uint8Array([0, 1, 2, 250, 251, 252, 37, 80, 68, 70]);
    await __TAURI__.core.invoke('write_file', data, { headers: { 'x-path': encodeURIComponent(p) } });
    const back = new Uint8Array(await __TAURI__.core.invoke('read_file', { path: p }));
    const ex = await __TAURI__.core.invoke('paths_exist', { paths: [p, p + '.nope'] });
    return JSON.stringify({ same: back.length === data.length && back.every((v, i) => v === data[i]), ex });
  })()`);
  const ioR = JSON.parse(io);
  check('写文件 / 读文件（中文路径、二进制）', ioR.same && ioR.ex[0] === true && ioR.ex[1] === false, io);
  try { fs.unlinkSync(T('写入测试.bin')); } catch {}

  // 3. 合并引擎：pdf.js extractPages（加密文件）+ pdf-lib 后台线程（在应用的 CSP 下）
  const mg = await evaluate(`(async () => {
    const { loadPdf } = await import('./js/reader.js');
    const { getMergeWorker } = await import('./js/pdfjs.js');
    const rd = async p => new Uint8Array(await __TAURI__.core.invoke('read_file', { path: p }));
    const a = await rd(${JSON.stringify(T('A-天真.pdf'))}), b = await rd(${JSON.stringify(T('B-经验-仅所有者密码.pdf'))}), c = await rd(${JSON.stringify(T('C-用户密码123.pdf'))});
    const { pdf } = await loadPdf(a.slice(), { worker: getMergeWorker() });
    const out = await pdf.extractPages([{ document: null }, { document: b }, { document: c, password: '123', includePages: [1] }]);
    pdf.loadingTask.destroy();
    const w = new Worker(new URL('./js/merge-worker.js', location.href), { type: 'module' });
    const res = await new Promise((ok, bad) => { w.onmessage = e => ok(e.data); w.onerror = e => bad(new Error(e.message || 'worker error')); w.postMessage({ bytes: out.slice(), total: 6, bookmarks: true, title: 't', topPages: [0, 3, 5], groups: [{ title: 'A', start: 0, count: 3, rotate: 0 }, { title: 'B', start: 3, count: 2, rotate: 90 }, { title: 'C', start: 5, count: 1, rotate: 0 }] }); });
    w.terminate();
    return JSON.stringify({ extracted: out.length, ok: res.ok, err: res.error || '', size: res.bytes?.length || 0 });
  })()`);
  const mgR = JSON.parse(mg);
  check('合并引擎（pdf.js + pdf-lib worker，CSP 下）', mgR.extracted > 1000 && mgR.ok && mgR.size > 1000, mg);

  // 4. 单实例：再启动一次带另一个文件，应该在原窗口开新标签，第二个进程自己退出
  const second = spawn(exe, [T('D-横竖混排.pdf')], { env: { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1' }, stdio: 'ignore' });
  const exited = await Promise.race([new Promise(r => second.on('exit', () => r(true))), sleep(8000).then(() => false)]);
  let tabs = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    tabs = JSON.parse(await evaluate(`JSON.stringify(__pv.state.tabs.map(t => [t.name, t.numPages, t.loading]))`));
    if (tabs.length >= 2 && !tabs[1][2]) break;
  }
  check('单实例：第二次启动转到原窗口开新标签', exited && tabs.length === 2 && tabs[1][0] === 'D-横竖混排.pdf' && tabs[1][1] === 4, JSON.stringify({ exited, tabs }));
  if (!exited) try { second.kill(); } catch {}
  await sleep(800);
  await shot('desktop-2-second.png');

  // 5. 拖放：模拟系统发来的 drag-drop 事件（只检查前端的处理；系统拖放本身由 Tauri / WebView2 负责）
  await evaluate(`__TAURI__.event.emit('tauri://drag-drop', { paths: [${JSON.stringify(T('TutorialSample.pdf'))}], position: { x: 300, y: 300 } })`);
  let dd = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    dd = JSON.parse(await evaluate(`JSON.stringify(__pv.state.tabs.map(t => [t.name, t.numPages, t.loading]))`));
    if (dd.length >= 3 && !dd[2][2]) break;
  }
  check('拖进窗口的 PDF 会打开', dd.length === 3 && dd[2][0] === 'TutorialSample.pdf' && dd[2][1] === 3, JSON.stringify(dd));

  // 6. 编辑：文字、画笔、高亮 → 保存（写回原文件，不弹对话框）→ 重新载入后批注还在
  await evaluate(`window.__smoke = {
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    layer: p => document.querySelector('.vc.on .page[data-page-number="' + p + '"] .annotationEditorLayer'),
    ev(el, type, x, y, b = 1, id = 11) { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: b, pointerId: id, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true })); },
    async waitTab(name) { for (let i = 0; i < 80; i++) { await this.sleep(150); const t = __pv.state.tabs.find(x => x.name === name); if (t && !t.loading && t.leaf && !t.leaf.pending && t.leaf.ui) return t; } return null; },
    tab: () => __pv.state.tabs.find(x => x.name === '保存测试.pdf'),
  }; true`);
  const ed = JSON.parse(await evaluate(`(async () => {
    const S = __smoke, p = await import('./js/platform.js');
    await __pv.openEntries([p.entryFromPath(${JSON.stringify(SAVE_TEST)})]);
    const t = await S.waitTab('保存测试.pdf');
    if (!t) return JSON.stringify({ err: '没打开' });
    __pv.editbar.show(true);
    __pv.reader.setZoom('page-fit'); await S.sleep(500); __pv.reader.goTo(1); await S.sleep(700);
    __pv.reader.setEditMode(3); await S.sleep(600);
    let L = S.layer(1); S.ev(L, 'pointerdown', 150, 420); S.ev(L, 'pointerup', 150, 420, 0); await S.sleep(400);
    const ft = [...document.querySelectorAll('.vc.on .freeTextEditor .internal')].pop();
    const placeholder = ft?.getAttribute('default-content') || null, label = ft?.getAttribute('aria-label') || null;
    ft?.focus(); document.execCommand('insertText', false, '天真与经验之歌'); __pv.reader.commitEdits(); await S.sleep(300);
    __pv.reader.setEditMode(15); await S.sleep(600);
    L = S.layer(1); S.ev(L, 'pointerdown', 120, 520, 1, 12);
    for (let i = 1; i <= 20; i++) { S.ev(L, 'pointermove', 120 + i * 10, 520 + Math.sin(i / 3) * 20, 1, 12); await S.sleep(5); }
    S.ev(L, 'pointerup', 320, 520, 0, 12); await S.sleep(300);
    __pv.reader.setEditMode(0); await S.sleep(500);
    const sp = [...document.querySelectorAll('.vc.on .page[data-page-number="1"] .textLayer span')].filter(s => s.textContent.trim().length > 3)[2];
    if (sp) { const rg = document.createRange(); rg.setStart(sp.firstChild, 0); rg.setEnd(sp.firstChild, Math.min(10, sp.firstChild.length)); getSelection().removeAllRanges(); getSelection().addRange(rg); __pv.reader.highlightSelection(); }
    await S.sleep(700); __pv.reader.setEditMode(0); await S.sleep(300);
    const types = [...(t.pdf.annotationStorage.serializable.map?.values() || [])].map(v => v.annotationType).sort((a, b) => a - b);
    const dirty = __pv.isDirty(t), title = document.title;
    const saved = await __pv.saveTab(t);
    await S.sleep(800);
    const after = (await (await t.pdf.getPage(1)).getAnnotations()).map(a => a.subtype).filter(x => x !== 'Link').sort();
    return JSON.stringify({ placeholder, label, types, dirty, title, saved, dirtyAfter: __pv.isDirty(t), after, titleAfter: document.title });
  })()`));
  check('pdf.js 编辑器是中文（l10n 在 CSP 下载入）', ed.placeholder === '在此键入…' && ed.label === '文本编辑器', JSON.stringify({ placeholder: ed.placeholder, label: ed.label, err: ed.err }));
  check('加批注后标成「没保存」', ed.dirty && /^●/.test(ed.title || '') && JSON.stringify(ed.types) === '[3,9,15]', JSON.stringify({ dirty: ed.dirty, title: ed.title, types: ed.types }));
  const disk = fs.readFileSync(SAVE_TEST).toString('latin1');
  const count = st => (disk.match(new RegExp('/Subtype\\s*/' + st + '\\b', 'g')) || []).length;
  check('保存写回原文件，重新载入后批注都在', ed.saved && !ed.dirtyAfter && !/^●/.test(ed.titleAfter || '') && JSON.stringify(ed.after) === '["FreeText","Highlight","Ink"]'
    && count('FreeText') >= 1 && count('Ink') >= 1 && count('Highlight') >= 1, JSON.stringify({ saved: ed.saved, dirtyAfter: ed.dirtyAfter, after: ed.after, disk: [count('FreeText'), count('Ink'), count('Highlight')] }));

  // 7. 整理页面：转、加空白页、复制（后台线程 pdf-lib，CSP 下），书签不重复；再撤销回到存好的样子
  const og = JSON.parse(await evaluate(`(async () => {
    const S = __smoke, t = S.tab();
    const items = [{ kind: 'page', src: 0, page: 0, rot: 90 }, { kind: 'blank', w: 595, h: 842 }, { kind: 'page', src: 0, page: 1, rot: 0 }, { kind: 'page', src: 0, page: 2, rot: 0 }, { kind: 'page', src: 0, page: 2, rot: 0 }];
    const ok = await __pv.rebuildPages(t, [{}], items, '冒烟测试');
    const p1 = await t.pdf.getPage(1), p2 = await t.pdf.getPage(2);
    const r = { ok, pages: t.numPages, rot: p1.rotate, blank: (await p2.getTextContent()).items.length, ann: (await p1.getAnnotations()).map(a => a.subtype).filter(x => x !== 'Link').sort(), outline: (await t.pdf.getOutline())?.length ?? 0, dirty: __pv.isDirty(t) };
    await __pv.organizer.open(t);
    await S.sleep(1500);
    r.cells = document.querySelectorAll('#orgDlg .ocell').length;
    r.thumbs = document.querySelectorAll('#orgDlg .ocell .opg img').length;
    return JSON.stringify(r);
  })()`));
  await shot('desktop-5-organize.png');
  const og2 = JSON.parse(await evaluate(`(async () => {
    const S = __smoke, t = S.tab();
    document.querySelector('#orgDlg [data-a="cancel"]').click(); await S.sleep(300);
    const closed = !document.querySelector('#orgDlg').open;
    await __pv.undo();
    for (let i = 0; i < 40; i++) { await S.sleep(200); if (!t.busy && t.numPages === 3) break; }
    return JSON.stringify({ closed, undone: t.numPages, dirty: __pv.isDirty(t) });
  })()`));
  check('整理页面（pdf-lib 后台线程）：转向、空白页、复制，批注留着、书签不重复',
    og.ok && og.pages === 5 && og.rot === 90 && og.blank === 0 && JSON.stringify(og.ann) === '["FreeText","Highlight","Ink"]' && og.outline === 1 && og.dirty, JSON.stringify(og));
  check('整理对话框：缩略图都画出来了', og.cells === 5 && og.thumbs >= 4 && og2.closed, JSON.stringify({ cells: og.cells, thumbs: og.thumbs, closed: og2.closed }));
  check('撤销整理页面：回到存好的样子（不再算没保存）', og2.undone === 3 && !og2.dirty, JSON.stringify(og2));

  // 8. 签名：手写板（WebView2 下画布尺寸、笔迹）→ 插入到页面上
  const sg = JSON.parse(await evaluate(`(async () => {
    const S = __smoke;
    __pv.reader.goTo(1); await S.sleep(400);
    document.querySelector('#etools [data-tool="sign"]').click(); await S.sleep(700);
    const cv = document.querySelector('#sgCv');
    if (!cv) return JSON.stringify({ err: '没弹出签名对话框' });
    const r = cv.getBoundingClientRect();
    const pe = (type, x, y, b = 1, pr = 0.5) => cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: b, pointerId: 21, pointerType: 'pen', pressure: pr, isPrimary: true, bubbles: true, cancelable: true }));
    pe('pointerdown', 60, 120, 1, 0.2);
    for (let i = 0; i <= 40; i++) pe('pointermove', 60 + i * 5, 120 - Math.abs(Math.sin(i / 40 * Math.PI * 2)) * 60, 1, 0.3 + 0.5 * Math.sin(i / 40 * Math.PI));
    pe('pointerup', 260, 120, 0, 0);
    await S.sleep(200);
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let inked = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) inked++;
    return JSON.stringify({ inked, w: cv.width, h: cv.height, cw: cv.clientWidth, dpr: devicePixelRatio, ok: !document.querySelector('#sgOk').disabled });
  })()`));
  await shot('desktop-6-sign.png');
  const sg2 = JSON.parse(await evaluate(`(async () => {
    const S = __smoke, before = document.querySelectorAll('.vc.on .stampEditor').length;
    document.querySelector('#sgOk')?.click();
    for (let i = 0; i < 20; i++) { await S.sleep(200); if (document.querySelectorAll('.vc.on .stampEditor').length > before) break; }
    await S.sleep(400);
    return JSON.stringify({ added: document.querySelectorAll('.vc.on .stampEditor').length - before, dirty: __pv.isDirty(S.tab()) });
  })()`));
  const dprW = Math.round(sg.cw * Math.min(3, sg.dpr || 1));
  check('签名：手写板按实际宽度建画布、笔迹画得上去、插入页面', sg.inked > 200 && sg.w === dprW && sg.ok && sg2.added === 1 && sg2.dirty, JSON.stringify({ ...sg, ...sg2 }));
  // 粘贴图片：阅读状态下也能粘，一次一张（pdf.js 的粘贴监听可能挂了好几个，由应用统一接住）
  const ps = JSON.parse(await evaluate(`(async () => {
    const S = __smoke;
    __pv.reader.setEditMode(0); await S.sleep(500);
    const n = () => document.querySelectorAll('.vc .stampEditor').length, before = n();
    const c = document.createElement('canvas'); c.width = 80; c.height = 50; c.getContext('2d').fillRect(0, 0, 80, 50);
    const f = new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'p.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('.vc.on').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await S.sleep(1200);
    return JSON.stringify({ added: n() - before, mode: __pv.reader.editMode });
  })()`));
  check('粘贴图片：阅读状态下也是一次一张', ps.added === 1 && ps.mode === 13, JSON.stringify(ps));
  await evaluate(`(async () => { __pv.reader.setEditMode(15); await __smoke.sleep(600); return true; })()`);
  await shot('desktop-7-editbar.png');
  await evaluate(`__pv.reader.setEditMode(0), true`);

  // 9. 有没保存的修改时关窗：先问（这里点「取消」，窗口留着）
  await evaluate(`__TAURI__.window.getCurrentWindow().close(), true`);
  let ask = null;
  for (let i = 0; i < 20 && !ask; i++) { await sleep(250); ask = await evaluate(`document.querySelector('#dlg[open] h3')?.textContent || null`); }
  if (ask) await shot('desktop-8-close-ask.png');
  await evaluate(`document.querySelector('#dlg [data-dlg=""]')?.click(), true`);
  await sleep(600);
  const alive = await evaluate(`JSON.stringify({ tabs: __pv.state.tabs.length, dlg: !!document.querySelector('#dlg[open]') })`).catch(() => null);
  check('关窗时有没保存的修改：先问，点取消窗口还在', ask === '保存对「保存测试.pdf」的修改吗？' && !!alive && !JSON.parse(alive).dlg, JSON.stringify({ ask, alive }));

  // 10. 首页、合并页、深色主题的截图
  await evaluate(`__pv.activate('home')`);
  await sleep(2500);
  await shot('desktop-3-home.png');
  await evaluate(`document.querySelector('#tbTheme').click(), __pv.activate('merge')`);
  await sleep(2600);
  await shot('desktop-4-merge-dark.png');
  await evaluate(`document.querySelector('#tbTheme').click()`);

  // 11. 背景：默认是今日之诗；选择框六个选项、小图都载得出来；换成打包进程序的水彩；
  //     自己的图片（文件选择框直接喂文件，不弹系统对话框）存进 IndexedDB，在应用的 CSP 下用 blob: 地址显示；选的记在偏好里
  const bg = JSON.parse(await evaluate(`(async () => {
    const S = __smoke, box = document.querySelector('#dayplate'), saved = () => JSON.parse(localStorage.getItem('pv.prefs') || '{}').backdrop;
    const first = box.dataset.kind;
    __pv.openBackdropPicker(); await S.sleep(800);
    const tiles = [...document.querySelectorAll('#dlg .bgt')].map(b => b.dataset.bg);
    const imgs = [...document.querySelectorAll('#dlg .bgt img')];
    await Promise.all(imgs.map(i => i.decode().catch(() => {})));
    const broken = imgs.filter(i => !i.naturalWidth).map(i => i.getAttribute('src'));
    document.querySelector('#dlg .bgt[data-bg=roses]').click(); await S.sleep(2000);
    const roses = { kind: box.dataset.kind, w: box.querySelector('.lay.on .art')?.naturalWidth || 0, on: document.querySelector('#dlg .bgt.on')?.dataset.bg, saved: saved() };
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1800;
    const g = c.getContext('2d'); g.fillStyle = '#3F6F95'; g.fillRect(0, 0, 1200, 1800);
    const f = new File([await new Promise(r => c.toBlob(r, 'image/png'))], '竖图.png', { type: 'image/png' });
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return orig.call(this);
      HTMLInputElement.prototype.click = orig;
      const dt = new DataTransfer(); dt.items.add(f); this.files = dt.files;
      setTimeout(() => this.dispatchEvent(new Event('change')));
    };
    document.querySelector('#dlg .bgt[data-bg=custom]').click(); await S.sleep(2500);
    HTMLInputElement.prototype.click = orig;
    const lay = box.querySelector('.lay.on'), art = lay?.querySelector('.art');
    const custom = { cls: lay?.className, scheme: art?.src.split(':')[0], w: art?.naturalWidth || 0, h: art?.naturalHeight || 0, saved: saved() };
    document.querySelector('#dlg [data-dlg=ok]').click();
    return JSON.stringify({ first, tiles, broken, roses, custom });
  })()`));
  check('背景：默认今日之诗，选择框六个选项、小图都在', bg.first === 'poem' && bg.tiles.join() === 'day,roses,lane,border,plain,custom' && bg.broken.length === 0, JSON.stringify({ first: bg.first, tiles: bg.tiles, broken: bg.broken }));
  check('背景：换成水彩「玫瑰与新月」（打包进程序的图片），记在偏好里', bg.roses.kind === 'pic' && bg.roses.w === 2560 && bg.roses.on === 'roses' && bg.roses.saved === 'roses', JSON.stringify(bg.roses));
  check('背景：自己的图片存进 IndexedDB、用 blob: 显示（竖幅居中）', /fit-tall/.test(bg.custom.cls || '') && bg.custom.scheme === 'blob' && bg.custom.w === 1200 && bg.custom.h === 1800 && bg.custom.saved === 'custom', JSON.stringify(bg.custom));
  await evaluate(`(async () => { const { prefs, savePrefs } = await import('./js/store.js'); prefs.backdrop = 'roses'; savePrefs(); __pv.activate('home'); await __pv.renderBackdrop(); return true; })()`);
  await sleep(1800);
  await shot('desktop-9-backdrop.png');

  check('窗口始终在屏幕外、没最大化、没抢焦点', geo.every(g => g.x < -5000 && !g.max && !g.full && !g.focused), JSON.stringify(geo));
  const errs = logs.filter(l => /^\[(error|exception)\]/.test(l) || /Content Security Policy|Refused to/.test(l));
  check('控制台没有报错（含 CSP 拦截）', errs.length === 0, errs.slice(0, 8).join(' || '));
  if (logs.length) fs.writeFileSync(path.join(shots, 'console.log'), logs.join('\n'));
} catch (e) {
  check('冒烟测试本身', false, e.message);
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(500);
  try { fs.unlinkSync(SAVE_TEST); } catch {}
}
const fail = results.filter(r => !r.ok).length;
console.log(fail ? `\n${fail} 项没通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
