// 主控：标签页、视图切换（首页 / 阅读 / 合并）、工具栏、编辑栏、菜单、快捷键、拖放、外部打开；
// 还有编辑的「账本」：保存 / 另存为、有没有没保存的修改、整理页面后的撤销重做、关闭前确认
import { $, $$, esc, nextId, stripExt } from './util.js';
import { icon, SPRIG } from './icons.js';
import { prefs, getViewState, touchRecent, getTheme, saveTheme } from './store.js';
import * as platform from './platform.js';
import { toast, showMenu, closeMenu, dialogOpen, closeDialog, openDialog, dlgHead } from './ui.js';
import { Reader, loadPdf, renderThumb, pdfErrorText, destroyPdf, docInfo, EditMode, ZOOM_PRESETS, ZOOM_LEVELS, ScrollMode, SpreadMode } from './reader.js';
import { Merger } from './merge.js';
import { renderHome, renderDayplate } from './home.js';
import { createVines } from './vines.js';
import { EditBar } from './editbar.js';
import { Organizer, organizerOpen, buildPages } from './organize.js';
import { signatureDialog } from './sign.js';
import { convertEntries, convertFilters, canConvert, convertError } from './convert.js';

/* ---------- 图标填进静态结构 ---------- */
$$('[data-ic]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic, +el.dataset.sz || 18)));
$$('[data-sprig]').forEach(el => { el.outerHTML = SPRIG.replace('class="sep"', `class="sep ${el.className}"`); });

const state = { tabs: [], active: 'home', mergeTab: false };
const getTab = id => state.tabs.find(t => t.id === id);
const activeDoc = () => (state.active !== 'home' && state.active !== 'merge' ? getTab(state.active) : null);
const docReady = () => { const t = activeDoc(); return t && t.pdf ? t : null; };
let seq = 0;                       // 文档「版本」编号：保存时记下来，之后有没有改动就看版本变没变

const vines = createVines($('#vines'), $('#app'));

const reader = new Reader({
  onChange: () => updateToolbar(),
  onEditMode: (tab, mode) => { if (reader.tab === tab) editbar.setMode(mode); },
  onEditState: (tab, st) => {
    if (st.hasSomethingToUndo && tab.future?.length) tab.future = [];      // 撤销了整理页面之后又加了批注：之前的「重做」作废
    if (reader.tab === tab) editbar.setState(st);
    dirtyChanged(tab);
  },
  onEditParams: (tab, details) => editbar.setParams(details),
  onFormInput: tab => { if (!tab.formDirty) { tab.formDirty = true; tab.future = []; dirtyChanged(tab); } },
  editDefaults: () => editbar.defaults(),
});

const editbar = new EditBar(reader, {
  image: () => insertImageFlow(),
  sign: () => signFlow(),
  pages: () => { const t = docReady(); if (t) organizer.open(t, { select: reader.page - 1 }); },
  save: () => saveTab(docReady()),
  undo: () => undo(),
  redo: () => redo(),
});

const organizer = new Organizer({
  getBytes: tab => getBytes(tab),
  apply: (tab, srcs, items) => rebuildPages(tab, srcs, items, '页面整理好了'),
});

const merger = new Merger({
  listTabs: () => state.tabs.filter(t => t.pdf).map(t => ({ name: t.name, path: t.path, password: t.password, getBytes: () => getBytes(t) })),
  openResult: (name, bytes, path) => openEntries([path ? platform.entryFromPath(path) : platform.entryFromBytes(name, bytes)]),
  onCount: () => renderTabs(),
  prepare: entries => prepareForMerge(entries),
  filters: () => convertFilters({ withPdf: true }),
});

/* ---------- 视图 ---------- */
function setView(v) {
  document.body.dataset.view = v;
  $('#home').classList.toggle('on', v === 'home');
  $('#reader').classList.toggle('on', v === 'doc');
  $('#merge').classList.toggle('on', v === 'merge');
  $('#btnHome').classList.toggle('on', v === 'home');
  if (v !== 'doc') closeMenu();
}
function homeActions() {
  return {
    open: () => openFromDialog(),
    merge: () => openMerge(),
    convert: () => convertFlow(),
    openRecent: path => openEntries([platform.entryFromPath(path)]),
  };
}
function activate(id) {
  if (reader.present) reader.exitPresentation();
  const prev = state.active;
  state.active = id;
  if (id === 'home') {
    setView('home');
    reader.detach();
    renderHome(homeActions());
  } else if (id === 'merge') {
    state.mergeTab = true;
    setView('merge');
    reader.detach();
  } else {
    const tab = getTab(id);
    if (!tab) return activate('home');
    setView('doc');
    if (tab.pdf) reader.attach(tab);
    else reader.detach();          // 还在读取：先把上一份文档撤下来，别让它露在加载提示后面
    showVState(tab);
    if (prev !== id) requestAnimationFrame(() => tab.pdf && reader.tab === tab && reader.focus());
  }
  renderTabs();
  updateTitle();
  updateToolbar();
}
function updateTitle() {
  const t = activeDoc();
  platform.win.setTitle(t ? `${isDirty(t) ? '● ' : ''}${t.name} — PDF 查看器` : state.active === 'merge' ? '合并 PDF — PDF 查看器' : 'PDF 查看器');
}
const SPROUT = '<svg class="sprout" viewBox="0 0 64 64"><path d="M32 58C31 44 34 34 30 22S33 8 34 6"/><path class="lf" d="M31 30c-6-1-11-6-12-11 6 0 11 4 12 11z" style="animation-delay:.5s"/><path class="lf" d="M32 22c6-2 10-7 10-12-6 1-10 5-10 12z" style="animation-delay:.8s"/></svg>';
function showVState(tab) {
  const el = $('#vstate');
  const text = tab?.loading ? `正在打开「${esc(tab.name)}」…` : tab?.busyText ? esc(tab.busyText) : '';
  el.classList.toggle('busy', !!(tab && !tab.loading && tab.busyText));
  if (text) {
    el.hidden = false;
    el.innerHTML = `<div class="box panel">${SPROUT}${text}</div>`;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}
function setBusy(tab, text) {
  tab.busyText = text || '';
  if (state.active === tab.id) showVState(tab);
}

/* ---------- 标签页 ---------- */
function renderTabs() {
  const box = $('#tabs');
  const html = state.tabs.map(t => {
    const d = isDirty(t);
    const tip = t.path || (t.converted ? `${t.name}：由「${t.converted.sources.slice(0, 3).join('」「')}」${t.converted.sources.length > 3 ? `等 ${t.converted.sources.length} 个文件` : ''}转换` : t.name);
    return `<div class="tab${state.active === t.id ? ' on' : ''}${d ? ' dirty' : ''}" data-tab="${t.id}" title="${esc(tip)}${d ? (t.converted ? '（还没保存）' : '（有没保存的修改）') : ''}" role="tab">
      <span class="ic">${icon('book', 15)}</span><span class="nm">${esc(stripExt(t.name))}</span>
      <button class="x" data-x="${t.id}" title="关闭（Ctrl+W）">${icon('close', 13, 2)}${icon('dot', 12)}</button></div>`;
  });
  if (state.mergeTab) {
    const n = merger.count;
    html.push(`<div class="tab${state.active === 'merge' ? ' on' : ''}" data-tab="merge" title="合并 PDF" role="tab">
      <span class="ic">${icon('bind', 15)}</span><span class="nm">合并 PDF${n ? `（${n}）` : ''}</span>
      <button class="x" data-x="merge" title="关闭">${icon('close', 13, 2)}</button></div>`);
  }
  box.innerHTML = html.join('');
  box.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
$('#tabs').addEventListener('wheel', e => { const b = e.currentTarget; if (b.scrollWidth > b.clientWidth) { b.scrollLeft += e.deltaY || e.deltaX; e.preventDefault(); } }, { passive: false });
$('#tabs').addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { e.stopPropagation(); closeTab(x.dataset.x); return; }
  const t = e.target.closest('.tab');
  if (t && t.dataset.tab !== state.active) activate(t.dataset.tab);
});
$('#tabs').addEventListener('auxclick', e => {
  const t = e.target.closest('.tab');
  if (t && e.button === 1) { e.preventDefault(); closeTab(t.dataset.tab); }
});
$('#tabs').addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
$('#tabs').addEventListener('contextmenu', e => {
  const el = e.target.closest('.tab');
  if (!el) return;
  e.preventDefault();
  const id = el.dataset.tab, t = getTab(id);
  showMenu({ x: e.clientX, y: e.clientY }, [
    t && isDirty(t) ? { label: '保存', icon: 'save', kbd: 'Ctrl+S', act: () => saveTab(t) } : null,
    { label: '关闭', icon: 'close', kbd: 'Ctrl+W', act: () => closeTab(id) },
    { label: '关闭其他标签', act: () => closeOthers(id), disabled: state.tabs.length < 2 && !state.mergeTab },
    t?.path && platform.isDesktop ? '-' : null,
    t?.path && platform.isDesktop ? { label: '在文件夹中显示', icon: 'folder', act: () => platform.revealInFolder(t.path) } : null,
    t?.path ? { label: '复制文件路径', icon: 'copy', act: () => copyText(t.path) } : null,
  ]);
});
// 关标签：有没保存的修改先问一句。返回 true 表示真的关了
async function closeTab(id) {
  if (id === 'merge') {
    state.mergeTab = false;
    if (state.active === 'merge') activate(state.tabs.length ? state.tabs[state.tabs.length - 1].id : 'home');
    else renderTabs();
    return true;
  }
  const tab = getTab(id);
  if (!tab) return false;
  if (tab.busy) { toast('这份文档正在处理，稍等一下'); return false; }
  reader.commitEdits(tab);
  if (isDirty(tab)) {
    if (state.active !== id) activate(id);
    const v = await askSave([tab]);
    if (!v) return false;
    if (v === 'save' && !await saveTab(tab)) return false;
  }
  const i = state.tabs.indexOf(tab);
  if (i < 0) return false;
  state.tabs.splice(i, 1);
  tab.closed = true;
  if (tab.pdf) reader.dispose(tab);
  tab.past = tab.future = [];
  if (state.active === id) {
    const next = state.tabs[i] || state.tabs[i - 1];
    activate(next ? next.id : state.mergeTab ? 'merge' : 'home');
  } else renderTabs();
  return true;
}
async function closeOthers(id) {
  for (const o of [...state.tabs]) if (o.id !== id && !await closeTab(o.id)) return;
  if (id !== 'merge' && state.mergeTab) closeTab('merge');
  if (state.active !== id) activate(id);
}
function cycleTab(d) {
  const ids = ['home', ...state.tabs.map(t => t.id), ...(state.mergeTab ? ['merge'] : [])];
  const i = ids.indexOf(state.active);
  activate(ids[(i + d + ids.length) % ids.length]);
}
function closeActive() {
  if (state.active === 'home') return;
  closeTab(state.active);
}
// 「保存修改吗？」：返回 'save' | 'discard' | null（取消）
async function askSave(tabs) {
  const one = tabs.length === 1;
  const v = await openDialog({
    html: `${dlgHead(one ? `保存对「${tabs[0].name}」的修改吗？` : `有 ${tabs.length} 份文档还没保存`, { k: 'Unsaved Leaves', sw: 'var(--warn)' })}
      <div class="dlg-b">${one ? (tabs[0].converted ? '这份 PDF 是刚转换出来的，还没存成文件，不保存就没有了。' : '不保存的话，这次加的批注、对页面的调整都会丢掉。') : `<ul class="dirtylist">${tabs.map(t => `<li>${esc(t.name)}${t.converted ? '（刚转换出来的）' : ''}</li>`).join('')}</ul>不保存的话，这些修改都会丢掉。`}</div>
      <div class="dlg-f"><button class="btn ghost" data-dlg="discard">不保存</button><span style="flex:1"></span><button class="btn ghost" data-dlg="">取消</button>
        <button class="btn" data-dlg="save" autofocus>${icon('save', 18)}${one ? '保存' : '全部保存'}</button></div>`,
  });
  return v === 'save' || v === 'discard' ? v : null;
}

/* ---------- 打开文件 ---------- */
const isPdfName = n => /\.pdf$/i.test(n || '');
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
const imageType = n => IMG_TYPES[String(n || '').split('.').pop().toLowerCase()] || '';
async function openFromDialog() {
  try {
    // 默认只列 PDF；第二个筛选项把能转成 PDF 的文件也列出来，选了就先转换再打开
    const entries = await platform.pickFiles({ multiple: true, title: '打开 PDF', filters: [platform.PDF_FILTER, convertFilters({ withPdf: true })[0]] });
    if (entries.length) openEntries(entries);
  } catch (e) { toast('打不开文件选择框：' + e, { kind: 'err' }); }
}
const UNKNOWN_HINT = () => (platform.isDesktop ? '只认 PDF，以及能转成 PDF 的图片、Office 文档、文本和网页' : '只认 PDF 和图片');
// PDF 直接打开；图片、Office 文档等先转成 PDF（没有路径的条目——合并结果之类——按 PDF 打开）
async function openEntries(entries) {
  const pdfs = [], conv = [];
  for (const en of entries) {
    if (isPdfName(en.name) || isPdfName(en.path)) pdfs.push(en);
    else if (canConvert(en.name)) conv.push(en);
    else if (!en.path) pdfs.push(en);
  }
  const bad = entries.length - pdfs.length - conv.length;
  if (bad) toast(`有 ${bad} 个文件打不开：${UNKNOWN_HINT()}`);
  let first = true;
  for (const en of pdfs) { openEntry(en, first); first = false; }
  if (conv.length) convertAndOpen(conv);
}
async function openEntry(entry, focus = true) {
  if (entry.path) {
    const ex = state.tabs.find(t => t.path && t.path.toLowerCase() === entry.path.toLowerCase());
    if (ex) { if (focus) activate(ex.id); return ex; }
  }
  const tab = { id: nextId('t'), name: entry.name, path: entry.path || null, size: entry.size ?? null, pdf: null, numPages: 0, fp: null, view: null,
    thumbs: new Map(), outline: undefined, labels: undefined, loading: true, password: null, encrypted: false, ratio: 1.414,
    stateId: ++seq, savedState: 0, past: [], future: [], formDirty: false, busy: false, busyText: '', converted: entry.converted || null };
  // 刚转换出来的文档还没存成文件：一打开就算「有没保存的修改」（关的时候会问，Ctrl+S 存到源文件旁边）
  tab.savedState = tab.converted ? 0 : tab.stateId;
  state.tabs.push(tab);
  if (focus) activate(tab.id); else renderTabs();
  try {
    const bytes = await entry.read();
    tab.size = bytes.length;
    const { pdf, password } = await loadPdf(bytes, { name: entry.name });
    if (tab.closed) { destroyPdf(pdf); return; }
    tab.pdf = pdf;
    tab.password = password;
    tab.numPages = pdf.numPages;
    tab.fp = pdf.fingerprints?.[0] || null;
    tab.encrypted = (await docInfo(pdf)).encrypted;
    try { const p1 = await pdf.getPage(1), v = p1.getViewport({ scale: 1 }); tab.ratio = v.height / v.width; } catch {}
    tab.loading = false;
    if (tab.closed) return;
    if (state.active === tab.id) { reader.attach(tab); showVState(tab); updateToolbar(); }
    renderTabs();
    if (tab.path) {
      const st = getViewState(tab.fp);
      touchRecent({ path: tab.path, name: tab.name, size: tab.size, pages: tab.numPages, page: st?.page || 1 });
      recentThumb(tab, st?.page || 1);
    }
  } catch (e) {
    const i = state.tabs.indexOf(tab);
    if (i >= 0) {
      state.tabs.splice(i, 1);
      if (state.active === tab.id) activate(state.tabs[i]?.id || state.tabs[i - 1]?.id || (state.mergeTab ? 'merge' : 'home'));
      else renderTabs();
    }
    if (e?.cancelled) toast(`没有输入密码，「${entry.name}」没打开`);
    else toast(`打不开「${entry.name}」：${pdfErrorText(e)}`, { kind: 'err', ms: 7000 });
  }
  return tab;
}
function recentThumb(tab, page) {
  const pdf = tab.pdf;
  renderThumb(pdf, 1, { width: 150, dataURL: true, quality: 0.72 })
    .then(r => { if (tab.pdf === pdf) touchRecent({ path: tab.path, name: tab.name, size: tab.size, pages: tab.numPages, page, thumb: r.url }); })
    .catch(() => {});
}
function openMerge() { activate('merge'); }

/* ---------- 转成 PDF：首页卡片、「打开」里选了别的文件、拖进窗口、加进合并列表 ---------- */
async function convertFlow() {
  try {
    const entries = await platform.pickFiles({ multiple: true, title: '选择要转成 PDF 的文件', filters: convertFilters() });
    if (entries.length) convertAndOpen(entries);
  } catch (e) { toast('打不开文件选择框：' + e, { kind: 'err' }); }
}
let converting = false;
// 转换一批文件；出错的一个个提示出来。取消、或者正在转别的时返回 null
async function runConvert(entries, opts) {
  if (converting) { toast('正在转换别的文件，稍等一下'); return null; }
  converting = true;
  try {
    const res = await convertEntries(entries, opts);
    for (const f of res?.failed || []) toast(`「${f.name}」没转成：${f.error}`, { kind: 'err', ms: 9000 });
    return res;
  } catch (e) {
    console.error(e);
    toast('转换失败：' + convertError(e), { kind: 'err', ms: 8000 });
    return null;
  } finally { converting = false; }
}
// 转好的开成新标签页（还没保存）
async function convertAndOpen(entries) {
  const res = await runConvert(entries, { ask: true });
  if (!res?.results.length) return;
  const opened = res.results.map((r, i) => openEntry(Object.assign(platform.entryFromBytes(r.name, r.bytes), { converted: { dir: r.dir, sources: r.sources } }), i === 0));
  const one = res.results.length === 1, first = await opened[0];
  toast(one ? `转好了：${res.results[0].name}（还没保存）` : `转好了 ${res.results.length} 份 PDF（都还没保存）`, {
    kind: 'ok', ms: 7000,
    actions: one && platform.isDesktop ? [{ label: '保存', fn: () => { if (state.tabs.includes(first)) saveTab(first); } }] : [],
  });
}
// 加进合并列表之前：不是 PDF 的先转成 PDF（每个文件一份，不问选项，顺序不变）
async function prepareForMerge(entries) {
  const conv = entries.filter(en => en.name && !isPdfName(en.name) && canConvert(en.name));
  if (!conv.length) return entries;
  const res = await runConvert(conv, { ask: false, combine: false });
  const done = new Map((res?.results || []).map(r => [r.entry, r]));
  return entries.flatMap(en => {
    if (!conv.includes(en)) return [en];
    const r = done.get(en);
    return r ? [{ name: r.name, path: null, dir: r.dir, size: r.bytes.length, read: async () => r.bytes }] : [];
  });
}

/* ---------- 资源管理器右键「转成 PDF」：转好直接存到源文件旁边，再打开 ----------
 * 多选时资源管理器每个文件启动一次程序，单实例把它们陆续转过来：攒一会儿（最后一个到了 400 毫秒后）一起转，进度在同一个对话框里。
 * 同名的 PDF 已经有了就存成「名字 (1).pdf」，不覆盖；源文件夹存不进去（只读之类）就照常开成没保存的标签页 */
const directQueue = [];
let directTimer = 0, directBusy = false;
function queueDirect(entries) {
  directQueue.push(...entries);
  clearTimeout(directTimer);
  directTimer = setTimeout(runDirect, 400);
}
async function runDirect() {
  if (directBusy || converting) { directTimer = setTimeout(runDirect, 500); return; }     // 上一批、或者界面里的转换还没完：等一会儿
  const batch = directQueue.splice(0);
  if (!batch.length) return;
  directBusy = true;
  try {
    const res = await runConvert(batch, { ask: false, combine: false });
    const saved = [];
    for (const r of res?.results || []) {
      try { saved.push(await saveBeside(r)); } catch (e) {
        console.warn(e);
        toast(`「${r.name}」没能存到源文件旁边（${e?.message || e}），先开着，记得另存`, { kind: 'err', ms: 9000 });
        openEntry(Object.assign(platform.entryFromBytes(r.name, r.bytes), { converted: { dir: r.dir, sources: r.sources } }), !saved.length);
      }
    }
    if (saved.length) {
      openEntries(saved.map(p => platform.entryFromPath(p)));
      toast(saved.length === 1 ? `转好了，存在源文件旁边：${platform.basename(saved[0])}` : `转好了 ${saved.length} 份 PDF，都存在源文件旁边`, {
        kind: 'ok', ms: 8000, actions: [{ label: '在文件夹中显示', fn: () => platform.revealInFolder(saved[0]) }],
      });
    }
  } finally {
    directBusy = false;
    if (directQueue.length) { clearTimeout(directTimer); directTimer = setTimeout(runDirect, 0); }
  }
}
// 存到源文件旁边，不覆盖已有的文件：报告.pdf、报告 (1).pdf、报告 (2).pdf……
async function saveBeside(r) {
  if (!r.dir) throw new Error('不知道源文件在哪个文件夹');
  const base = r.name.replace(/\.pdf$/i, ''), sep = /[\\/]$/.test(r.dir) ? '' : '\\';
  for (let i = 0; i < 1000; i++) {
    const path = `${r.dir}${sep}${i ? `${base} (${i})` : base}.pdf`;
    if (!(await platform.pathsExist([path], { any: true }))[0]) { await platform.writeFile(path, r.bytes); return path; }
  }
  throw new Error('同名的文件太多了');
}
// 右键菜单里的「转成 PDF」：⋯ 菜单里开关（安装版装好时就加上了；免安装版在这里加）
let shellMenuState = null;
async function toggleShellMenu() {
  const on = !shellMenuState?.current;
  try {
    shellMenuState = await platform.shellMenu.set(on);
    toast(on ? '加好了：在资源管理器里右键图片、Office 文档、文本或网页，点「转成 PDF」，转好的存在原文件旁边（Windows 11 在「显示更多选项」里）'
      : '右键菜单里的「转成 PDF」去掉了', { kind: 'ok', ms: on ? 10000 : 5000 });
  } catch (e) { toast('改不了右键菜单：' + (e?.message || e), { kind: 'err' }); }
}

/* ---------- 编辑的账本：版本、保存、整理页面、撤销 ---------- */
// 批注和表单改过没有（保存后会重新载入，所以「改过」就是从载入以来）
const annotDirty = t => !!(t.formDirty || t.leaf?.edit?.hasSomethingToUndo);
const isDirty = t => !!(t?.pdf && (t.stateId !== t.savedState || annotDirty(t)));
// 现在这一版的编号：有批注 / 表单改动时，内容和编号对应的那一版已经不同，换个新编号
const versionId = t => { if (annotDirty(t)) t.stateId = ++seq; return t.stateId; };
function dirtyChanged(tab) {
  const d = isDirty(tab);
  if (reader.tab === tab) { editbar.setDirty(d); syncUndo(); $('#tbSave').classList.toggle('dirty', d); }
  if (d === tab.shownDirty) return;
  tab.shownDirty = d;
  renderTabs();
  if (state.active === tab.id) updateTitle();
}
function syncUndo() {
  const t = docReady(), st = t?.leaf?.edit || {};
  editbar.setUndo(!!(st.hasSomethingToUndo || t?.past?.length), !!(st.hasSomethingToRedo || t?.future?.length));
}
// 当前文档的完整内容：有批注 / 表单改动就让 pdf.js 写进去
async function getBytes(tab) {
  reader.commitEdits(tab);
  return tab.pdf.annotationStorage.size > 0 ? tab.pdf.saveDocument() : tab.pdf.getData();
}
// 同一个标签页换上新内容（阅读位置留着）
async function replaceBytes(tab, bytes) {
  const { pdf, password } = await loadPdf(bytes.slice(), { name: tab.name, password: tab.password });
  if (tab.closed) { destroyPdf(pdf); return false; }
  tab.password = password;
  tab.size = bytes.length;
  tab.formDirty = false;
  tab.encrypted = (await docInfo(pdf)).encrypted;
  try { const p1 = await pdf.getPage(1), v = p1.getViewport({ scale: 1 }); tab.ratio = v.height / v.width; } catch {}
  reader.replaceDocument(tab, pdf);
  dirtyChanged(tab);
  updateToolbar();
  return true;
}
// 撤销用的旧版本：最多 12 份、合计 300 MB，超了就丢最旧的
function remember(list, entry) {
  list.push(entry);
  let total = list.reduce((s, x) => s + x.bytes.length, 0);
  while (list.length > 12 || (list.length > 1 && total > 300 * 1024 * 1024)) total -= list.shift().bytes.length;
}

async function saveTab(tab, { as = false } = {}) {
  if (!tab?.pdf) return false;
  if (tab.busy) { toast('这份文档正在处理，稍等一下'); return false; }
  reader.commitEdits(tab);
  if (!as && tab.path && !isDirty(tab)) { toast('没有要保存的修改'); return true; }
  tab.busy = true;
  try {
    const flatten = tab.pdf.annotationStorage.size > 0;
    let path = tab.path;
    if (platform.isDesktop && (as || !path)) {
      path = await platform.askSavePath(tab.name, tab.path ? platform.dirname(tab.path) : tab.converted?.dir || '');
      if (!path) return false;
    }
    setBusy(tab, '正在保存…');
    const bytes = await getBytes(tab);
    if (platform.isDesktop) await platform.writeFile(path, bytes);
    else if (!await platform.savePdf(bytes, tab.name)) return false;
    const renamed = path && path !== tab.path;
    if (renamed) { tab.path = path; tab.name = platform.basename(path); }
    const ver = versionId(tab);
    if (flatten) await replaceBytes(tab, bytes);      // 批注写进文件了：重新载入，以后「有没有改动」以存好的文件为准
    tab.stateId = tab.savedState = ver;
    tab.size = bytes.length;
    tab.converted = null;
    tab.shownDirty = undefined;
    dirtyChanged(tab);
    if (renamed) updateTitle();
    if (tab.path) {
      touchRecent({ path: tab.path, name: tab.name, size: tab.size, pages: tab.numPages, page: reader.tab === tab ? reader.page : 1 });
      recentThumb(tab, reader.tab === tab ? reader.page : 1);
    }
    toast(`已保存：${tab.name}`, { kind: 'ok', actions: tab.path && platform.isDesktop ? [{ label: '在文件夹中显示', fn: () => platform.revealInFolder(tab.path) }] : [] });
    return true;
  } catch (e) {
    console.error(e);
    toast('保存失败：' + pdfErrorText(e), { kind: 'err', ms: 8000 });
    return false;
  } finally {
    tab.busy = false;
    setBusy(tab, null);
  }
}

// 整理页面（整理对话框、缩略图右键菜单）：按页面清单重新生成文档，换上去；旧版本留着可以撤销
async function rebuildPages(tab, srcs, items, label) {
  if (!tab?.pdf) return false;
  if (tab.busy) { toast('这份文档正在处理，稍等一下'); return false; }
  tab.busy = true;
  setBusy(tab, '正在整理页面…');
  try {
    const prev = await getBytes(tab), prevVer = versionId(tab);
    srcs[0] = { ...srcs[0], name: tab.name, bytes: prev, password: tab.password, encrypted: tab.encrypted };
    const { bytes } = await buildPages(srcs, items, { info: await docInfo(tab.pdf) });
    if (tab.closed || !await replaceBytes(tab, bytes)) return false;
    remember(tab.past, { bytes: prev, ver: prevVer });
    tab.future = [];
    tab.stateId = ++seq;
    dirtyChanged(tab);
    toast(`${label}（还没保存）`, { kind: 'ok', ms: 6000, actions: [{ label: '撤销', fn: () => undoPages(tab) }] });
    return true;
  } catch (e) {
    if (!e?.cancelled) { console.error(e); toast('整理页面失败：' + pdfErrorText(e), { kind: 'err', ms: 8000 }); }
    return false;
  } finally {
    tab.busy = false;
    setBusy(tab, null);
  }
}
// 整理页面的撤销 / 重做：在版本之间来回换
async function stepPages(tab, back) {
  const from = back ? tab.past : tab.future, to = back ? tab.future : tab.past;
  if (!tab?.pdf || tab.busy || !from.length) return;
  tab.busy = true;
  setBusy(tab, back ? '正在撤销…' : '正在重做…');
  const target = from.pop();
  try {
    const cur = await getBytes(tab), curVer = versionId(tab);
    if (!await replaceBytes(tab, target.bytes)) { from.push(target); return; }
    remember(to, { bytes: cur, ver: curVer });
    tab.stateId = target.ver;
    dirtyChanged(tab);
  } catch (e) {
    from.push(target);
    if (!e?.cancelled) toast((back ? '撤销' : '重做') + '失败：' + pdfErrorText(e), { kind: 'err' });
  } finally {
    tab.busy = false;
    setBusy(tab, null);
  }
}
const undoPages = tab => stepPages(tab, true);
const redoPages = tab => stepPages(tab, false);
// 撤销：先撤批注，批注没得撤了再撤整理页面
function undo() {
  const t = docReady();
  if (!t) return;
  if (t.leaf?.edit?.hasSomethingToUndo) reader.editAction('undo');
  else if (t.past.length) undoPages(t);
}
function redo() {
  const t = docReady();
  if (!t) return;
  if (t.leaf?.edit?.hasSomethingToRedo) reader.editAction('redo');
  else if (t.future.length) redoPages(t);
}

// 缩略图右键：一页的快捷操作
async function quickPages(tab, op, i) {
  const items = Array.from({ length: tab.numPages }, (_, p) => ({ kind: 'page', src: 0, page: p, rot: 0 }));
  let label = '';
  if (op === 'rr' || op === 'rl') { items[i].rot = op === 'rr' ? 90 : 270; label = `第 ${i + 1} 页转好了`; }
  else if (op === 'del') { items.splice(i, 1); label = `第 ${i + 1} 页删掉了`; }
  else if (op === 'dup') { items.splice(i + 1, 0, { ...items[i] }); label = `第 ${i + 1} 页复制了一份`; }
  else if (op === 'blank') {
    const p = await tab.pdf.getPage(i + 1), vp = p.getViewport({ scale: 1 });
    items.splice(i + 1, 0, { kind: 'blank', w: vp.width, h: vp.height });
    label = `第 ${i + 1} 页后面加了一张空白页`;
  }
  return rebuildPages(tab, [{}], items, label);
}
async function extractPage(tab, i) {
  try {
    const srcs = [{ name: tab.name, bytes: await getBytes(tab), password: tab.password, encrypted: tab.encrypted }];
    const { bytes } = await buildPages(srcs, [{ kind: 'page', src: 0, page: i, rot: 0 }], { info: await docInfo(tab.pdf) });
    const res = await platform.savePdf(bytes, `${stripExt(tab.name)}（第 ${i + 1} 页）.pdf`, tab.path ? platform.dirname(tab.path) : '');
    if (res) toast(`已另存为：${res.name}`, { kind: 'ok', actions: res.path ? [{ label: '打开', fn: () => openEntries([platform.entryFromPath(res.path)]) }, { label: '在文件夹中显示', fn: () => platform.revealInFolder(res.path) }] : [] });
  } catch (e) { toast('提取失败：' + pdfErrorText(e), { kind: 'err' }); }
}

// 插入图片、签名
async function insertImageFlow() {
  const t = docReady();
  if (!t) return;
  if (!reader.canEdit) { toast('这份文件不能加批注'); return; }
  const [file] = await platform.pickImages();          // 要在点击里直接弹出文件选择框
  if (file && !await reader.insertImage(file)) toast('图片没能放上去', { kind: 'err' });
}
async function signFlow() {
  const t = docReady();
  if (!t) return;
  if (!reader.canEdit) { toast('这份文件不能加批注'); return; }
  const sig = await signatureDialog();
  if (sig && docReady() === t && !await reader.insertImage(sig.file, { widthPt: 150, aspect: sig.aspect })) toast('签名没能放上去', { kind: 'err' });
}
async function insertDroppedImages(entries, at) {
  if (!reader.canEdit) { toast('这份文件不能加批注'); return; }
  for (const en of entries.slice(0, 12)) {
    try {
      const file = en.file || new File([await en.read()], en.name, { type: imageType(en.name) });
      await reader.insertImage(file, { at });
    } catch (e) { toast(`「${en.name}」放不上去：${pdfErrorText(e)}`, { kind: 'err' }); }
  }
}

/* ---------- 工具栏 ---------- */
const LAYOUTS = [
  { label: '单页连续', icon: 'layout1', scroll: ScrollMode.VERTICAL, spread: SpreadMode.NONE },
  { label: '双页连续', icon: 'layout2', scroll: ScrollMode.VERTICAL, spread: SpreadMode.ODD },
  { label: '双页（封面单独）', icon: 'layoutCover', scroll: ScrollMode.VERTICAL, spread: SpreadMode.EVEN },
  { label: '单页翻页', icon: 'layoutPage', scroll: ScrollMode.PAGE, spread: SpreadMode.NONE },
  { label: '平铺', icon: 'layoutGrid', scroll: ScrollMode.WRAPPED, spread: SpreadMode.NONE },
];
const curLayout = () => { const l = reader.layout; return LAYOUTS.find(x => x.scroll === l.scroll && x.spread === l.spread) || LAYOUTS[0]; };
function updateToolbar() {
  const t = docReady();
  ['tbPrev', 'tbNext', 'tbZoomOut', 'tbZoomIn', 'tbZoom', 'tbRotate', 'tbLayout', 'tbFind', 'tbEdit', 'tbPrint', 'tbSave', 'pageInput'].forEach(id => { $('#' + id).disabled = !t; });
  if (t) {
    $('#tbPrev').disabled = reader.page <= 1;
    $('#tbNext').disabled = reader.page >= t.numPages;
  }
  editbar.setEnabled(!!t);
  if (t) { editbar.setDirty(isDirty(t)); syncUndo(); }
  $('#tbSave').classList.toggle('dirty', !!t && isDirty(t));
  const L = curLayout();
  $('#tbLayout').innerHTML = icon(L.icon);
  $('#tbLayout').title = `页面版式：${L.label}`;
  $('#viewerWrap').classList.toggle('pagemode', L.scroll === ScrollMode.PAGE);
}
$('#tbSidebar').addEventListener('click', () => reader.toggleSidebar());
$('#tbOpen').addEventListener('click', openFromDialog);
$('#btnTabAdd').addEventListener('click', openFromDialog);
$('#btnHome').addEventListener('click', () => activate('home'));
$('#tbPrev').addEventListener('click', () => reader.prevPage());
$('#tbNext').addEventListener('click', () => reader.nextPage());
$('#tbZoomOut').addEventListener('click', () => reader.zoomOut());
$('#tbZoomIn').addEventListener('click', () => reader.zoomIn());
$('#tbRotate').addEventListener('click', () => reader.rotate(90));
$('#tbFind').addEventListener('click', () => reader.toggleFind());
$('#tbEdit').addEventListener('click', () => editbar.toggle());
$('#tbMerge').addEventListener('click', openMerge);
$('#tbPrint').addEventListener('click', () => reader.print());
$('#tbSave').addEventListener('click', () => saveTab(docReady()));
$('#tbTheme').addEventListener('click', toggleTheme);
$('#tbZoom').addEventListener('click', e => {
  const v = reader.viewer?.currentScaleValue, s = reader.viewer?.currentScale;
  showMenu(e.currentTarget, [
    ...ZOOM_PRESETS.map(([k, label]) => ({ label, on: v === k, kbd: { 'page-fit': 'Ctrl+0', 'page-actual': 'Ctrl+1', 'page-width': 'Ctrl+2' }[k], act: () => reader.setZoom(k) })),
    '-',
    ...ZOOM_LEVELS.map(z => ({ label: `${Math.round(z * 100)}%`, on: !ZOOM_PRESETS.some(p => p[0] === v) && Math.abs(s - z) < 0.005, act: () => reader.setZoom(z) })),
  ]);
});
$('#tbLayout').addEventListener('click', e => {
  const L = curLayout();
  showMenu(e.currentTarget, [{ head: '页面版式' }, ...LAYOUTS.map(l => ({ label: l.label, icon: l.icon, on: l === L, act: () => { reader.setLayout(l.scroll, l.spread); updateToolbar(); } }))]);
});
$('#tbMore').addEventListener('click', e => showMenu(e.currentTarget, moreItems(), { align: 'end' }));
function moreItems() {
  const t = docReady(), L = curLayout();
  return [
    { label: '第一页', icon: 'first', kbd: 'Home', disabled: !t, act: () => reader.firstPage() },
    { label: '最后一页', icon: 'last', kbd: 'End', disabled: !t, act: () => reader.lastPage() },
    { label: '逆时针旋转（只是看）', icon: 'rotCcw', kbd: 'Ctrl+Shift+R', disabled: !t, act: () => reader.rotate(-90) },
    { label: '手形工具（拖动翻看）', icon: 'hand', kbd: '按住空格', on: reader.hand, disabled: !t, act: () => reader.setHand(!reader.hand) },
    '-',
    { head: '编辑' },
    { label: editbar.open ? '收起编辑栏' : '编辑栏：批注、签名', icon: 'pen', kbd: 'Ctrl+E', disabled: !t, act: () => editbar.toggle() },
    { label: '整理页面…', icon: 'pages', disabled: !t, act: () => organizer.open(t, { select: reader.page - 1 }) },
    { label: '保存', icon: 'save', kbd: 'Ctrl+S', disabled: !t, act: () => saveTab(t) },
    { label: '另存为…', icon: 'save', kbd: 'Ctrl+Shift+S', disabled: !t, act: () => saveTab(t, { as: true }) },
    { head: '页面色调' },
    { label: '原色', icon: 'tone', on: prefs.tone === 'normal', act: () => reader.setTone('normal') },
    { label: '纸色（像手工纸）', icon: 'tone', on: prefs.tone === 'paper', act: () => reader.setTone('paper') },
    { label: '夜读（反色）', icon: 'tone', on: prefs.tone === 'night', act: () => reader.setTone('night') },
    { head: '页面版式' },
    ...LAYOUTS.map(l => ({ label: l.label, icon: l.icon, on: l === L, act: () => { reader.setLayout(l.scroll, l.spread); updateToolbar(); } })),
    '-',
    { label: '演示模式', icon: 'present', kbd: 'F5', disabled: !t, act: () => reader.enterPresentation() },
    { label: '全屏', icon: 'fitPage', kbd: 'F11', act: () => toggleFullscreen() },
    '-',
    { label: '打印…', icon: 'print', kbd: 'Ctrl+P', disabled: !t, act: () => reader.print() },
    { label: '提取 / 合并页面…', icon: 'bind', disabled: !t, act: () => extractCurrent() },
    { label: '把别的文件转成 PDF…', icon: 'convert', act: () => convertFlow() },
    platform.isDesktop ? { label: '资源管理器右键菜单里的「转成 PDF」', icon: 'convert', on: !!shellMenuState?.current, act: () => toggleShellMenu() } : null,
    { label: '文档属性', icon: 'info', kbd: 'Ctrl+D', disabled: !t, act: () => reader.showProperties() },
    t?.path && platform.isDesktop ? { label: '在文件夹中显示', icon: 'folder', act: () => platform.revealInFolder(t.path) } : null,
    '-',
    { label: '关闭文档', icon: 'close', kbd: 'Ctrl+W', disabled: !activeDoc(), act: () => closeActive() },
  ];
}
function extractCurrent() {
  const t = docReady();
  if (!t) return;
  merger.addEntries([{ name: t.name, path: t.path, password: t.password, read: () => getBytes(t) }]);
  openMerge();
  toast('已加入合并列表：在「页码」里写要提取的页，或者再加几个文件一起合并', { ms: 6000 });
}

// 阅读区右键菜单
$('#viewerWrap').addEventListener('contextmenu', e => {
  if (!docReady() || reader.present || !reader.container?.contains(e.target)) return;
  if (e.target.closest('.editToolbar,.selbar')) return;
  e.preventDefault();
  const sel = window.getSelection()?.toString().trim() || '';
  const short = sel.length > 14 ? sel.slice(0, 14) + '…' : sel;
  showMenu({ x: e.clientX, y: e.clientY }, [
    sel ? { label: '复制', icon: 'copy', kbd: 'Ctrl+C', act: () => document.execCommand('copy') } : null,
    sel && reader.canEdit ? { label: '高亮', icon: 'marker', act: () => reader.highlightSelection() } : null,
    sel ? { label: `查找「${short}」`, icon: 'find', act: () => reader.openFind(sel) } : null,
    sel ? '-' : null,
    { label: '上一页', icon: 'up', disabled: reader.page <= 1, act: () => reader.prevPage() },
    { label: '下一页', icon: 'down', disabled: reader.page >= reader.pages, act: () => reader.nextPage() },
    '-',
    { label: '适合宽度', icon: 'fitWidth', act: () => reader.setZoom('page-width') },
    { label: '适合页面', icon: 'fitPage', act: () => reader.setZoom('page-fit') },
    { label: '顺时针旋转（只是看）', icon: 'rotCw', act: () => reader.rotate(90) },
    '-',
    { label: editbar.open ? '收起编辑栏' : '批注、签名…', icon: 'pen', kbd: 'Ctrl+E', act: () => editbar.toggle() },
    { label: '整理页面…', icon: 'pages', act: () => organizer.open(docReady(), { select: reader.page - 1 }) },
    { label: '打印…', icon: 'print', act: () => reader.print() },
    { label: '文档属性', icon: 'info', act: () => reader.showProperties() },
  ]);
});
// 缩略图右键：这一页的快捷操作
$('#thumbs').addEventListener('contextmenu', e => {
  const b = e.target.closest('.thumb'), t = docReady();
  if (!b || !t) return;
  e.preventDefault();
  e.stopPropagation();
  const i = +b.dataset.page - 1;
  showMenu({ x: e.clientX, y: e.clientY }, [
    { head: `第 ${i + 1} 页` },
    { label: '向右转 90°', icon: 'rotCw', act: () => quickPages(t, 'rr', i) },
    { label: '向左转 90°', icon: 'rotCcw', act: () => quickPages(t, 'rl', i) },
    { label: '在后面加一张空白页', icon: 'blank', act: () => quickPages(t, 'blank', i) },
    { label: '复制这一页', icon: 'copy', act: () => quickPages(t, 'dup', i) },
    { label: '删除这一页', icon: 'trash', disabled: t.numPages < 2, act: () => quickPages(t, 'del', i) },
    '-',
    { label: '把这一页另存为…', icon: 'extract', act: () => extractPage(t, i) },
    { label: '整理页面…', icon: 'pages', act: () => organizer.open(t, { select: i }) },
  ]);
});
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea,[contenteditable="true"]')) e.preventDefault(); });

/* ---------- 主题 / 全屏 / 窗口按钮 ---------- */
function toggleTheme() {
  const t = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  saveTheme(t);
  vines.regrow();
  if (state.active === 'home') renderHome(homeActions());
}
let winFull = false;
async function toggleFullscreen() {
  if (reader.present) return;
  winFull = !winFull;
  await platform.win.setFullscreen(winFull);
}
$('#wcMin').addEventListener('click', () => platform.win.minimize());
$('#wcMax').addEventListener('click', () => platform.win.toggleMaximize());
$('#wcClose').addEventListener('click', () => { reader.flush(); platform.win.close(); });
if (platform.isDesktop) {      // 无边框窗口：四边四角拉伸
  const dirs = { n: 'North', s: 'South', w: 'West', e: 'East', nw: 'NorthWest', ne: 'NorthEast', sw: 'SouthWest', se: 'SouthEast' };
  const rsz = $('#rsz');
  rsz.innerHTML = Object.entries(dirs).map(([k, d]) => `<div class="rz ${k}" data-dir="${d}"></div>`).join('');
  rsz.addEventListener('mousedown', e => { const d = e.target.dataset.dir; if (d && e.button === 0) { e.preventDefault(); platform.win.startResize(d); } });
}
const syncMax = async () => {
  const m = await platform.win.isMaximized().catch(() => false);
  document.documentElement.classList.toggle('maximized', m);
  const b = $('#wcMax');
  b.innerHTML = icon(m ? 'restore' : 'max', 16);
  b.title = m ? '向下还原' : '最大化';
};
platform.win.onResized(syncMax);
addEventListener('beforeunload', () => reader.flush());
// 关窗：有没保存的修改就问一句
platform.win.onCloseRequested({
  hasUnsaved: () => {
    reader.flush();
    state.tabs.forEach(t => reader.commitEdits(t));
    return state.tabs.some(isDirty);
  },
  confirm: async () => {
    if (dialogOpen()) closeDialog(null);
    const dirty = state.tabs.filter(isDirty);
    const v = await askSave(dirty);
    if (!v) return false;
    if (v === 'save') for (const t of dirty) { activate(t.id); if (!await saveTab(t)) return false; }
    return true;
  },
});

/* ---------- 快捷键 ---------- */
addEventListener('keydown', e => {
  if (reader.present) { if (reader.presentKey(e)) return; }
  if (dialogOpen() || organizerOpen()) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
  const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const doc = !!docReady();
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  // 先拦住浏览器自带的刷新、打印、查找、历史导航等
  if (k === 'F5') { stop(); if (doc) reader.enterPresentation(); return; }
  if (k === 'F11') { stop(); toggleFullscreen(); return; }
  if (k === 'F4') { stop(); reader.toggleSidebar(); return; }
  if (k === 'F3') { stop(); if (doc) reader.findAgain(e.shiftKey); return; }
  if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home')) { stop(); return; }
  if (ctrl) {
    if (lk === 'o') { stop(); openFromDialog(); return; }
    if (lk === 'w' || k === 'F4') { stop(); closeActive(); return; }
    if (k === 'Tab') { stop(); cycleTab(e.shiftKey ? -1 : 1); return; }
    if (lk === 'm') { stop(); openMerge(); return; }
    if (lk === 'f') { stop(); if (doc) reader.openFind(window.getSelection()?.toString().trim()); return; }
    if (lk === 'g') { stop(); if (doc) reader.findAgain(e.shiftKey); return; }
    if (lk === 'p') { stop(); if (doc) reader.print(); return; }
    if (lk === 's') { stop(); if (doc) saveTab(docReady(), { as: e.shiftKey }); return; }
    if (lk === 'e') { stop(); if (doc) editbar.toggle(); return; }
    if (lk === 'd') { stop(); if (doc) reader.showProperties(); return; }
    if (lk === 'r') { stop(); if (doc) reader.rotate(e.shiftKey ? -90 : 90); return; }
    if ((lk === 'z' || lk === 'y') && !inInput && doc) { stop(); lk === 'y' || e.shiftKey ? redo() : undo(); return; }
    if (k === '=' || k === '+') { stop(); if (doc) reader.zoomIn(); return; }
    if (k === '-' || k === '_') { stop(); if (doc) reader.zoomOut(); return; }
    if (k === '0') { stop(); if (doc) reader.setZoom('page-fit'); return; }
    if (k === '1') { stop(); if (doc) reader.setZoom('page-actual'); return; }
    if (k === '2') { stop(); if (doc) reader.setZoom('page-width'); return; }
    if (k === 'PageUp' || k === 'PageDown') { stop(); cycleTab(k === 'PageUp' ? -1 : 1); return; }
    if (['u', 'n', 't', 'h', 'j', 'l', 'k', 'q'].includes(lk)) { stop(); return; }   // 网页浏览器的快捷键，在这里没有意义
    return;
  }
  if (inInput || !doc || state.active === 'home' || state.active === 'merge') return;
  // 编辑批注时：选中了批注，方向键、空格交给 pdf.js（挪动批注）；Esc 先取消选中，没有选中的就回到「阅读」
  const editing = reader.editMode !== EditMode.NONE, selected = editing && reader.editState.hasSelectedEditor;
  if (editing && k === 'Escape' && !selected && $('#findbar').hidden) { stop(); reader.setEditMode(EditMode.NONE); return; }
  if (selected && (/^Arrow/.test(k) || k === ' ')) return;
  const c = reader.container;
  const noHScroll = !c || c.scrollWidth <= c.clientWidth + 2;
  const pageMode = reader.layout.scroll === ScrollMode.PAGE;
  if (k === 'Home') { stop(); reader.firstPage(); }
  else if (k === 'End') { stop(); reader.lastPage(); }
  else if ((k === 'ArrowLeft' && noHScroll) || ((k === 'PageUp' || k === 'ArrowUp') && pageMode)) { stop(); reader.prevPage(); }
  else if ((k === 'ArrowRight' && noHScroll) || ((k === 'PageDown' || k === 'ArrowDown' || (k === ' ' && !editing)) && pageMode)) { stop(); reader.nextPage(); }
  else if (k === 'Escape' && !$('#findbar').hidden) { stop(); reader.closeFind(); }
  else if (k === 'Escape' && winFull) { stop(); toggleFullscreen(); }
}, true);
$('#viewerWrap').addEventListener('mousedown', e => reader.present && reader.presentPointer(e));
$('#viewerWrap').addEventListener('mousemove', e => reader.present && reader.presentPointer(e));
// 鼠标侧键（后退 / 前进）不要让网页导航
addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });

