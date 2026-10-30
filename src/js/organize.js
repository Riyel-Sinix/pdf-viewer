// 整理页面：一份文档的所有页铺成缩略图——拖动排序，旋转、复制、删除，插入空白页、别的 PDF、图片，提取所选页另存。
// 「完成」后用 pdf.js 的 extractPages 重新拼一份（书签、链接、表单、批注都留着），旋转和空白页在后台线程里用 pdf-lib 补上。
import { $, $$, esc, nextId, stripExt } from './util.js';
import { icon } from './icons.js';
import * as platform from './platform.js';
import { getMergeWorker } from './pdfjs.js';
import { loadPdf, destroyPdf, renderThumb, pdfErrorText, docInfo, tinyPdf } from './reader.js';
import { dlgHead, confirmDlg } from './ui.js';
import { formatRange } from './merge.js';

const A4 = [595.28, 841.89];

function runWorker(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pages-worker.js', import.meta.url), { type: 'module' });
    const done = () => w.terminate();
    w.onmessage = ({ data }) => { done(); data.ok ? resolve(data.bytes) : reject(new Error(data.error)); };
    w.onerror = e => { done(); reject(new Error(e.message || '后台线程出错')); };
    w.postMessage(msg, transfer);
  });
}

/* ---------- 按页面清单生成新文档 ----------
 * srcs[0] 是当前文档 { name, bytes, password, encrypted }，后面是插进来的 PDF（同样的字段）；
 * items：{ kind: 'page', src, page, rot } | { kind: 'blank', w, h } | { kind: 'image', file, rot }
 * 返回 { bytes, encrypted }：encrypted 表示结果沿用了当前文档的加密（重新打开要用原来的密码） */
export async function buildPages(srcs, items, { info = null } = {}) {
  const blanks = [], rotations = [], infos = [], groups = new Map(), seen = new Map(), copySlots = [];
  let slot = 0;
  items.forEach((it, index) => {
    if (it.kind === 'blank') { blanks.push({ index, w: it.w, h: it.h }); return; }
    if (it.rot) rotations.push({ index, rot: it.rot });
    if (it.kind === 'image') { infos.push({ file: it.file, pageIndices: [slot++] }); return; }
    // 同一页要出现好几次（复制）：第几次出现就放进第几组，一组里每页只能出现一次
    const key = `${it.src}:${it.page}`, level = seen.get(key) || 0;
    seen.set(key, level + 1);
    const gk = `${it.src}:${level}`;
    if (!groups.has(gk)) groups.set(gk, { src: it.src, map: new Map() });
    if (level) copySlots.push(slot);
    groups.get(gk).map.set(it.page, slot++);
  });
  const total = items.length;
  if (!slot) return { bytes: await runWorker({ create: true, blanks, info, total }), encrypted: false };
  for (const g of groups.values()) {
    const s = srcs[g.src], inc = [...g.map.keys()].sort((a, b) => a - b);
    infos.push({ document: g.src === 0 ? null : s.bytes, password: s.password || undefined, includePages: inc, pageIndices: inc.map(p => g.map.get(p)) });
  }
  for (const inf of infos) if (inf.file) { inf.image = await createImageBitmap(inf.file); delete inf.file; }
  // pdf.js 只从一份加密文件取页时会沿用它的加密；可 pdf-lib 改不了加密文件（旋转、空白页），插进来的文件的密码也不该沿用——这些情况就解密
  const docs = new Set([...groups.values()].map(g => g.src));
  const only = docs.size === 1 ? [...docs][0] : -1;
  const keepEnc = only >= 0 && !!srcs[only].encrypted;
  const decrypt = keepEnc && (only !== 0 || blanks.length > 0 || rotations.length > 0);
  if (decrypt) infos.push({ document: tinyPdf(), includePages: [0], pageIndices: [slot] });
  const base = srcs[0];
  const { pdf: primary } = await loadPdf(base.bytes.slice(), { name: base.name, worker: getMergeWorker(), password: base.password });
  let out;
  try { out = await primary.extractPages(infos); } finally { destroyPdf(primary); }
  if (!out?.length) throw new Error('pdf.js 没能生成新文件（可能有文件结构损坏）');
  // 沿用加密时 pdf-lib 改不了文件：副本页带进来的重复书签就留着（总比为了去掉它把密码丢了好）
  if (keepEnc && !decrypt) return { bytes: out, encrypted: true };
  return { bytes: await runWorker({ bytes: out, dropLast: decrypt, copySlots, blanks, rotations, info, total }, [out.buffer]), encrypted: false };
}

