// README 用的截图：node tools/screenshots.mjs [exe 路径]
// 先跑 python -P tools/make-showcase-pdf.py 生成《天真之歌》《经验之歌》两册示例（公有领域）；
// 「转成 PDF」那两张要再跑 python -P tools/make-convert-tests.py（没有就跳过）；最后两张是背景（水彩、夜间）。
// 和冒烟测试一样，窗口开在屏幕外、不抢焦点（不截桌面），通过 WebView2 的 DevTools 协议摆好场景、截图，
// 再用 PyMuPDF 缩小转成 JPEG 放到 docs/
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const exe = process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'pdf-viewer.exe');
const T = n => path.join(root, '.cache', 'test', n);
const INNO = T('Songs of Innocence.pdf'), EXP = T('Songs of Experience.pdf');
if (!fs.existsSync(INNO) || !fs.existsSync(EXP)) { console.error('先运行 python -P tools/make-showcase-pdf.py'); process.exit(1); }
const raw = path.join(root, '.cache', 'shots', 'readme');
const docs = path.join(root, 'docs');
fs.mkdirSync(raw, { recursive: true });
fs.mkdirSync(docs, { recursive: true });
const PORT = 9334;
const testData = path.join(root, '.cache', 'wv2-shots');
fs.rmSync(testData, { recursive: true, force: true });
const env = { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1', PDFVIEWER_TEST_DATA: testData,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const app = spawn(exe, [INNO], { env, stdio: 'ignore' });
let ws, seq = 0, ok = true;
const pending = new Map();
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('DevTools 端口没起来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}, ms = 30000) => new Promise((r, rej) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`DevTools 调用超时：${method}`)); }, ms);
    pending.set(id, m => { clearTimeout(t); r(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr, ms) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ms);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  // 窗口必须一直在屏幕外、不最大化不全屏、没有焦点
  const offscreen = async () => {
    const g = JSON.parse(await evaluate(`(async () => { const w = __TAURI__.window.getCurrentWindow(); const p = await w.outerPosition(); return JSON.stringify({ x: p.x, max: await w.isMaximized(), full: await w.isFullscreen(), focused: await w.isFocused() }); })()`));
    if (!(g.x < -5000 && !g.max && !g.full && !g.focused)) throw new Error('窗口跑到屏幕上了：' + JSON.stringify(g));
  };
  const shot = async name => {
    await offscreen();
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(raw, name + '.png'), Buffer.from(r.result.data, 'base64'));
    console.log('截图', name);
  };
  await send('Page.enable');
  for (let i = 0; i < 20; i++) { try { await offscreen(); break; } catch (e) { if (i === 19) throw e; await sleep(150); } }

  await evaluate(`window.__s = {
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    tab: n => __pv.state.tabs.find(t => t.name === n),
    async wait(n) { for (let i = 0; i < 100; i++) { await this.sleep(150); const t = this.tab(n); if (t && !t.loading && t.leaf && !t.leaf.pending && t.leaf.ui) return t; } throw new Error('没打开：' + n); },
    span(page, text) { return [...document.querySelectorAll('.vc.on .page[data-page-number="' + page + '"] .textLayer span')].find(s => s.textContent.includes(text)); },
    layer: page => document.querySelector('.vc.on .page[data-page-number="' + page + '"] .annotationEditorLayer'),
    ev(el, type, x, y, b = 1, id = 11) { el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: b, pointerId: id, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true })); },
  }; true`);

  // 两册都打开（最近打开里有封面）
  await evaluate(`(async () => {
    await __s.wait('Songs of Innocence.pdf');
    const p = await import('./js/platform.js');
    await __pv.openEntries([p.entryFromPath(${JSON.stringify(EXP)})]);
    await __s.wait('Songs of Experience.pdf');
    await __s.sleep(2500);
    return true;
  })()`);

  // 1. 首页
  await evaluate(`__pv.activate('home'), true`);
  await sleep(3200);
  await shot('home');

  // 2. 阅读 + 编辑：《老虎》那一页，高亮第一行、朱砂色画笔在「fearful symmetry」下面划一道、加一条文字批注。
  // 画笔和文字批注要用 DevTools 的 Input 发真正的鼠标事件：pdf.js 按事件的 offsetX/offsetY 定位，网页里自己造的事件算不准
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  const ink = JSON.parse(await evaluate(`(async () => {
    const S = __s, t = S.tab('Songs of Experience.pdf');
    __pv.activate(t.id); await S.sleep(800);
    __pv.editbar.show(true);
    __pv.reader.setZoom('page-fit'); await S.sleep(400); __pv.reader.goTo(4); await S.sleep(1200);
    const first = S.span(4, 'Tyger Tyger, burning bright');
    const rg = document.createRange(); rg.selectNodeContents(first); getSelection().removeAllRanges(); getSelection().addRange(rg);
    __pv.reader.highlightSelection(); await S.sleep(800);
    __pv.reader.setEditMode(0); await S.sleep(400);
    getSelection().removeAllRanges();
    document.querySelector('#etools [data-tool="15"]').click(); await S.sleep(600);
    document.querySelector('#eprops .swc[data-v="#B4372A"]').click();
    const rng = document.querySelector('#eprops input[type=range]'); rng.value = 3; rng.dispatchEvent(new Event('input', { bubbles: true }));
    await S.sleep(200);
    const sym = S.span(4, 'fearful symmetry').getBoundingClientRect();
    return JSON.stringify({ x0: sym.left - 2, x1: sym.right + 4, y: sym.bottom + 2 });
  })()`));
  await mouse('mousePressed', ink.x0, ink.y);
  for (let i = 1; i <= 30; i++) { await mouse('mouseMoved', ink.x0 + (ink.x1 - ink.x0) * i / 30, ink.y + Math.sin(i / 2.2) * 1.6); await sleep(8); }
  await mouse('mouseReleased', ink.x1, ink.y);
  await sleep(400);
  const note = JSON.parse(await evaluate(`(async () => {
    const S = __s;
    __pv.reader.setEditMode(3); await S.sleep(600);
    document.querySelector('#eprops .swc[data-v="#2B5B8A"]').click();
    const sz = document.querySelector('#eprops input[type=range]'); sz.value = 15; sz.dispatchEvent(new Event('input', { bubbles: true }));
    await S.sleep(200);
    // 文字批注放在诗的下面：诗句那一栏的左边、最后一行再往下一点
    const left = S.span(4, 'Tyger Tyger, burning bright').getBoundingClientRect().left;
    const lines = [...document.querySelectorAll('.vc.on .page[data-page-number="4"] .textLayer span')].map(s => s.getBoundingClientRect()).filter(r => r.width > 0 && r.left > left - 5);
    const pr = S.layer(4).getBoundingClientRect();
    return JSON.stringify({ x: left + 4, y: Math.min(pr.bottom - 80, Math.max(...lines.map(r => r.bottom)) + 30) });
  })()`));
  await mouse('mousePressed', note.x, note.y);
  await mouse('mouseReleased', note.x, note.y);
  await sleep(600);
  await evaluate(`(async () => {
    const S = __s;
    const ft = [...document.querySelectorAll('.vc.on .freeTextEditor .internal')].pop();
    ft.focus(); document.execCommand('insertText', false, '老虎！老虎！火一样辉煌');
    __pv.reader.commitEdits(); await S.sleep(300);
    document.querySelector('#etools [data-tool="15"]').click(); await S.sleep(700);
    return true;
  })()`);
  await sleep(600);
  await shot('reader');

  // 3. 签名：打字、英文花体
  await evaluate(`(async () => {
    const S = __s;
    __pv.reader.setEditMode(0); await S.sleep(300);
    document.querySelector('#etools [data-tool="sign"]').click(); await S.sleep(700);
    document.querySelector('.sgseg [data-m="type"]').click(); await S.sleep(200);
    const tx = document.querySelector('#sgText'); tx.value = 'William Blake'; tx.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.sgfont [data-f="fell"]').click(); await S.sleep(900);
    document.querySelector('.sginks [data-c="#22406E"]').click(); await S.sleep(300);
    return true;
  })()`);
  await shot('sign');
  await evaluate(`document.querySelector('#dlg [data-dlg=""]').click(), true`);
  await sleep(400);

  // 4. 整理页面（《天真之歌》）
  await evaluate(`(async () => {
    const S = __s, t = S.tab('Songs of Innocence.pdf');
    __pv.activate(t.id); await S.sleep(800);
    await __pv.organizer.open(t);
    await S.sleep(2200);
    const pick = i => {
      const c = document.querySelectorAll('#orgDlg .ocell')[i], r = c.getBoundingClientRect();
      const o = { clientX: r.left + 20, clientY: r.top + 20, button: 0, pointerId: 31, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true };
      c.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    };
    pick(5); document.querySelector('#orgDlg [data-a="rr"]').click(); await S.sleep(300);      // 第 6 页向右转
    pick(3); document.querySelector('#orgDlg [data-a="blank"]').click(); await S.sleep(1500);   // 第 4 页后面加一张空白页（会选中它）
    return true;
  })()`);
  await shot('organize');
  await evaluate(`(async () => {
    document.querySelector('#orgDlg [data-a="cancel"]').click(); await __s.sleep(300);
    document.querySelector('#dlg[open] [data-dlg="ok"]')?.click(); await __s.sleep(300);      // 「放弃这次整理？」
    return true;
  })()`);

  // 5. 合并（夜间「经验之歌」主题）：两册装订成一本
  await evaluate(`(async () => {
    const S = __s;
    document.querySelector('#tbTheme').click(); await S.sleep(300);
    __pv.activate('merge'); await S.sleep(500);
    const tabs = ['Songs of Innocence.pdf', 'Songs of Experience.pdf'].map(n => S.tab(n));
    await __pv.merger.addEntries(tabs.map(t => ({ name: t.name, path: t.path, read: () => __pv.getBytes(t) })));
    const name = document.querySelector('#mName'); if (name) { name.value = 'Songs of Innocence and of Experience'; name.dispatchEvent(new Event('input', { bubbles: true })); }
    await S.sleep(3000);
    return true;
  })()`);
  await shot('merge');
  await evaluate(`document.querySelector('#tbTheme').click(), true`);

  // 6. 转成 PDF（要先跑 python -P tools/make-convert-tests.py；Word 那一份要本机装了 Office）：
  //    两张插图、一份 Word、一份 Markdown 拖进首页 → 选项对话框（勾上合成一份）→ 合成好的那份，目录里每个文件一个书签
  const CV = path.join(root, '.cache', 'test', 'convert');
  if (fs.existsSync(path.join(CV, '报告.docx'))) {
    await evaluate(`(async () => {
      const S = __s;
      __pv.activate('home'); await S.sleep(600);
      await __TAURI__.event.emit('tauri://drag-drop', { paths: ${JSON.stringify(['The Blossom.webp', '照片-EXIF方向6.jpg', '报告.docx', '说明.md'].map(n => path.join(CV, n)))}, position: { x: 300, y: 300 } });
      for (let i = 0; i < 40 && !document.querySelector('#dlg.cvdlg[open]'); i++) await S.sleep(150);
      const box = document.querySelector('#cvComb'); if (box && !box.checked) box.click();
      await S.sleep(400);
      return true;
    })()`);
    await shot('convert');
    const n = await evaluate(`(async () => {
      const S = __s, before = __pv.state.tabs.length;
      document.querySelector('#dlg [data-dlg="ok"]').click();
      for (let i = 0; i < 600; i++) { await S.sleep(200); const t = __pv.state.tabs[before]; if (t && !t.loading && t.leaf && !t.leaf.pending) break; }
      const t = __pv.state.tabs[before];
      if (!t) return 0;
      __pv.activate(t.id); await S.sleep(800);
      __pv.reader.setZoom('page-fit'); await S.sleep(300);
      document.querySelector('#sbSeg [data-sb="outline"]').click(); await S.sleep(1200);
      document.querySelectorAll('.toast').forEach(x => x.remove());
      return t.numPages;
    })()`, 180000);
    if (n) await shot('converted');
  }

  // 7. 背景：首页换成水彩「玫瑰与新月」，选择框开着；再换「乡间小路」、切到夜间（经验之歌），画压暗成夜色
  await evaluate(`(async () => {
    const S = __s;
    __pv.activate('home'); await S.sleep(400);
    document.querySelectorAll('.toast').forEach(x => x.remove());
    __pv.openBackdropPicker(); await S.sleep(800);
    document.querySelector('#dlg .bgt[data-bg=roses]').click(); await S.sleep(2400);
    document.activeElement?.blur();
    return true;
  })()`);
  await shot('backdrop');
  await evaluate(`(async () => {
    const S = __s;
    document.querySelector('#dlg .bgt[data-bg=lane]').click(); await S.sleep(300);
    document.querySelector('#dlg [data-dlg=ok]').click();
    document.querySelector('#tbTheme').click(); await S.sleep(3200);
    return true;
  })()`);
  await shot('backdrop-night');
  await evaluate(`document.querySelector('#tbTheme').click(), true`);
} catch (e) {
  ok = false;
  console.error('截图失败：', e.message);
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
if (ok) {
  // 缩到 1600 宽的 JPEG
  execFileSync('python', ['-P', '-c', `
import pymupdf as fitz, glob, os, sys
raw, docs = sys.argv[1], sys.argv[2]
for f in sorted(glob.glob(os.path.join(raw, '*.png'))):
    pix = fitz.Pixmap(f)
    w = min(1600, pix.width); h = round(pix.height * w / pix.width)
    small = fitz.Pixmap(pix, w, h, None) if w != pix.width else pix
    out = os.path.join(docs, 'screenshot-' + os.path.basename(f)[:-4] + '.jpg')
    small.save(out, jpg_quality=84)
    print(os.path.basename(out), w, h, round(os.path.getsize(out) / 1024), 'KB')
`, raw, docs], { stdio: 'inherit' });
}
process.exit(ok ? 0 : 1);
