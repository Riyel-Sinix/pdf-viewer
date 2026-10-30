// 平台层：桌面版（Tauri）走 Rust 命令；在普通浏览器里打开时退回到网页能力（文件选择框、下载）
const T = window.__TAURI__;
export const isDesktop = !!(T && T.core && T.core.invoke);
const invoke = isDesktop ? T.core.invoke : null;

export const basename = p => String(p).split(/[\\/]/).pop();
export const dirname = p => { const s = String(p), i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); return i > 0 ? s.slice(0, i) : ''; };

const toBytes = r => r instanceof Uint8Array ? r : r instanceof ArrayBuffer ? new Uint8Array(r) : Array.isArray(r) ? Uint8Array.from(r) : new Uint8Array(r);

/* 文件条目：{ name, path, size, read() } —— 桌面版有 path（可以记进「最近打开」），网页版只有 File */
export function entryFromPath(path) { return { name: basename(path), path, size: null, read: () => readPath(path) }; }
export function entryFromFile(file) { return { name: file.name, path: null, size: file.size, file, read: async () => new Uint8Array(await file.arrayBuffer()) }; }
export function entryFromBytes(name, bytes, path = null) { return { name, path, size: bytes.length, read: async () => bytes }; }

export async function readPath(path) { return toBytes(await invoke('read_file', { path })); }

export async function pickPdfs({ multiple = true, title = '' } = {}) {
  if (isDesktop) {
    const paths = await invoke('pick_pdfs', { multiple, title: title || null });
    return (paths || []).map(entryFromPath);
  }
  return new Promise(resolve => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.pdf,application/pdf', multiple });
    inp.addEventListener('change', () => resolve([...inp.files].map(entryFromFile)), { once: true });
    inp.addEventListener('cancel', () => resolve([]), { once: true });
    inp.click();
  });
}

// 写文件（桌面版）：先写临时文件再改名，写到一半出错不会弄坏原文件
export async function writeFile(path, bytes) {
  await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
}

// 「另存为」对话框，只问路径不写；返回路径或 null（取消）
export async function askSavePath(suggestedName, directory = '') {
  if (!/\.pdf$/i.test(suggestedName)) suggestedName += '.pdf';
  return (await invoke('save_pdf_dialog', { fileName: suggestedName, directory: directory || null })) || null;
}

// 选图片（插入批注图片 / 图片做成新页面）：两边都用网页的文件选择框，桌面版会弹出系统对话框；返回 File 列表
export function pickImages({ multiple = false } = {}) {
  return new Promise(resolve => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml', multiple });
    inp.addEventListener('change', () => resolve([...inp.files]), { once: true });
    inp.addEventListener('cancel', () => resolve([]), { once: true });
    inp.click();
  });
}

// 弹出「另存为」并写入；返回 { path, name } 或 null（用户取消）
export async function savePdf(bytes, suggestedName, directory = '') {
  if (!/\.pdf$/i.test(suggestedName)) suggestedName += '.pdf';
  if (isDesktop) {
    const path = await askSavePath(suggestedName, directory);
    if (!path) return null;
    await writeFile(path, bytes);
    return { path, name: basename(path) };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { path: null, name: suggestedName };
}

export function openExternal(url) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isDesktop) invoke('open_external', { url }).catch(() => {});
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export function revealInFolder(path) { if (isDesktop && path) invoke('reveal_in_folder', { path }).catch(() => {}); }
export async function pathsExist(paths) { return isDesktop && paths.length ? invoke('paths_exist', { paths }) : paths.map(() => true); }
export async function takeInitialFiles() { return isDesktop ? (await invoke('take_initial_files')).map(entryFromPath) : []; }

// 已经开着时，再从资源管理器「打开方式」或命令行打开 PDF：单实例插件把路径转发过来
export function onExternalOpen(cb) { if (isDesktop) T.event.listen('open-files', e => cb((e.payload || []).map(entryFromPath))); }

// 桌面版的拖放由系统接管（能拿到路径）；返回 false 表示要用网页的 HTML5 拖放。位置换算成 CSS 像素
export function onNativeDragDrop({ enter, leave, drop }) {
  if (!isDesktop) return false;
  const at = p => (p && Number.isFinite(p.x) ? { x: p.x / (devicePixelRatio || 1), y: p.y / (devicePixelRatio || 1) } : null);
  T.event.listen('tauri://drag-enter', e => enter(e.payload?.paths || []));
  T.event.listen('tauri://drag-leave', () => leave());
  T.event.listen('tauri://drag-drop', e => drop((e.payload?.paths || []).map(entryFromPath), at(e.payload?.position)));
  return true;
}

const W = isDesktop ? T.window.getCurrentWindow() : null;
export const win = {
  minimize() { W?.minimize(); },
  toggleMaximize() { W?.toggleMaximize(); },
  close() { if (W) W.close(); else window.close(); },
  isMaximized() { return W ? W.isMaximized() : Promise.resolve(false); },
  onResized(cb) { if (W) W.onResized(cb); else addEventListener('resize', cb); },
  async setFullscreen(on) {
    if (W) return W.setFullscreen(on);
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {}
  },
  setTitle(t) { document.title = t; W?.setTitle(t).catch(() => {}); },
  startResize(dir) { W?.startResizeDragging(dir).catch(() => {}); },
  async showIfHidden() { if (W && !(await W.isVisible())) await W.show(); },
  // 关窗前：有没保存的修改就先问（confirm 返回 true 才关）。桌面版拦系统的关闭请求；网页版只能用浏览器自带的 beforeunload 提示
  onCloseRequested({ hasUnsaved, confirm }) {
    if (W) {
      W.onCloseRequested(async e => {
        if (!hasUnsaved()) return;                 // 不拦：Tauri 接着关窗
        e.preventDefault();
        let ok = true;
        try { ok = await confirm(); } catch (err) { console.error(err); }
        if (ok) await W.destroy();
      });
    } else {
      addEventListener('beforeunload', e => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
    }
  },
};
