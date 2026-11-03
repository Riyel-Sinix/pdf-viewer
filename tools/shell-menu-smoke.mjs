// 资源管理器右键「转成 PDF」的桌面测试：窗口开在屏幕外（不抢焦点、不截桌面），通过 WebView2 的 DevTools 协议看结果。
// 测试时程序把注册表写在单独的 HKCU\Software\PDFViewerTest 下（不碰真正的右键菜单），单实例也换了名字（不会转进用户正开着的窗口），测完都删掉
//   python -P tools/make-convert-tests.py      # 先生成测试文件（.cache/test/convert）
//   node tools/shell-menu-smoke.mjs [exe 路径]
// 检查：1. 安装程序用的 --register-shell-menu / --unregister-shell-menu：每种文件类型一项「转成 PDF」（文字、图标、多选、命令行），不开窗口
//       2. 程序没开着时，像资源管理器多选那样同时启动几个 `--convert 文件`：只留一个程序，全都转好存到源文件旁边、开成标签页；
//          已经有同名 PDF 的存成「名字 (1).pdf」，原来的不动
//       3. 开着时再右键转：同一个文件再转一次存成「(1)」；源文件夹不让写的，开成没保存的标签页并提示
//       4. ⋯ 菜单的开关：关掉后留下记号，安装程序再注册时跳过；再打开时去掉记号。右键菜单里的类型都是程序能转的
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const exe = path.resolve(process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'pdf-viewer.exe'));
const CV = path.join(root, '.cache', 'test', 'convert');
if (!fs.existsSync(path.join(CV, '报告.docx'))) { console.error('先运行 python -P tools/make-convert-tests.py 生成测试文件'); process.exit(2); }
const W = path.join(root, '.cache', 'test', 'rightclick'), LOCKED = path.join(W, '只读');
const shots = path.join(root, '.cache', 'shots');
fs.mkdirSync(shots, { recursive: true });
const PORT = 9338;
const testData = path.join(root, '.cache', 'wv2-shell');
const REG_ROOT = 'HKCU\\Software\\PDFViewerTest';
const ME = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
const env = { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1', PDFVIEWER_TEST_DATA: testData,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 测试用的注册表（reg export 出来是 UTF-16 的 .reg 文本）；没有这一块返回 ''
function regText() {
  const f = path.join(root, '.cache', 'out', 'shell-menu-test.reg');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.rmSync(f, { force: true });
  const r = spawnSync('reg', ['export', REG_ROOT, f, '/y'], { stdio: 'ignore' });
  return r.status === 0 && fs.existsSync(f) ? fs.readFileSync(f).toString('utf16le').replace(/^﻿/, '') : '';
}
const verbExts = reg => [...reg.matchAll(/\[HKEY_CURRENT_USER\\Software\\PDFViewerTest\\Classes\\SystemFileAssociations\\\.([^\\\]]+)\\shell\\PDFViewer\.ConvertToPdf\]/g)].map(m => m[1]);
const regStr = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const runFlag = flag => { const t0 = Date.now(); const r = spawnSync(exe, [flag], { env, stdio: 'ignore', timeout: 20000 }); return { status: r.status, ms: Date.now() - t0 }; };
const ourProcesses = () => Number(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
  `@(Get-Process -Name pdf-viewer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' }).Count`], { encoding: 'utf8' }).trim());
const unlock = () => { try { execFileSync('icacls', [LOCKED, '/remove:d', ME], { stdio: 'ignore' }); } catch {} };

// 测试文件夹：每次重建
unlock();
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(LOCKED, { recursive: true });
for (const n of ['照片-EXIF方向6.jpg', '透明.png', '说明.md', '插图.jpg', '报告.docx']) fs.copyFileSync(path.join(CV, n), path.join(W, n));
fs.writeFileSync(path.join(W, '已有.txt'), '旁边已经有一份同名的 PDF，转出来的应该叫「已有 (1).pdf」。\n');
fs.writeFileSync(path.join(W, '已有.pdf'), '原来就有的文件，不能被覆盖');
const keep = sha(path.join(W, '已有.pdf'));
fs.writeFileSync(path.join(LOCKED, '锁住.txt'), '这个文件夹不让写，转出来的 PDF 存不进去。\n');
fs.rmSync(testData, { recursive: true, force: true });
fs.mkdirSync(testData, { recursive: true });
spawnSync('reg', ['delete', REG_ROOT, '/f'], { stdio: 'ignore' });

