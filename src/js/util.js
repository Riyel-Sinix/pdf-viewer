// 小工具
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const stripExt = name => String(name || '').replace(/\.pdf$/i, '');
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

export function fmtSize(b) {
  if (b == null || !isFinite(b)) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 2 : 1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// 「今天 14:05」「昨天」「3 天前」「10月5日」「2025年3月2日」
export function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const day = x => Math.floor((x.getTime() - x.getTimezoneOffset() * 6e4) / 864e5);
  const diff = day(now) - day(d), hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff <= 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  if (diff < 7) return `${diff} 天前`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtDateTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function debounce(fn, ms) {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
}

let uid = 0;
export const nextId = (p = 'id') => `${p}${++uid}`;

export function canvasToBlobURL(canvas, type = 'image/jpeg', q = 0.82) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : ''), type, q));
}
