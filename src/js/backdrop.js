// 背景：窗口最底下铺的画（#dayplate）。默认「今日之诗」——和课表站同一天同一首诗的 Copy Z 原版插图，每天换一幅；
// 也能换成 Chrome 主题（Riyel-Sinix/chrome-blake-theme）的三幅水彩（tools/make-backdrops.py 做的 assets/backdrops/）、
// 素纸（不放画，只留水彩晕染），或者自己的一张图片（缩到长边 2560 存进 IndexedDB：localStorage 放不下）。
// 选的是哪个记在 prefs.backdrop。夜间（经验之歌）把画压暗，阅读、合并时淡下去：见 app.css 的 .dayplate
import { $, esc } from './util.js';
import { icon } from './icons.js';
import { prefs, savePrefs } from './store.js';
import { openDialog, dlgHead, toast } from './ui.js';
import { pickImages } from './platform.js';
import { todayPoem } from './home.js';

// fit：cover 铺满窗口（横幅）；tall 按窗口高度居中（竖幅），两边露出主题的水彩晕染（自己的图片是糊开的同一张图）
export const BACKDROPS = [
  { id: 'day', name: '今日之诗', en: 'The plate of the day', note: '布莱克原版插图，每天换一幅' },
  { id: 'roses', name: '玫瑰与新月', en: 'Roses & the crescent', note: '河边的村庄', fit: 'cover' },
  { id: 'lane', name: '乡间小路', en: 'The lane & the fold', note: '羊群、石墙和教堂', fit: 'cover' },
  { id: 'border', name: '花边插页', en: 'A bordered leaf', note: '竖幅，窗口窄时最好看', fit: 'tall' },
  { id: 'plain', name: '素纸', en: 'Plain paper', note: '不放画，只留水彩晕染' },
  { id: 'custom', name: '自己的图片', en: 'One of your own', note: '选一张图片…' },
];
export const currentBackdrop = () => (BACKDROPS.some(b => b.id === prefs.backdrop) ? prefs.backdrop : 'day');