let ws, seq = 0;
const procs = [], pending = new Map(), logs = [];
try {
  // 1. 安装程序用的开关
  const reg1 = runFlag('--register-shell-menu');
  const text = regText(), exts = verbExts(text);
  const docx = text.split(/\r?\n\r?\n/).filter(s => s.includes('\\.docx\\shell\\PDFViewer.ConvertToPdf')).join('\n');
  const cmd = `"${exe}" --convert "%1"`;
  check('安装时注册：每种文件类型一项「转成 PDF」，不开窗口', reg1.status === 0 && reg1.ms < 8000 && exts.length >= 40 && ['jpg', 'png', 'tif', 'heic', 'docx', 'xlsx', 'pptx', 'md', 'csv', 'html', 'txt'].every(e => exts.includes(e)) && !exts.includes('pdf')
    && docx.includes('"MUIVerb"="转成 PDF"') && docx.includes('"MultiSelectModel"="Player"') && docx.includes(`"Icon"="${regStr(`"${exe}",0`)}"`) && docx.includes(`@="${regStr(cmd)}"`),
  JSON.stringify({ ...reg1, exts: exts.length, docx: docx.slice(0, 600) }));
  const unreg1 = runFlag('--unregister-shell-menu');
  check('卸载时删掉', unreg1.status === 0 && verbExts(regText()).length === 0, JSON.stringify(unreg1));

  // 2. 程序没开着：像资源管理器多选那样同时启动 5 个 --convert
  const first = ['照片-EXIF方向6.jpg', '透明.png', '说明.md', '报告.docx', '已有.txt'];
  for (const n of first) procs.push(spawn(exe, ['--convert', path.join(W, n)], { env, stdio: 'ignore' }));
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
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
  let placed = false;
  for (let i = 0; i < 20 && !placed; i++) { try { placed = await offscreenOk('刚启动'); break; } catch { await sleep(150); } }
  if (!placed) throw new Error('窗口不在屏幕外');
  for (let i = 0; i < 40; i++) { await sleep(250); if (await evaluate('!!window.__pv').catch(() => false)) break; }
  await evaluate(`window.__sm = {
    toasts: () => [...document.querySelectorAll('.toast .tx')].map(x => x.textContent),
    tabs: () => __pv.state.tabs.map(t => ({ name: t.name, path: t.path, loading: t.loading, dirty: __pv.isDirty(t), pages: t.numPages, converted: t.converted })),
  }, true`);
  // 等：要么 n 个标签页都载好，要么出现「没找到能打开它的软件」之类的出错提示（这时少一个）
  const waitTabs = async (n, ms = 150000) => {
    const t0 = Date.now();
    let s;
    while (Date.now() - t0 < ms) {
      s = JSON.parse(await evaluate(`JSON.stringify({ tabs: __sm.tabs(), toasts: __sm.toasts(), busy: !!document.querySelector('#dlg[open]') })`));
      const errs = s.toasts.filter(t => /没转成|没能存到/.test(t)).length;
      if (!s.busy && s.tabs.length + errs >= n && s.tabs.every(t => !t.loading)) return s;
      await sleep(400);
    }
    return { ...s, timeout: true };
  };
  const cold = await waitTabs(first.length);
  const noOffice = cold.toasts.some(t => /报告\.docx.*没找到能打开它的软件/.test(t));
  const want = ['照片-EXIF方向6.pdf', '透明.pdf', '说明.pdf', ...(noOffice ? [] : ['报告.pdf']), '已有 (1).pdf'];
  await sleep(1500);                                      // 等另外几个进程都退出
  const alive = ourProcesses();
  const outs = want.filter(n => fs.existsSync(path.join(W, n)));
  const tabNames = cold.tabs.map(t => t.name).sort();
  check('程序没开着时多选右键「转成 PDF」：只留一个程序，全都存到源文件旁边并打开', alive === 1 && outs.length === want.length && want.every(n => fs.readFileSync(path.join(W, n)).subarray(0, 5).toString() === '%PDF-')
    && tabNames.join('|') === [...want].sort().join('|') && cold.tabs.every(t => t.path?.startsWith(W) && !t.dirty && t.pages >= 1) && cold.toasts.some(t => /转好了/.test(t)),
  JSON.stringify({ alive, outs, cold: { ...cold, tabs: cold.tabs.map(t => [t.name, t.dirty, t.pages]) }, noOffice }));
  check('已经有同名 PDF：存成「已有 (1).pdf」，原来的不动', fs.existsSync(path.join(W, '已有 (1).pdf')) && sha(path.join(W, '已有.pdf')) === keep);
  if (noOffice) check('Word 文档（右键转）', null, '本机没装 Office、WPS 或 LibreOffice');
  await shot('shell-1-cold.png');

  // 3. 开着时再右键：同一个文件再转一次；源文件夹不让写的
  execFileSync('icacls', [LOCKED, '/deny', `${ME}:(WD)`], { stdio: 'ignore' });
  const before = cold.tabs.length;
  for (const f of [path.join(W, '照片-EXIF方向6.jpg'), path.join(LOCKED, '锁住.txt')]) procs.push(spawn(exe, ['--convert', f], { env, stdio: 'ignore' }));
  const warm = await waitTabs(before + 2, 60000);
  unlock();
  const added = warm.tabs.slice(before);
  const again = added.find(t => t.name === '照片-EXIF方向6 (1).pdf'), locked = added.find(t => t.name === '锁住.pdf');
  check('开着时再右键转同一个文件：存成「(1)」', !!again && again.path === path.join(W, '照片-EXIF方向6 (1).pdf') && !again.dirty && fs.existsSync(again.path), JSON.stringify(added));
  check('源文件夹不让写：开成没保存的标签页并提示', !!locked && locked.dirty && !locked.path && locked.converted?.dir === LOCKED && warm.toasts.some(t => /锁住\.pdf.*没能存到源文件旁边/.test(t))
    && fs.readdirSync(LOCKED).join('|') === '锁住.txt', JSON.stringify({ locked, toasts: warm.toasts, files: fs.readdirSync(LOCKED) }));
  check('转完只剩一个程序', ourProcesses() === 1);
  await shot('shell-2-warm.png');

  // 4. ⋯ 菜单的开关（点真正的菜单项），关掉后安装程序不再加回来
  const menuItem = `[...document.querySelectorAll('.menu .mi')].find(b => /右键菜单里的「转成 PDF」/.test(b.textContent))`;
  const toggle = async () => JSON.parse(await evaluate(`(async () => {
    document.querySelector('#tbMore').click();
    await new Promise(r => setTimeout(r, 300));
    const b = ${menuItem}, was = b?.classList.contains('on');
    b?.click();
    const st = await __TAURI__.core.invoke('shell_menu_status');
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if ((await __TAURI__.core.invoke('shell_menu_status')).installed !== st.installed) break; }
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ found: !!b, was, status: await __TAURI__.core.invoke('shell_menu_status'), toasts: __sm.toasts() });
  })()`));
  const marker = path.join(testData, 'shell-menu-off');
  const on1 = await toggle();
  const reg2 = verbExts(regText());
  const convertible = JSON.parse(await evaluate(`(async () => { const cv = await import('./js/convert.js'); const s = await __TAURI__.core.invoke('shell_menu_status'); return JSON.stringify(s.exts.filter(e => !cv.canConvert('x.' + e))); })()`));
  check('⋯ 菜单里打开：注册上，指向这个程序，类型都是能转的', on1.found && on1.was === false && on1.status.installed && on1.status.current && reg2.length === on1.status.exts.length && convertible.length === 0
    && on1.toasts.some(t => /加好了/.test(t)), JSON.stringify({ ...on1, reg: reg2.length, convertible }));
  const off1 = await toggle();
  const reinstall = runFlag('--register-shell-menu');
  check('⋯ 菜单里关掉：删掉并留记号，安装程序再注册时跳过', off1.was === true && !off1.status.installed && fs.existsSync(marker) && reinstall.status === 0 && verbExts(regText()).length === 0,
    JSON.stringify({ ...off1, reinstall, marker: fs.existsSync(marker) }));
  const on2 = await toggle();
  const unreg2 = runFlag('--unregister-shell-menu');
  check('再打开：去掉记号；卸载时删掉', on2.was === false && on2.status.current && !fs.existsSync(marker) && unreg2.status === 0 && verbExts(regText()).length === 0,
    JSON.stringify({ ...on2, unreg2 }));

  check('窗口始终在屏幕外、没最大化、没抢焦点', geo.every(g => g.x < -5000 && !g.max && !g.full && !g.focused), JSON.stringify(geo));
  const errs = logs.filter(l => /^\[(error|exception)\]/.test(l) || /Content Security Policy|Refused to/.test(l));
  check('控制台没有报错（含 CSP 拦截）', errs.length === 0, errs.slice(0, 8).join(' || '));
  if (logs.length) fs.writeFileSync(path.join(shots, 'shell-console.log'), logs.join('\n'));
} catch (e) {
  check('右键菜单测试本身', false, e.message);
} finally {
  try { ws?.close(); } catch {}
  for (const p of procs) { try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  unlock();
  spawnSync('reg', ['delete', REG_ROOT, '/f'], { stdio: 'ignore' });
  await sleep(500);
}
const fail = results.filter(r => r.ok === false).length, skip = results.filter(r => r.ok === null).length;
console.log(fail ? `\n${fail} 项没通过` : `\n全部通过${skip ? `（${skip} 项跳过）` : ''}`);
process.exit(fail ? 1 : 0);
