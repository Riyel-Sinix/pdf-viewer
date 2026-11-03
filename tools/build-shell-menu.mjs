// Windows 11 右键菜单第一层的「转成 PDF」：编译右键组件 DLL（src-tauri/shell-menu），把稀疏包清单和图标用 Windows SDK 的 makeappx 打成 .msix。
// npx tauri build 之前自动跑（tauri.conf.json 的 beforeBuildCommand）；产物在 src-tauri/target/shell-menu，安装包把它们放进安装文件夹的 shell-menu\
// 包的名字、发布者、版本、CLSID 在 src-tauri/shell-menu/package/identity.json（程序判断装没装好也读它）
//   node tools/build-shell-menu.mjs           # DLL + msix
//   node tools/build-shell-menu.mjs --test    # 再编译端到端测试用的两个小程序（probe、e2e，见 tools/shell-menu-e2e.mjs）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
export const OUT = path.join(root, 'src-tauri', 'target', 'shell-menu');
const crate = path.join(root, 'src-tauri', 'shell-menu');
// 没签名的包：publisher 带微软规定的 OID，安装时要 AllowUnsigned（要管理员，程序的 --add-shell-package 做）。
// 端到端测试在开发者模式下直接登记清单，那样反而不认这个 OID，所以测试包用普通的 test_publisher
export const IDENTITY = JSON.parse(fs.readFileSync(path.join(crate, 'package', 'identity.json'), 'utf8'));

// DLL 认的 CLSID 要和 identity.json 一致，不然包登记得上，资源管理器却创建不了命令
const dllGuids = [...fs.readFileSync(path.join(crate, 'src', 'lib.rs'), 'utf8').matchAll(/GUID::from_u128\(0x([0-9a-f_]+)\)/gi)].map(m => m[1].replaceAll('_', '').toLowerCase());
for (const k of ['clsid', 'test_clsid']) {
  if (!dllGuids.includes(IDENTITY[k].replaceAll('-', '').toLowerCase())) throw new Error(`identity.json 的 ${k}（${IDENTITY[k]}）和 shell-menu/src/lib.rs 里的 CLSID 对不上`);
}

// 包的文件夹：填好的清单 + 图标（清单里要的三张）；test 时用测试包的名字、发布者和 CLSID；publisher 可以另给
export function stagePackage(dir, { test = false, publisher = null } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });
  const fill = {
    '{NAME}': test ? IDENTITY.test_name : IDENTITY.name,
    '{PUBLISHER}': publisher ?? (test ? IDENTITY.test_publisher : IDENTITY.publisher),
    '{VERSION}': IDENTITY.version,
    '{CLSID}': test ? IDENTITY.test_clsid : IDENTITY.clsid,
  };
  let manifest = fs.readFileSync(path.join(crate, 'package', 'AppxManifest.xml'), 'utf8');
  for (const [k, v] of Object.entries(fill)) manifest = manifest.replaceAll(k, v.replaceAll('&', '&amp;'));
  fs.writeFileSync(path.join(dir, 'AppxManifest.xml'), manifest);
  for (const f of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']) fs.copyFileSync(path.join(root, 'src-tauri', 'icons', f), path.join(dir, 'Assets', f));
}

function makeappx() {
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const vers = fs.existsSync(kits) ? fs.readdirSync(kits).filter(v => /^10\./.test(v)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).reverse() : [];
  for (const v of vers) { const p = path.join(kits, v, 'x64', 'makeappx.exe'); if (fs.existsSync(p)) return p; }
  throw new Error('找不到 makeappx.exe：需要装 Windows SDK（Visual Studio 生成工具里的「Windows SDK」）');
}

// 打成 .msix。/nv：稀疏包里没有 pdf-viewer.exe（在安装文件夹里），按普通包检查会说「文件不存在」；清单本身的格式由端到端测试登记时检查
export function packMsix(stage, msix) {
  try { execFileSync(makeappx(), ['pack', '/o', '/nv', '/d', stage, '/p', msix], { encoding: 'utf8' }); }
  catch (e) { throw new Error(String(e.stdout || '').split('\n').filter(l => /error/i.test(l)).join('\n') || e.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const test = process.argv.includes('--test');
  execFileSync('cargo', ['build', '--release', '--lib', ...(test ? ['--bins'] : []), '--manifest-path', path.join(crate, 'Cargo.toml'), '--target-dir', OUT], { stdio: 'inherit' });
  const stage = path.join(OUT, 'package');
  stagePackage(stage);
  const msix = path.join(OUT, 'PDFViewer.ShellMenu.msix');
  try { packMsix(stage, msix); } catch (e) { console.error(e.message); process.exit(1); }
  console.log(`右键组件：${path.join(OUT, 'release', 'pdf_viewer_shell.dll')}、${msix}（${IDENTITY.version}）`);
}