/* ---------- 拖放：PDF 打开（在合并页就加进列表）；阅读时拖进来的图片放到当前页上；别的能转换的文件转成 PDF ---------- */
const dz = $('#dropzone');
// 把拖进来的文件分成几拨：PDF、要放到页面上的图片、要转成 PDF 的、打不开的
function sortDropped(names) {
  const doc = !!docReady() && state.active !== 'merge', out = { pdf: [], img: [], conv: [], bad: [] };
  names.forEach((n, i) => out[isPdfName(n) ? 'pdf' : doc && imageType(n) ? 'img' : canConvert(n) ? 'conv' : 'bad'].push(i));
  return out;
}
function dropHint(on, paths = null) {
  if (!on) { dz.classList.remove('on'); return; }
  const merge = state.active === 'merge', doc = !!docReady() && !merge;
  let text, sub;
  if (!paths) {                  // 网页版拖着的时候不一定知道是什么文件
    text = merge ? '松开，加入合并列表' : '松开就打开';
    sub = doc ? 'PDF 会打开，图片会放到这一页上，别的文件会转成 PDF' : 'PDF 会打开，图片之类的文件会转成 PDF';
  } else {
    const s = sortDropped(paths), [p, i, c, b] = [s.pdf.length, s.img.length, s.conv.length, s.bad.length];
    if (!p && !i && !c) { text = '这些文件打不开'; sub = UNKNOWN_HINT(); }
    else {
      text = merge ? '松开，加入合并列表' : i && !p && !c ? '松开，把图片放到这一页上' : !p ? '松开，转成 PDF' : '松开就打开';
      sub = [p && `${p} 个 PDF`, i && `${i} 张图片放到页面上`, c && `${c} 个文件${merge ? '先' : '会'}转成 PDF`, b && `${b} 个打不开`].filter(Boolean).join('，');
    }
  }
  $('#dropText').textContent = text;
  $('#dropSub').textContent = sub;
  dz.classList.add('on');
}
function handleDrop(entries, at = null) {
  dropHint(false);
  const s = sortDropped(entries.map(en => en.name)), pick = k => s[k].map(i => entries[i]);
  if (s.bad.length) toast(`有 ${s.bad.length} 个文件打不开：${UNKNOWN_HINT()}`);
  if (state.active === 'merge') {
    const use = entries.filter((_, i) => !s.bad.includes(i));
    if (use.length) merger.addEntries(use);
    return;
  }
  if (s.img.length) insertDroppedImages(pick('img'), at);
  if (s.pdf.length) openEntries(pick('pdf'));
  if (s.conv.length) convertAndOpen(pick('conv'));
}
const native = platform.onNativeDragDrop({
  enter: paths => dropHint(true, paths),
  leave: () => dropHint(false),
  drop: handleDrop,
});
if (!native) {
  // 网页版：在捕获阶段接住文件拖放（pdf.js 的批注编辑器在 document 上也听 drop，会把图片塞进每个打开的文档）
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  // 拖着的时候浏览器不给文件名，只给 MIME 类型：换成假文件名给提示用（有类型说不清的就用笼统的提示）
  const dragNames = dt => {
    const ts = [...(dt?.items || [])].filter(i => i.kind === 'file').map(i => i.type);
    return ts.length && ts.every(Boolean) ? ts.map(t => t === 'application/pdf' ? 'f.pdf' : 'f.' + (t.split('/')[1] || '').replace('jpeg', 'jpg').replace('svg+xml', 'svg')) : null;
  };
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); if (depth++ === 0) dropHint(true, dragNames(e.dataTransfer)); }, true);
  addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } }, true);
  addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; dropHint(false); } }, true);
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    handleDrop([...e.dataTransfer.files].map(platform.entryFromFile), { x: e.clientX, y: e.clientY });
  }, true);
}