// 整理之后加密还在不在（给提示用）：和 buildPages 里的判断一致
function willDecrypt(srcs, items) {
  const docs = new Set(items.filter(it => it.kind === 'page').map(it => it.src));
  if (docs.size !== 1) return false;
  const only = [...docs][0];
  return !!srcs[only].encrypted && (only !== 0 || items.some(it => it.kind === 'blank' || it.rot));
}

/* ---------- 整理页面的对话框 ---------- */
const DLG = $('#orgDlg');
export const organizerOpen = () => DLG.open;
const ROT_TXT = { 90: '右转', 180: '倒转', 270: '左转' };

export class Organizer {
  /* hooks: { getBytes(tab), apply(tab, srcs, items) -> Promise<bool> } */
  constructor(hooks) {
    this.hooks = hooks;
    DLG.addEventListener('cancel', e => { e.preventDefault(); this.#escape(); });
    DLG.addEventListener('keydown', e => this.#onKey(e));
    DLG.addEventListener('click', e => this.#onClick(e));
    DLG.addEventListener('pointerdown', e => this.#onPointerDown(e));
    DLG.addEventListener('contextmenu', e => e.preventDefault());
  }

  async open(tab, { select = null } = {}) {
    if (DLG.open || !tab?.pdf) return;
    this.tab = tab;
    this.srcs = [{ name: tab.name, pdf: tab.pdf, password: tab.password, encrypted: !!tab.encrypted, own: false }];
    this.items = Array.from({ length: tab.numPages }, (_, p) => ({ id: nextId('o'), kind: 'page', src: 0, page: p, rot: 0 }));
    this.initial = this.items.slice();
    this.past = [];
    this.future = [];
    this.sel = new Set(select != null && this.items[select] ? [this.items[select].id] : []);
    this.anchor = [...this.sel][0] || null;
    this.thumbs = new Map();       // key → url
    this.cells = new Map();        // id → 元素
    this.visible = new Set();      // 在可视范围附近的格子 id
    this.queue = [];
    this.busy = false;
    DLG.innerHTML = `<div class="ohead">${dlgHead('整理页面', { k: 'Ordering the Leaves', sub: tab.name })}
        <div class="otools">
          <button class="ibtn" data-a="all" title="全选（Ctrl+A）">全选</button>
          <span class="osep"></span>
          <button class="ibtn" data-a="rl" data-need title="所选页向左转 90°">${icon('rotCcw', 16)}向左转</button>
          <button class="ibtn" data-a="rr" data-need title="所选页向右转 90°">${icon('rotCw', 16)}向右转</button>
          <button class="ibtn" data-a="dup" data-need title="在每个所选页后面放一份副本">${icon('copy', 16)}复制</button>
          <button class="ibtn" data-a="del" data-need title="删除所选页（Delete）">${icon('trash', 16)}删除</button>
          <span class="osep"></span>
          <button class="ibtn" data-a="blank" title="在所选页后面（没选就在最后）插入一张空白页">${icon('blank', 16)}空白页</button>
          <button class="ibtn" data-a="pdf" title="把别的 PDF 的页面插进来">${icon('addPdf', 16)}插入 PDF…</button>
          <button class="ibtn" data-a="img" title="把图片做成新的页面">${icon('image', 16)}插入图片…</button>
          <span class="osep"></span>
          <button class="ibtn" data-a="ext" data-need title="把所选页另存成一个新文件（这份文档不变）">${icon('extract', 16)}提取所选…</button>
          <span class="sp"></span>
          <button class="tb" data-a="undo" title="撤销（Ctrl+Z）">${icon('undo')}</button>
          <button class="tb" data-a="redo" title="重做（Ctrl+Y）">${icon('redo')}</button>
        </div></div>
      <div class="ogrid" id="oGrid" tabindex="-1"></div>
      <div class="ofoot"><span class="osum" id="oSum"></span><span class="onote" id="oNote"></span><span class="sp"></span>
        <button class="btn ghost" data-a="cancel">取消</button><button class="btn" data-a="done">${icon('check', 18)}完成</button></div>`;
    this.grid = $('#oGrid', DLG);
    this.io = new IntersectionObserver(ents => {
      for (const en of ents) {
        const id = en.target.dataset.id;
        if (en.isIntersecting) { this.visible.add(id); this.#queueThumb(id); } else this.visible.delete(id);
      }
    }, { root: this.grid, rootMargin: '400px 0px' });
    DLG.showModal();
    this.#render();
    this.grid.focus({ preventScroll: true });
    if (this.anchor) this.cells.get(this.anchor)?.scrollIntoView({ block: 'center' });
  }

  #close() {
    this.io?.disconnect();
    this.thumbs.forEach(u => URL.revokeObjectURL(u));
    this.thumbs.clear();
    this.cells.clear();
    this.visible.clear();
    this.queue = [];
    DLG.close();
    DLG.innerHTML = '';
  }
  #dropSources() { for (const s of this.srcs.slice(1)) { destroyPdf(s.pdf); s.pdf = null; } }

  /* ---------- 画网格（元素按 id 复用，缩略图不用重画） ---------- */
  #render() {
    const grid = this.grid, keep = new Set();
    let n = 0;
    for (const it of this.items) {
      n++;
      keep.add(it.id);
      let el = this.cells.get(it.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ocell';
        el.dataset.id = it.id;
        el.innerHTML = `<div class="opg"></div><div class="ono"><b></b><small></small></div>
          <div class="oops"><button data-o="rl" title="向左转">${icon('rotCcw', 15)}</button><button data-o="rr" title="向右转">${icon('rotCw', 15)}</button><button data-o="rm" title="删除">${icon('close', 15, 2)}</button></div>
          <span class="otick">${icon('check', 13, 2.6)}</span>`;
        this.cells.set(it.id, el);
        this.io.observe(el);
      }
      el.querySelector('b').textContent = n;
      el.querySelector('small').textContent = this.#sub(it, n - 1);
      el.classList.toggle('sel', this.sel.has(it.id));
      el.classList.toggle('ins', it.kind !== 'page' || it.src !== 0);
      this.#paint(el, it);
      grid.append(el);          // 按顺序重新排（append 会移动已有元素）
    }
    for (const [id, el] of this.cells) if (!keep.has(id)) { this.io.unobserve(el); el.remove(); this.cells.delete(id); this.visible.delete(id); }
    this.#sync();
  }
  #sub(it, i) {
    if (it.kind === 'blank') return '空白页';
    const parts = [];
    if (it.kind === 'image') parts.push('图片');
    else if (it.src !== 0) parts.push(`${stripExt(this.srcs[it.src].name)} 第 ${it.page + 1} 页`);
    else if (this.items.findIndex(x => x.kind === 'page' && x.src === 0 && x.page === it.page) !== i) parts.push(`第 ${it.page + 1} 页的副本`);
    else if (it.page !== i) parts.push(`原第 ${it.page + 1} 页`);
    if (it.rot) parts.push(ROT_TXT[it.rot]);
    return parts.join(' · ');
  }
  #thumbKey(it) { return it.kind === 'page' ? `${it.src}:${it.page}:${it.rot}` : it.kind === 'image' ? `i:${it.id}` : ''; }
  // 把已有的缩略图放进格子；还没有的排队去画
  #paint(el, it) {
    const pg = el.querySelector('.opg');
    if (it.kind === 'blank') {
      const s = Math.min(112 / it.w, 148 / it.h), k = `b:${it.w}x${it.h}`;
      if (pg.dataset.key !== k) { pg.dataset.key = k; pg.innerHTML = `<span class="blankpg" style="width:${Math.round(it.w * s)}px;height:${Math.round(it.h * s)}px"></span>`; }
      return;
    }
    const key = this.#thumbKey(it);
    if (it.kind === 'image') {
      if (!this.thumbs.has(key)) this.thumbs.set(key, URL.createObjectURL(it.file));
      const k = key + ':' + it.rot;
      if (pg.dataset.key !== k) { pg.dataset.key = k; pg.innerHTML = `<span class="imgpg" style="--r:${it.rot}deg;--s:${it.rot % 180 ? 0.8 : 1}"><img src="${this.thumbs.get(key)}" alt="" draggable="false"></span>`; }
      return;
    }
    const url = this.thumbs.get(key);
    if (url && pg.dataset.key === key) return;
    pg.dataset.key = url ? key : '';
    pg.innerHTML = url ? `<img src="${url}" alt="" draggable="false">` : '<span class="ph"></span>';
    if (!url && this.visible.has(it.id)) this.#queueThumb(it.id);      // 转了方向：看得见的格子不会再触发 IntersectionObserver，自己排队
  }
  #queueThumb(id) {
    const it = this.items.find(x => x.id === id);
    if (!it || it.kind !== 'page' || this.thumbs.has(this.#thumbKey(it)) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.#pump();
  }
  async #pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && DLG.open) {
        const id = this.queue.shift(), it = this.items.find(x => x.id === id);
        if (!it || it.kind !== 'page') continue;
        const key = this.#thumbKey(it), pdf = this.srcs[it.src]?.pdf;
        if (this.thumbs.has(key) || !pdf) continue;
        try {
          const r = await renderThumb(pdf, it.page + 1, { width: 112, rotation: it.rot });
          if (!DLG.open) { URL.revokeObjectURL(r.url); break; }
          this.thumbs.set(key, r.url);
        } catch { continue; }
        for (const x of this.items) if (this.#thumbKey(x) === key) { const el = this.cells.get(x.id); if (el) this.#paint(el, x); }
      }
    } finally { this.pumping = false; }
  }
  #sync() {
    const n = this.items.length, k = this.sel.size, orig = this.tab.numPages;
    $('#oSum', DLG).innerHTML = `共 <b>${n}</b> 页${n !== orig ? `（原来 ${orig} 页）` : ''}${k ? ` · 已选 ${k} 页` : ''}`;
    $$('[data-need]', DLG).forEach(b => { b.disabled = !k; });
    $('[data-a=undo]', DLG).disabled = !this.past.length;
    $('[data-a=redo]', DLG).disabled = !this.future.length;
    $('[data-a=done]', DLG).disabled = !n;
    const note = $('#oNote', DLG);
    if (!n) note.textContent = '一页都没有了——至少要留一页';
    else if (willDecrypt(this.srcs, this.items)) note.textContent = '注意：旋转或加空白页后，这份带密码的文件保存时就不再加密';
    else if (this.tab.encrypted && this.srcs.length > 1 && this.items.some(it => it.kind === 'page' && it.src !== 0)) note.textContent = '插入了别的 PDF：保存后的文件不再加密';
    else note.textContent = '拖动页面调整顺序；按住 Ctrl 或 Shift 可以多选';
  }
  #syncSel() { for (const [id, el] of this.cells) el.classList.toggle('sel', this.sel.has(id)); this.#sync(); }