/* ---------- 自己的图片：IndexedDB「pv」库 kv 表里的 backdrop = { blob, w, h, name, at } ---------- */
let dbp = null;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('pv', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode), q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
let custom = null;          // { url, w, h, name, at }：object URL 跟着存的那张走，换了才重新建
async function customImage() {
  let v = null;
  try { v = await kv('readonly', s => s.get('backdrop')); } catch (e) { console.warn(e); }
  if (!v?.blob) return null;
  if (custom?.at !== v.at) {
    const old = custom?.url;
    if (old) setTimeout(() => URL.revokeObjectURL(old), 3000);     // 旧的那层还在淡出
    custom = { url: URL.createObjectURL(v.blob), w: v.w, h: v.h, name: v.name, at: v.at };
  }
  return custom;
}
// 选一张图：太大的缩到长边 2560（透明的地方垫上纸色）存成 JPEG；取消或打不开返回 null
async function chooseCustom() {
  const [file] = await pickImages();
  if (!file) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('看不出图片的大小');
    const s = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    g.fillStyle = '#F3E7CB';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) throw new Error('图片太大了');
    await kv('readwrite', s2 => s2.put({ blob, w, h, name: file.name, at: Date.now() }, 'backdrop'));
    return await customImage();
  } catch (e) {
    toast(`这张图片用不了：${file.name}${e?.name === 'EncodingError' ? '（不是能显示的图片）' : e?.message ? '（' + e.message + '）' : ''}`, { kind: 'err' });
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- 铺上去：新的一层载好了再淡入，旧的淡出 ---------- */
let shown = null, seq = 0;  // shown：现在铺着的那一幅（'day:04'、'roses'、'custom:<时间>'、'plain'）
export async function renderBackdrop() {
  const my = ++seq;
  let id = currentBackdrop(), spec = null;
  if (id === 'custom') {
    const c = await customImage();
    if (my !== seq) return;
    if (c) spec = { key: 'custom:' + c.at, kind: 'pic', fit: c.h > c.w * 1.15 ? 'tall' : 'cover', art: c.url, fill: c.url, blur: true };
    else id = 'day';                                                // 存的图片没了：退回默认
  }
  if (id === 'day') {
    const p = todayPoem().p;
    spec = { key: 'day:' + p, kind: 'poem', art: `assets/plates/${p}.jpg`, fill: `assets/plates/s/${p}.jpg` };
  } else if (id !== 'custom' && id !== 'plain') {
    spec = { key: id, kind: 'pic', fit: BACKDROPS.find(b => b.id === id).fit, art: `assets/backdrops/${id}.jpg` };
  }
  show(spec);
}
function show(spec) {
  const key = spec?.key || 'plain', box = $('#dayplate');
  if (key === shown) return;
  shown = key;
  const fadeOut = () => box.querySelectorAll('.lay:not(.out)').forEach(o => { o.classList.add('out'); o.classList.remove('on'); setTimeout(() => o.remove(), 1500); });
  if (!spec) { box.dataset.kind = 'plain'; fadeOut(); return; }
  const img = new Image();
  img.onload = () => {
    if (shown !== key) return;                                      // 载好之前又换了
    const lay = document.createElement('div');
    lay.className = `lay ${spec.kind}${spec.fit ? ' fit-' + spec.fit : ''}`;
    lay.innerHTML = `${spec.fill ? `<img class="fill${spec.blur ? ' blur' : ''}" src="${esc(spec.fill)}" alt="">` : ''}<img class="art" src="${esc(spec.art)}" alt="">`;
    fadeOut();
    box.dataset.kind = spec.kind;
    box.append(lay);
    requestAnimationFrame(() => requestAnimationFrame(() => lay.classList.add('on')));
  };
  img.onerror = () => { if (shown === key) shown = null; console.warn('背景图载不进来', spec.art); };
  img.src = spec.art;
}

/* ---------- 选择框：点一下就换上（对话框的遮罩很淡，换了马上看得到） ---------- */
function tile(b, cur) {
  const on = b.id === cur;
  let pv;
  if (b.id === 'day') {
    const p = todayPoem().p;
    pv = `<span class="pv poem"><img class="fill" src="assets/plates/s/${p}.jpg" alt=""><img class="art" src="assets/plates/${p}.jpg" alt=""></span>`;
  } else if (b.id === 'plain') pv = '<span class="pv plain"></span>';
  else if (b.id === 'custom') pv = custom ? `<span class="pv pic"><img src="${esc(custom.url)}" alt=""></span>` : `<span class="pv add">${icon('plus', 28)}</span>`;
  else pv = `<span class="pv pic fit-${b.fit}"><img src="assets/backdrops/t/${b.id}.jpg" alt=""></span>`;
  const note = b.id === 'custom' && custom ? custom.name : b.note;
  return `<button class="bgt${on ? ' on' : ''}" data-bg="${b.id}" aria-pressed="${on}">${pv}
    <span class="nm">${esc(b.name)}<i>${esc(b.en)}</i></span><span class="nt" title="${esc(note)}">${esc(note)}</span>
    ${b.id === 'custom' && custom ? `<span class="chg" data-chg title="换一张">${icon('open', 15)}</span>` : ''}
    <span class="tick">${icon('check', 14, 2.4)}</span></button>`;
}
export async function openBackdropPicker() {
  await customImage();
  const grid = () => BACKDROPS.map(b => tile(b, currentBackdrop() === 'custom' && !custom ? 'day' : currentBackdrop())).join('');
  await openDialog({
    cls: 'bgdlg',
    html: `${dlgHead('背景', { k: 'The leaves behind', sub: '铺在窗口最底下；夜间会暗一些，读文档时会淡下去' })}
      <div class="bgrid">${grid()}</div>
      <div class="dlg-f"><button class="btn" data-dlg="ok">好了</button></div>`,
    onOpen: d => {
      const box = d.querySelector('.bgrid');
      box.addEventListener('click', async e => {
        const t = e.target.closest('.bgt');
        if (!t || box.classList.contains('busy')) return;
        const id = t.dataset.bg;
        if (id === 'custom' && (!custom || e.target.closest('[data-chg]'))) {
          box.classList.add('busy');
          const got = await chooseCustom().finally(() => box.classList.remove('busy'));
          if (!got || !d.open) return;
        }
        prefs.backdrop = id;
        savePrefs();
        await renderBackdrop();
        if (d.open) box.innerHTML = grid();
        d.querySelector(`.bgt[data-bg="${id}"]`)?.focus({ preventScroll: true });
      });
    },
  });
}