/* ---------- 粘贴 ----------
 * pdf.js 每份文档的批注编辑器都在 document 上听 paste，监听在不在、有几个，取决于之前切过哪些工具
 * （切回阅读时它先摘掉监听，接着收尾还在编辑的批注时又会挂回去），结果有时阅读状态下也会响应、一次粘贴插进好几张。
 * 这里在捕获阶段统一接住：文字框、输入框里照常粘贴；剪贴板里有图片就放到当前页上（和拖进来一样，一张一个批注）；
 * 复制过的批注（pdf.js 自己的格式）只交给当前文档，而且要在编辑状态。别的都不再往下传给 pdf.js */
addEventListener('paste', e => {
  if (!docReady() || state.active === 'merge' || dialogOpen() || organizerOpen()) return;
  const el = e.target;
  if (el?.isContentEditable || el?.closest?.('input, textarea, select, [contenteditable]')) return;
  e.stopImmediatePropagation();
  const imgs = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
  if (imgs.length) { e.preventDefault(); insertDroppedImages(imgs.map(platform.entryFromFile)); return; }
  if (e.clipboardData?.types?.includes('application/pdfjs')) reader.pasteEditors(e);
}, true);

/* ---------- 小工具 ---------- */
function copyText(text) {
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  toast('已复制');
}

/* ---------- 启动 ---------- */
// 程序外面交过来的文件（启动参数、开着时再打开的、右键「转成 PDF」的）：要打开的直接开，要转的转好存到源文件旁边
async function takePending() {
  try {
    const { open, convert } = await platform.takePendingFiles();
    if (open.length) openEntries(open);
    if (convert.length) queueDirect(convert);
  } catch (e) { console.warn(e); }
}
(async function init() {
  renderTabs();
  activate('home');
  updateToolbar();
  syncMax();
  requestAnimationFrame(() => requestAnimationFrame(() => platform.win.showIfHidden().catch(() => {})));
  try { await platform.onFilesPending(takePending); } catch (e) { console.warn(e); }
  takePending();
  platform.shellMenu.status().then(s => { shellMenuState = s; }).catch(() => {});
  // 每天零点（北京时间）换一首诗
  setInterval(() => renderDayplate(), 10 * 60e3);
})();

// 调试 / 自动化测试用：在控制台里可以拿到这些对象
Object.assign(window, { __pv: { state, reader, merger, editbar, organizer, openEntries, activate, saveTab, rebuildPages, quickPages, undo, redo, isDirty, getBytes, convertAndOpen, handleDrop } });