  /* ---------- 修改（都能撤销） ---------- */
  #commit(next) {
    this.past.push(this.items);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.items = next;
    for (const id of [...this.sel]) if (!next.some(it => it.id === id)) this.sel.delete(id);
    this.#render();
  }
  #undo() { if (!this.past.length) return; this.future.push(this.items); this.items = this.past.pop(); this.#prune(); this.#render(); }
  #redo() { if (!this.future.length) return; this.past.push(this.items); this.items = this.future.pop(); this.#prune(); this.#render(); }
  #prune() { for (const id of [...this.sel]) if (!this.items.some(it => it.id === id)) this.sel.delete(id); }
  #selected() { return this.items.filter(it => this.sel.has(it.id)); }
  #rotate(ids, d) {
    this.#commit(this.items.map(it => {
      if (!ids.has(it.id)) return it;
      if (it.kind === 'blank') return d % 180 ? { ...it, w: it.h, h: it.w } : it;      // 空白页转一下就是宽高对调
      return { ...it, rot: ((it.rot + d) % 360 + 360) % 360 };
    }));
  }
  #delete(ids) { this.#commit(this.items.filter(it => !ids.has(it.id))); }
  #duplicate(ids) {
    const next = [], copies = new Set();
    for (const it of this.items) {
      next.push(it);
      if (ids.has(it.id)) { const c = { ...it, id: nextId('o') }; next.push(c); copies.add(c.id); }
    }
    this.sel = copies;
    this.#commit(next);
  }
  // 新页面放在所选的最后一页后面；没选就放在最后
  #insertAt() {
    let at = -1;
    this.items.forEach((it, i) => { if (this.sel.has(it.id)) at = i; });
    return at < 0 ? this.items.length : at + 1;
  }
  #insert(newItems, at = this.#insertAt()) {
    if (!newItems.length) return;
    this.sel = new Set(newItems.map(it => it.id));
    this.anchor = newItems[0].id;
    this.#commit([...this.items.slice(0, at), ...newItems, ...this.items.slice(at)]);
    this.cells.get(newItems[0].id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async #sizeOf(it) {
    try {
      if (it?.kind === 'blank') return [it.w, it.h];
      if (it?.kind === 'page') {
        const p = await this.srcs[it.src].pdf.getPage(it.page + 1), vp = p.getViewport({ scale: 1, rotation: p.rotate + it.rot });
        return [vp.width, vp.height];
      }
    } catch {}
    return A4;
  }
  async #addBlank() {
    const at = this.#insertAt(), near = this.items[at - 1] || this.items[at];
    const [w, h] = await this.#sizeOf(near);
    this.#insert([{ id: nextId('o'), kind: 'blank', w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 }], at);
  }
  async #addPdfs() {
    let entries = [];
    try { entries = await platform.pickPdfs({ multiple: true, title: '选择要插入的 PDF' }); } catch (e) { this.#note('打不开文件选择框：' + e); return; }
    const at = this.#insertAt(), added = [];
    for (const en of entries) {
      try {
        const bytes = await en.read();
        const { pdf, password } = await loadPdf(bytes.slice(), { name: en.name, worker: getMergeWorker() });
        if (!DLG.open) { destroyPdf(pdf); return; }
        const src = this.srcs.push({ name: en.name, pdf, bytes, password, encrypted: (await docInfo(pdf)).encrypted, own: true }) - 1;
        for (let p = 0; p < pdf.numPages; p++) added.push({ id: nextId('o'), kind: 'page', src, page: p, rot: 0 });
      } catch (e) {
        this.#note(e?.cancelled ? `没输密码，「${en.name}」没插进来` : `「${en.name}」读不了：${pdfErrorText(e)}`);
      }
    }
    if (DLG.open) this.#insert(added, at);
  }
  async #addImages() {
    const files = await platform.pickImages({ multiple: true });
    if (DLG.open) this.#insert(files.map(file => ({ id: nextId('o'), kind: 'image', file, rot: 0 })));
  }
  #note(text) { const el = $('#oNote', DLG); if (el) { el.textContent = text; el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 1500); } }

  // 提取所选页另存（这份文档不动）
  async #extract() {
    const pick = this.#selected();
    if (!pick.length || this.busy) return;
    this.busy = true;
    this.#note('正在提取…');
    try {
      const srcs = await this.#withBytes();
      const { bytes } = await buildPages(srcs, pick, { info: await docInfo(this.tab.pdf) });
      const pages = pick.filter(it => it.kind === 'page' && it.src === 0).map(it => it.page);
      const name = `${stripExt(this.tab.name)}（${pages.length === pick.length ? `第 ${formatRange(pages)} 页` : `${pick.length} 页`}）.pdf`;
      const res = await platform.savePdf(bytes, name, this.tab.path ? platform.dirname(this.tab.path) : '');
      this.#note(res ? `已另存为「${res.name}」` : '没有保存（取消了）');
    } catch (e) {
      console.error(e);
      this.#note('提取失败：' + pdfErrorText(e));
    } finally { this.busy = false; }
  }
  async #withBytes() {
    const srcs = this.srcs.map(s => ({ ...s }));
    srcs[0].bytes = await this.hooks.getBytes(this.tab);
    return srcs;
  }
  #changed() { return this.items.length !== this.initial.length || this.items.some((it, i) => it !== this.initial[i]); }
  async #done() {
    if (this.busy) return;
    if (!this.#changed()) { this.#dropSources(); this.#close(); return; }
    const tab = this.tab, srcs = this.srcs.map(s => ({ name: s.name, bytes: s.bytes, password: s.password, encrypted: s.encrypted })), items = this.items;
    this.#dropSources();
    this.#close();
    await this.hooks.apply(tab, srcs, items);
  }
  #escape() {
    if (this.drag) return;
    if (this.sel.size) { this.sel.clear(); this.#syncSel(); return; }
    this.#cancel();
  }
  async #cancel() {
    if (this.busy) return;
    if (this.#changed() && !await confirmDlg({ title: '放弃这次整理？', body: '刚才对页面做的调整都不会保留。', ok: '放弃', danger: true })) return;
    this.#dropSources();
    this.#close();
  }

  /* ---------- 点击 / 键盘 ---------- */
  #onClick(e) {
    const a = e.target.closest('[data-a]');
    if (a && !a.disabled) {
      const sel = new Set(this.sel);
      switch (a.dataset.a) {
        case 'all': this.sel = new Set(this.items.map(it => it.id)); this.#syncSel(); break;
        case 'rl': this.#rotate(sel, -90); break;
        case 'rr': this.#rotate(sel, 90); break;
        case 'dup': this.#duplicate(sel); break;
        case 'del': this.#delete(sel); break;
        case 'blank': this.#addBlank(); break;
        case 'pdf': this.#addPdfs(); break;
        case 'img': this.#addImages(); break;
        case 'ext': this.#extract(); break;
        case 'undo': this.#undo(); break;
        case 'redo': this.#redo(); break;
        case 'cancel': this.#cancel(); break;
        case 'done': this.#done(); break;
      }
      return;
    }
    const o = e.target.closest('[data-o]');
    if (o) {
      const id = o.closest('.ocell').dataset.id, ids = new Set([id]);
      if (o.dataset.o === 'rm') this.#delete(ids);
      else this.#rotate(ids, o.dataset.o === 'rl' ? -90 : 90);
      return;
    }
    if (e.target === this.grid) { this.sel.clear(); this.#syncSel(); }      // 点空白处：取消选择
  }
  #onKey(e) {
    if (e.target.closest('dialog') !== DLG || e.target.matches('input,textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((k === 'Delete' || k === 'Backspace') && this.sel.size) { e.preventDefault(); this.#delete(new Set(this.sel)); }
    else if (ctrl && k === 'a') { e.preventDefault(); this.sel = new Set(this.items.map(it => it.id)); this.#syncSel(); }
    else if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); this.#undo(); }
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.#redo(); }
    else if (ctrl) { if (['o', 'w', 's', 'p', 'f', 'r', 'm', 'e', 'd'].includes(k)) e.preventDefault(); }   // 别让主窗口的快捷键漏下去
  }
  #clickSelect(id, e) {
    if (e.shiftKey && this.anchor) {
      const ids = this.items.map(it => it.id), a = ids.indexOf(this.anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        if (!(e.ctrlKey || e.metaKey)) this.sel.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.sel.add(ids[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id);
      this.anchor = id;
    } else {
      this.sel = new Set([id]);
      this.anchor = id;
    }
    this.#syncSel();
  }

  /* ---------- 拖动排序：拖着所选的页（没选中的话就是按住的那页），插到鼠标所在格子的前面或后面 ---------- */
  #onPointerDown(e) {
    const cell = e.target.closest('.ocell');
    if (!cell || e.button !== 0 || e.target.closest('.oops') || !this.grid.contains(cell)) return;
    e.preventDefault();
    this.grid.focus({ preventScroll: true });
    const id = cell.dataset.id, x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const move = ev => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) { started = true; this.#dragStart(id, ev); }
      if (started) this.#dragMove(ev);
    };
    const up = ev => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (started) this.#dragEnd(ev.type === 'pointerup');
      else if (ev.type === 'pointerup') this.#clickSelect(id, ev);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }
  #dragStart(id, ev) {
    if (!this.sel.has(id)) { this.sel = new Set([id]); this.anchor = id; this.#syncSel(); }
    const ids = this.items.filter(it => this.sel.has(it.id)).map(it => it.id);
    const ghost = document.createElement('div');
    ghost.className = 'oghost';
    const img = this.cells.get(id)?.querySelector('.opg')?.cloneNode(true);
    if (img) ghost.append(img);
    if (ids.length > 1) ghost.insertAdjacentHTML('beforeend', `<span class="cnt">${ids.length}</span>`);
    DLG.append(ghost);
    const caret = document.createElement('div');
    caret.className = 'ocaret';
    caret.hidden = true;
    this.grid.append(caret);
    ids.forEach(x => this.cells.get(x)?.classList.add('dragging'));
    this.drag = { ids, ghost, caret, at: null, raf: 0, y: ev.clientY };
    this.#dragMove(ev);
  }
  #dragMove(ev) {
    const d = this.drag;
    if (!d) return;
    d.ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px) rotate(-3deg)`;
    d.y = ev.clientY;
    const g = this.grid.getBoundingClientRect(), gr = this.grid;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ocell');
    let at = null, r = null, after = false;
    if (el && gr.contains(el)) {
      r = el.getBoundingClientRect();
      after = ev.clientX > r.left + r.width / 2;
      at = this.items.findIndex(it => it.id === el.dataset.id) + (after ? 1 : 0);
    } else if (ev.clientX >= g.left && ev.clientX <= g.right && ev.clientY >= g.top && ev.clientY <= g.bottom) {
      // 在格子之间的空隙或者最后一行后面：找最近的格子
      let best = null, bd = Infinity;
      for (const [id, c] of this.cells) {
        const cr = c.getBoundingClientRect();
        const dx = Math.max(cr.left - ev.clientX, 0, ev.clientX - cr.right), dy = Math.max(cr.top - ev.clientY, 0, ev.clientY - cr.bottom);
        const dd = dx * dx + dy * dy * 4;
        if (dd < bd) { bd = dd; best = [id, cr]; }
      }
      if (best) {
        r = best[1];
        after = ev.clientX > r.left + r.width / 2 || ev.clientY > r.bottom;
        at = this.items.findIndex(it => it.id === best[0]) + (after ? 1 : 0);
      }
    }
    d.at = at;
    if (r) {
      d.caret.hidden = false;
      const x = (after ? r.right + 7 : r.left - 7) - g.left + gr.scrollLeft, y = r.top - g.top + gr.scrollTop;
      d.caret.style.transform = `translate(${x - 2}px, ${y}px)`;
      d.caret.style.height = r.height + 'px';
    } else d.caret.hidden = true;
    // 拖到上下边缘时自动滚动
    cancelAnimationFrame(d.raf);
    const edge = d.y < g.top + 48 ? -1 : d.y > g.bottom - 48 ? 1 : 0;
    if (edge) { const step = () => { gr.scrollTop += edge * 10; d.raf = requestAnimationFrame(step); }; d.raf = requestAnimationFrame(step); }
  }
  #dragEnd(drop) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.caret.remove();
    d.ids.forEach(x => this.cells.get(x)?.classList.remove('dragging'));
    if (!drop || d.at == null) return;
    const moving = new Set(d.ids);
    const before = this.items.slice(0, d.at).filter(it => !moving.has(it.id)).length;
    const rest = this.items.filter(it => !moving.has(it.id)), mv = this.items.filter(it => moving.has(it.id));
    const next = [...rest.slice(0, before), ...mv, ...rest.slice(before)];
    if (next.every((it, i) => it === this.items[i])) return;
    this.#commit(next);
  }
}
