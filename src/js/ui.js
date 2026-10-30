// 对话框、提示、弹出菜单
import { $, esc } from './util.js';
import { icon } from './icons.js';

/* ---------- 对话框（全局只有一个 <dialog>） ---------- */
const dlg = $('#dlg');
let dlgResolve = null, dlgDismiss = true, dlgOnClose = null;

export function openDialog({ html, cls = '', dismissable = true, onOpen, onClose } = {}) {
  if (dlg.open) closeDialog(null);
  dlg.className = cls;
  dlg.innerHTML = html;
  dlgDismiss = dismissable;
  dlgOnClose = onClose || null;
  return new Promise(resolve => {
    dlgResolve = resolve;
    dlg.showModal();
    dlg.scrollTop = 0;
    onOpen?.(dlg);
    const auto = dlg.querySelector('[autofocus]');
    if (auto) { auto.focus(); auto.select?.(); }
  });
}
export function closeDialog(value = null) {
  if (!dlg.open) return;
  const r = dlgResolve, oc = dlgOnClose;
  dlgResolve = null; dlgOnClose = null;
  dlg.close();
  dlg.innerHTML = '';
  oc?.(value);
  r?.(value);
}
export const dialogOpen = () => dlg.open;
dlg.addEventListener('click', e => {
  const b = e.target.closest('[data-dlg]');
  if (b && dlg.contains(b)) { e.preventDefault(); closeDialog(b.dataset.dlg); }
});
dlg.addEventListener('mousedown', e => {      // 点遮罩关闭
  if (e.target !== dlg || !dlgDismiss) return;
  const r = dlg.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(null);
});
dlg.addEventListener('cancel', e => { e.preventDefault(); if (dlgDismiss) closeDialog(null); });

export function dlgHead(title, { sub = '', k = '', sw = '' } = {}) {
  return `<div class="dlg-h"${sw ? ` style="--sw:${sw}"` : ''}><span class="sw"></span><div>${k ? `<div class="k">${esc(k)}</div>` : ''}<h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div></div>`;
}

export async function confirmDlg({ title, body = '', ok = '确定', cancel = '取消', danger = false, k = '' }) {
  const v = await openDialog({
    html: `${dlgHead(title, { k, sw: danger ? 'var(--red)' : '' })}${body ? `<div class="dlg-b">${body}</div>` : ''}
      <div class="dlg-f"><button class="btn ghost" data-dlg="">${esc(cancel)}</button><button class="btn${danger ? ' danger' : ''}" data-dlg="ok" autofocus>${esc(ok)}</button></div>`,
  });
  return v === 'ok';
}

export function alertDlg({ title, body = '', ok = '知道了', k = '', sw = '' }) {
  return openDialog({
    html: `${dlgHead(title, { k, sw })}${body ? `<div class="dlg-b">${body}</div>` : ''}<div class="dlg-f"><button class="btn" data-dlg="ok" autofocus>${esc(ok)}</button></div>`,
  });
}

// 加了密码的 PDF：返回密码，取消返回 null
export function askPassword(name, wrong = false) {
  let val = '';
  return openDialog({
    html: `${dlgHead('这份文件有密码', { k: 'A Locked Book', sub: name, sw: 'var(--warn)' })}
      <form class="field" id="pwForm"><input type="password" id="pwIn" placeholder="输入打开密码" autocomplete="off" autofocus>
      <div class="err">${wrong ? '密码不对，再试一次' : ''}</div></form>
      <div class="dlg-f"><button class="btn ghost" data-dlg="">取消</button><button class="btn" id="pwOk">打开</button></div>`,
    onOpen(d) {
      const inp = d.querySelector('#pwIn');
      const go = e => { e.preventDefault(); val = inp.value; closeDialog('ok'); };
      d.querySelector('#pwForm').addEventListener('submit', go);
      d.querySelector('#pwOk').addEventListener('click', go);
    },
  }).then(v => (v === 'ok' ? val : null));
}

/* ---------- 提示 ---------- */
const toasts = $('#toasts');
export function toast(text, { kind = 'info', actions = [], ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="ic">${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'ok' : 'feather', 18)}</span><span class="tx">${esc(text)}</span>`
    + (actions.length ? `<span class="acts2">${actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</span>` : '');
  const close = () => { if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) { actions[+b.dataset.i].fn(); close(); }
  });
  toasts.append(el);
  while (toasts.children.length > 4) toasts.firstElementChild.remove();
  let t = ms ? setTimeout(close, ms + actions.length * 2500) : 0;
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => { if (ms) t = setTimeout(close, 1800); });
  return { close };
}

/* ---------- 弹出菜单 ----------
 * items: { label, icon, kbd, on, disabled, act } | '-' | { head } */
let curMenu = null;
export function closeMenu() {
  if (!curMenu) return;
  const m = curMenu;
  curMenu = null;
  m.el.remove();
  removeEventListener('pointerdown', m.outside, true);
  removeEventListener('keydown', m.key, true);
  removeEventListener('blur', closeMenu);
  removeEventListener('resize', closeMenu);
  m.onClose?.();
}
export function showMenu(at, items, { align = 'start', onClose } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  const acts = [];
  el.innerHTML = items.filter(Boolean).map(it => {
    if (it === '-') return '<div class="ms"></div>';
    if (it.head) return `<div class="mh">${esc(it.head)}</div>`;
    acts.push(it);
    return `<button class="mi${it.on ? ' on' : ''}" role="menuitem" data-i="${acts.length - 1}"${it.disabled ? ' disabled' : ''}>
      <span class="ic">${it.on ? icon('check', 16, 2) : it.icon ? icon(it.icon, 17) : ''}</span><span class="lb">${esc(it.label)}</span>${it.kbd ? `<span class="ks">${esc(it.kbd)}</span>` : ''}</button>`;
  }).join('');
  document.body.append(el);
  // 定位：贴着按钮下方，放不下就翻到上方 / 往左挪
  let x, y, r = null;
  if (at instanceof Element) { r = at.getBoundingClientRect(); x = align === 'end' ? r.right : r.left; y = r.bottom + 6; } else { x = at.x; y = at.y; }
  const mw = el.offsetWidth, mh = el.offsetHeight, vw = innerWidth, vh = innerHeight;
  if (align === 'end' && r) x -= mw;
  if (x + mw > vw - 8) x = vw - 8 - mw;
  if (y + mh > vh - 8) y = r ? Math.max(8, r.top - 6 - mh) : Math.max(8, vh - 8 - mh);
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
  const btns = [...el.querySelectorAll('.mi:not(:disabled)')];
  let hot = -1;
  const setHot = i => { btns.forEach((b, j) => b.classList.toggle('hot', j === i)); hot = i; btns[i]?.focus({ preventScroll: true }); };
  el.addEventListener('click', e => {
    const b = e.target.closest('.mi');
    if (!b || b.disabled) return;
    const it = acts[+b.dataset.i];
    closeMenu();
    it.act?.();
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
  const m = {
    el, onClose,
    outside: e => { if (!el.contains(e.target) && !(r && at.contains?.(e.target))) closeMenu(); },
    key: e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHot((hot + 1) % btns.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHot((hot - 1 + btns.length) % btns.length); }
      else if (e.key === 'Enter' && hot >= 0) { e.preventDefault(); btns[hot].click(); }
    },
  };
  curMenu = m;
  setTimeout(() => {
    if (curMenu !== m) return;
    addEventListener('pointerdown', m.outside, true);
    addEventListener('keydown', m.key, true);
    addEventListener('blur', closeMenu);
    addEventListener('resize', closeMenu);
  });
  return m;
}
export const menuOpen = () => !!curMenu;
