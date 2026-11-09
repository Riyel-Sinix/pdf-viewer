// localStorage 读写（键名都带 pv. 前缀；主题单独存成纯字符串，开窗前的 boot.js 要读）
const P = 'pv.';
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(P + k); } catch {} },
};

export function getTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
export function saveTheme(t) { try { localStorage.setItem('pv.theme', t); } catch {} }

// 偏好：背景、侧栏、页面色调、版式、编辑栏和各批注工具的默认颜色 / 粗细 / 字号、图片转 PDF 的纸张 / 方向 / 边距
const DEF_PREFS = {
  backdrop: 'day', sidebar: true, sbTab: 'thumbs', tone: 'normal', scroll: 0, spread: 0, mergeBookmarks: true, mergeOpen: true,
  editbar: false, hl: { color: '#FFE27A', width: 12 }, ink: { color: '#2B231D', width: 2, opacity: 1 }, text: { color: '#2B231D', size: 14 },
  signRemember: true, convPaper: 'a4', convOrient: 'auto', convMargin: 'narrow',
};
export const prefs = Object.assign({}, DEF_PREFS, store.get('prefs', {}));
export const savePrefs = () => store.set('prefs', prefs);

// 存下来的签名（透明底 PNG 的 data URL），最多 6 个，最近用的在前
const MAX_SIGNS = 6;
export const getSignatures = () => store.get('signatures', []);
export function addSignature(sig) {
  const list = getSignatures().filter(s => s.url !== sig.url);
  list.unshift({ ...sig, at: Date.now() });
  while (list.length > MAX_SIGNS) list.pop();
  while (list.length && !store.set('signatures', list)) list.pop();   // 存不下就丢最旧的
}
export function removeSignature(url) { store.set('signatures', getSignatures().filter(s => s.url !== url)); }

// 每份文档读到哪里（按 pdf.js 的文档指纹）：{ page, scale, rot, left, top, at }，最多留 300 份
export function getViewState(fp) { return fp ? store.get('views', {})[fp] || null : null; }
export function setViewState(fp, v) {
  if (!fp) return;
  const all = store.get('views', {});
  all[fp] = { ...v, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > 300) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - 300).forEach(k => delete all[k]);
  store.set('views', all);
}

// 最近打开（只记有路径的文件：桌面版）：{ path, name, size, pages, page, at, thumb }
const MAX_RECENT = 16;
export const getRecent = () => store.get('recent', []);
export function touchRecent(entry) {
  if (!entry.path) return;
  const list = getRecent().filter(r => r.path.toLowerCase() !== entry.path.toLowerCase());
  const old = getRecent().find(r => r.path.toLowerCase() === entry.path.toLowerCase());
  list.unshift({ ...old, ...entry, at: Date.now() });
  while (list.length > MAX_RECENT) list.pop();
  if (!store.set('recent', list)) {   // 超出配额：先丢缩略图再存
    list.forEach((r, i) => { if (i > 4) delete r.thumb; });
    store.set('recent', list);
  }
}
export function updateRecent(path, patch) {
  if (!path) return;
  const list = getRecent();
  const r = list.find(x => x.path.toLowerCase() === path.toLowerCase());
  if (!r) return;
  Object.assign(r, patch);
  store.set('recent', list);
}
export function removeRecent(path) { store.set('recent', getRecent().filter(r => r.path.toLowerCase() !== String(path).toLowerCase())); }
export function clearRecent() { store.set('recent', []); }
