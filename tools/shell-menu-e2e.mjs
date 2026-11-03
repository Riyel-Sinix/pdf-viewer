// Windows 11 右键菜单第一层的端到端测试：开发者模式下把稀疏包（测试专用的名字、发布者、CLSID，见 identity.json）登记给当前用户（不用管理员），
// 安装文件夹用和真的一样带空格、中文的名字。
// 1. 像资源管理器那样通过 COM 代理（dllhost）调「转成 PDF」：看假程序（probe，装成 pdf-viewer.exe）收到的参数、
//    它写的 AppData 和注册表是不是落在平常的位置（没被重定向进包的文件夹）。
// 2. 装新版时：被 COM 代理占着的旧 DLL 能改名挪开，新的装得进去（安装包的 hooks.nsh 就这么做）。
// 3. 换上真正的程序（测试模式），试安装包用的 --shell-package-needed、--register-shell-menu、--add-shell-package、--remove-shell-package：
//    包登记好了就不再要、旧式菜单去掉；不用管理员去掉包，COM 代理随之退出，DLL 删得掉。
// 不碰真正的程序设置和用户的右键菜单（注册表只写测试专用的 HKCU\Software\PDFViewerTest）；测完去掉登记、停掉代理进程、删掉临时文件。
// 需要 Windows 11 和开发者模式。真正的安装方式（没签名的 .msix + 管理员确认）只能用安装包测。
//   node tools/build-shell-menu.mjs --test && node tools/shell-menu-e2e.mjs [程序路径，默认 src-tauri/target/release/pdf-viewer.exe]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IDENTITY, OUT, packMsix, stagePackage } from './build-shell-menu.mjs';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const E = path.join(root, '.cache', 'shell-e2e'), APP = path.join(E, 'PDF 查看器'), PKG = path.join(E, 'pkg'), FILES = path.join(E, 'files'), DATA = path.join(E, 'data');
const DLL = path.join(APP, 'shell-menu', 'pdf_viewer_shell.dll');
const realExe = path.resolve(process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'pdf-viewer.exe'));
const NAME = IDENTITY.test_name;
// probe 往这两处写标记（测试专用，测完删掉）
const MARK_DIR = path.join(process.env.LOCALAPPDATA, 'com.siiocc.pdfviewer.e2etest'), MARK_KEY = 'Software\\PDFViewerTest\\ShellE2E';
const marks = [];
const ps = cmd => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${cmd}`], { encoding: 'utf8', timeout: 60000 });
const clearMarks = () => { fs.rmSync(MARK_DIR, { recursive: true, force: true }); for (const f of marks) fs.rmSync(f, { force: true }); ps(`Remove-Item -Path 'HKCU:\\${MARK_KEY}' -Recurse -ErrorAction SilentlyContinue`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const registered = () => ps(`@(Get-AppxPackage -Name '${NAME}').Count`).stdout.trim();
const unregister = () => ps(`Get-AppxPackage -Name '${NAME}' | Remove-AppxPackage`);
// 加载了测试文件夹里的 DLL 的 COM 代理（dllhost）有几个；freeDll 停掉它们
const HOLDERS = `Get-Process dllhost -ErrorAction SilentlyContinue | Where-Object { $_.Modules | Where-Object { $_.FileName -like '*\\shell-e2e\\*' } }`;
const holders = () => Number(ps(`@(${HOLDERS}).Count`).stdout.trim() || 0);
const freeDll = () => ps(`${HOLDERS} | Stop-Process -Force`);
// 真正的程序以测试模式跑安装包用的开关：用测试包的名字和发布者、测试的注册表位置和数据文件夹
const env = { ...process.env, PDFVIEWER_TEST_OFFSCREEN: '1', PDFVIEWER_TEST_DATA: DATA };
const app = flag => spawnSync(path.join(APP, 'pdf-viewer.exe'), [flag], { env, stdio: 'ignore', timeout: 120000 }).status;
const TEST_VERB = 'HKCU:\\Software\\PDFViewerTest\\Classes\\SystemFileAssociations\\.docx\\shell\\PDFViewer.ConvertToPdf';
for (const f of ['probe.exe', 'e2e.exe', 'pdf_viewer_shell.dll']) {
  if (!fs.existsSync(path.join(OUT, 'release', f))) { console.error('先运行 node tools/build-shell-menu.mjs --test'); process.exit(2); }
}

try {
  unregister();
  freeDll();
  clearMarks();
  fs.rmSync(E, { recursive: true, force: true });
  for (const d of [path.join(APP, 'shell-menu'), FILES, DATA]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(OUT, 'release', 'probe.exe'), path.join(APP, 'pdf-viewer.exe'));
  fs.copyFileSync(path.join(OUT, 'release', 'pdf_viewer_shell.dll'), DLL);
  stagePackage(PKG, { test: true });      // 测试包：自己的名字、普通的发布者（开发者模式登记清单不认「没签名」的 OID）、测试专用的 CLSID
  const [jpg, md, pdf] = ['天真 照片.jpg', '说明.md', '原来.pdf'].map(n => path.join(FILES, n));
  for (const f of [jpg, md, pdf]) fs.writeFileSync(f, 'x');

  const reg = ps(`Add-AppxPackage -Register '${path.join(PKG, 'AppxManifest.xml')}' -ExternalLocation '${APP}'`);
  const info = JSON.parse(ps(`Get-AppxPackage -Name '${NAME}' | Select-Object Name, Version, InstallLocation, Status | ConvertTo-Json -Compress`).stdout.trim() || 'null');
  check('清单能登记（开发者模式）', reg.status === 0 && info?.Name === NAME,
    JSON.stringify({ err: (reg.stderr || '').trim().slice(0, 400), info }));

  // 1. 像资源管理器那样调
  const r = spawnSync(path.join(OUT, 'release', 'e2e.exe'), [jpg, md, '--', pdf], { encoding: 'utf8', timeout: 60000 });
  let res = {};
  try { res = JSON.parse(r.stdout.trim()); } catch { res = { error: r.stdout || r.stderr || String(r.error) }; }
  check('通过 COM 代理（dllhost）创建命令：标题「转成 PDF」、图标是程序的', res.title === '转成 PDF' && (res.icon || '').toLowerCase() === `${path.join(APP, 'pdf-viewer.exe')},0`.toLowerCase(), JSON.stringify(res));
  check('能转的显示，不能转的、混着不能转的不显示', res.state_ok === 0 && res.state_bad === 2 && res.state_mixed === 2);

  let probe = null;
  const pj = path.join(APP, 'probe.json');
  for (let i = 0; i < 50 && !probe; i++) { await sleep(200); if (fs.existsSync(pj)) probe = fs.readFileSync(pj, 'utf8').trim().split('\n').map(l => JSON.parse(l)); }
  const got = probe?.[0];
  const same = (a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
  check('点了以后启动一次程序：--convert 加上所有选中的文件', probe?.length === 1 && same(got.args, ['--convert', jpg, md]), JSON.stringify(probe));
  // 程序带着包身份（got.packaged，Windows 11 第一层菜单启动的都这样）没关系，要紧的是它写的文件落在平常的位置
  const regMarker = ps(`(Get-ItemProperty -Path 'HKCU:\\${MARK_KEY}' -Name Marker -ErrorAction SilentlyContinue).Marker`).stdout.trim();
  // probe 报告它写到了哪（写成功了 err 是 null）；从外面（没带包身份的这个进程）看得见才算没被重定向
  const seen = m => !!m && m.err === null && fs.existsSync(m.path);
  for (const m of [got?.local, got?.temp]) if (m?.path) marks.push(m.path);
  check('启动的程序写的 AppData 和临时文件夹都在平常的位置（没被重定向进包的文件夹）', seen(got?.local) && seen(got?.temp),
    JSON.stringify({ packaged: got?.packaged, local: got?.local, temp: got?.temp, local_seen: seen(got?.local), temp_seen: seen(got?.temp) }));
  // 注册表：清单里关了也还是被重定向（Windows 11 26300 实测），程序从右键菜单启动时不靠写注册表，这里只记录
  console.log(`INFO  它写的注册表${got?.reg === 0 && regMarker === 'probe' ? '没被' : '被'}重定向（写入结果 ${got?.reg}，外面读到「${regMarker}」）`);

  // 2. 装新版：COM 代理占着旧 DLL 时，改名挪开再放新的
  const held = holders();
  let replaced = false, err = '';
  try { fs.renameSync(DLL, DLL.replace(/\.dll$/, '.1.old')); fs.copyFileSync(path.join(OUT, 'release', 'pdf_viewer_shell.dll'), DLL); replaced = true; } catch (e) { err = e.message; }
  check('装新版时：COM 代理占着的旧 DLL 能改名挪开，新的装得进去', held > 0 && replaced, JSON.stringify({ held, err }));

  // 3. 真正的程序：安装包用的那几个开关
  if (!fs.existsSync(realExe)) {
    console.log(`SKIP  安装包用的开关（没找到程序 ${realExe}，先 npx tauri build）`);
  } else {
    fs.copyFileSync(realExe, path.join(APP, 'pdf-viewer.exe'));
    // 测试包的 msix，按正式的那样没签名（发布者带 OID）：--add-shell-package 不用管理员时应该被拒（要管理员），也不会登记上任何东西
    const stage = path.join(E, 'stage');
    stagePackage(stage, { test: true, publisher: IDENTITY.publisher.replace(/^CN=[^,]+/, 'CN=PDF Viewer E2E Test') });
    packMsix(stage, path.join(APP, 'shell-menu', 'PDFViewer.ShellMenu.msix'));

    check('包登记好了（这一版、指向安装文件夹）：--shell-package-needed 说不用再登记', app('--shell-package-needed') === 1);
    ps(`New-Item -Path '${TEST_VERB}\\command' -Force | Out-Null`);
    const regStatus = app('--register-shell-menu');
    const classicLeft = ps(`Test-Path '${TEST_VERB}'`).stdout.trim();
    check('包登记好了：--register-shell-menu 去掉旧式菜单（不然「显示更多选项」里有两个）', regStatus === 0 && classicLeft === 'False', JSON.stringify({ regStatus, classicLeft }));

    const removeStatus = app('--remove-shell-package');
    let left = registered(), heldAfter = holders();
    for (let i = 0; i < 20 && heldAfter > 0; i++) { await sleep(250); heldAfter = holders(); }
    let deleted = false;
    try { for (const f of fs.readdirSync(path.join(APP, 'shell-menu')).filter(f => /\.(dll|old)$/.test(f))) fs.rmSync(path.join(APP, 'shell-menu', f)); deleted = true; } catch (e) { err = e.message; }
    check('卸载：--remove-shell-package 不用管理员去掉包，COM 代理随之退出，DLL 删得掉', removeStatus === 0 && left === '0' && heldAfter === 0 && deleted,
      JSON.stringify({ removeStatus, left, heldAfter, err: deleted ? '' : err }));
    fs.copyFileSync(path.join(OUT, 'release', 'pdf_viewer_shell.dll'), DLL);

    // 这台电脑上「要不要登记」的答案：Windows 11、管理员账号（UAC 后还是自己）就要
    const isAdmin = /S-1-5-32-544/.test(spawnSync(path.join(process.env.SystemRoot, 'System32', 'whoami.exe'), ['/groups', '/fo', 'csv'], { encoding: 'utf8' }).stdout || '');
    const needed = app('--shell-package-needed');
    check(`没登记时：--shell-package-needed ${isAdmin ? '说要登记（管理员账号）' : '说不用（标准用户，UAC 会换成别的账号）'}`, needed === (isAdmin ? 0 : 1), JSON.stringify({ needed, isAdmin }));
    fs.writeFileSync(path.join(DATA, 'shell-menu-off'), 'x');
    check('用户关掉过右键菜单：--shell-package-needed 说不用（不弹管理员确认）', app('--shell-package-needed') === 1);
    fs.rmSync(path.join(DATA, 'shell-menu-off'));

    // 不用管理员登记没签名、带可执行内容的包会被拒（0x80073D2B）；拒在这一步说明 msix 和安装文件夹的路径（空格、中文）都认出来了
    const addStatus = app('--add-shell-package');
    const log = fs.existsSync(path.join(DATA, 'pdf-viewer-shell-menu.log')) ? fs.readFileSync(path.join(DATA, 'pdf-viewer-shell-menu.log'), 'utf8').trim().split('\n').pop() : '';
    check('不用管理员 --add-shell-package：被拒（要管理员）、记了日志，也没登记上', addStatus === 1 && /0x80073d2b/i.test(log) && registered() === '0', JSON.stringify({ addStatus, log }));
  }
} catch (e) {
  check('右键组件端到端测试本身', false, e.message);
} finally {
  unregister();
  freeDll();
  await sleep(500);
  const left = registered();
  check('测完去掉了登记', left === '0', left);
  try { fs.rmSync(E, { recursive: true, force: true }); } catch {}
  clearMarks();
  ps(`Remove-Item -Path 'HKCU:\\Software\\PDFViewerTest' -Recurse -ErrorAction SilentlyContinue`);
}
const fail = results.filter(r => !r.ok).length;
console.log(fail ? `\n${fail} 项没通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
