// 合并 PDF（「装订」）：文件列表可拖动排序，每个文件可以只取部分页、整体旋转；
// 拼页用 pdf.js 6 的 extractPages（Firefox 合并功能用的同一套：能读加密文件，保留原书签、链接、表单），
// 再在后台线程里用 pdf-lib 给每个文件加一个书签、旋转页面、写文档信息。
import { $, $$, esc, fmtSize, stripExt, nextId, clamp } from './util.js';
import { icon, FLOURISH } from './icons.js';
import { prefs, savePrefs } from './store.js';
import * as platform from './platform.js';
import { toast, openDialog, closeDialog, dlgHead, showMenu, confirmDlg } from './ui.js';
import { pdfjsLib, DOC_OPTS, getMergeWorker } from './pdfjs.js';
import { loadPdf, renderThumb, destPageIndex, pdfErrorText, destroyPdf, docInfo, tinyPdf } from './reader.js';

/* ---------- 页码范围：「1-3, 5, 8-」「-3」「10-1」（倒序）「奇数」「偶数」，全角标点也认 ---------- */
export function parseRange(text, n) {
  const s = String(text || '').trim().replace(/[，、；;\s]+/g, ',').replace(/[－—–~～至到]/g, '-').replace(/^,+|,+$/g, '');
  if (!s || /^(全部|所有|all|\*)$/i.test(s)) return { pages: null };
  const out = [];
  for (const tok of s.split(',')) {
    if (!tok) continue;
    if (/^(奇|奇数|奇数页|odd)$/i.test(tok)) { for (let i = 0; i < n; i += 2) out.push(i); continue; }
    if (/^(偶|偶数|偶数页|even)$/i.test(tok)) { for (let i = 1; i < n; i += 2) out.push(i); continue; }
    if (/^(末页|最后一页|last)$/i.test(tok)) { out.push(n - 1); continue; }
    const m = tok.match(/^(\d*)-(\d*)$/);
    if (m) {
      if (!m[1] && !m[2]) return { error: `看不懂「${tok}」` };
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n;
      if (a < 1 || b < 1 || a > n || b > n) return { error: `超出范围了，这份只有 ${n} 页` };
      if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
      else for (let i = a; i >= b; i--) out.push(i - 1);
      continue;
    }
    if (/^\d+$/.test(tok)) {
      const a = +tok;
      if (a < 1 || a > n) return { error: `没有第 ${a} 页，这份只有 ${n} 页` };
      out.push(a - 1);
      continue;
    }
    return { error: `看不懂「${tok}」` };
  }
  if (!out.length) return { error: '一页都没选上' };
  return { pages: out };
}
export function formatRange(pages) {
  const parts = [];
  for (let i = 0; i < pages.length;) {
    let j = i;
    const step = pages[i + 1] - pages[i];
    if (step === 1 || step === -1) while (j + 1 < pages.length && pages[j + 1] - pages[j] === step) j++;
    parts.push(j > i ? `${pages[i] + 1}-${pages[j] + 1}` : `${pages[i] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}
const allPages = n => Array.from({ length: n }, (_, i) => i);

export class Merger {
  /* hooks: { listTabs() -> [{ name, path, password, getBytes() }], openResult(name, bytes, path), onCount(n),
   *          prepare(entries) -> entries（不是 PDF 的先转成 PDF）, filters() -> 选文件时的筛选项 } */
  constructor(hooks) {
    this.hooks = hooks;
    this.items = [];
    this.root = $('#merge');
    this.busy = false;
    this.root.addEventListener('click', e => this.#onClick(e));
    this.root.addEventListener('input', e => this.#onInput(e));
    this.root.addEventListener('change', e => this.#onChange(e));
    this.root.addEventListener('focusout', e => this.#onBlur(e));
    this.root.addEventListener('pointerdown', e => this.#onGrip(e));
    this.root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[data-r]')) e.target.blur(); });
    this.render();
  }

  get count() { return this.items.length; }

  /* ---------- 添加 ---------- */
  async addEntries(entries) {
    if (this.hooks.prepare) entries = await this.hooks.prepare(entries);       // 图片、Office 文档等先转成 PDF（顺序不变）
    const added = [];
    for (const en of entries) {
      if (en.name && !/\.pdf$/i.test(en.name) && en.path) { toast(`「${en.name}」不是 PDF，跳过了`, { kind: 'err' }); continue; }
      const it = { id: nextId('m'), name: en.name || '未命名.pdf', path: en.path || null, dir: en.dir || (en.path ? platform.dirname(en.path) : ''), size: en.size ?? null, password: en.password || null,
        bytes: null, pdf: null, numPages: 0, rangeText: '', selection: null, rotation: 0, cover: null, thumbs: new Map(), error: '', loading: true };
      this.items.push(it);
      added.push([it, en]);
    }
    if (!added.length) return;
    this.render();
    this.hooks.onCount?.(this.count);
    for (const [it, en] of added) await this.#load(it, en);   // 一个个来：要输密码时不会同时弹好几个框
  }
  async #load(it, en) {
    try {
      const bytes = await en.read();
      it.bytes = bytes;
      it.size = bytes.length;
      const { pdf, password } = await loadPdf(bytes.slice(), { name: it.name, worker: getMergeWorker(), password: it.password });
      it.pdf = pdf;
      it.password = password;
      it.numPages = pdf.numPages;
      it.encrypted = (await docInfo(pdf)).encrypted;
      it.loading = false;
      if (!this.items.includes(it)) { destroyPdf(pdf); return; }
      this.#updateCard(it, true);
      this.#cover(it);
    } catch (e) {
      it.loading = false;
      if (e?.cancelled) { this.#remove(it); toast(`没输密码，「${it.name}」没有加进来`); return; }
      it.error = pdfErrorText(e);
      this.#updateCard(it, true);
    }
    this.#summary();
  }
  async #cover(it) {
    if (!it.pdf) return;
    const p = (it.selection?.[0] ?? 0) + 1, key = `c${p}:${it.rotation}`;
    try {
      if (!it.thumbs.has(key)) it.thumbs.set(key, await renderThumb(it.pdf, p, { width: 74, rotation: it.rotation }));
      it.cover = it.thumbs.get(key);
      it.coverPage = p - 1;
      const cv = $(`.mcard[data-id="${it.id}"] .cv`, this.root);
      if (cv) cv.innerHTML = `<img src="${it.cover.url}" alt="">`;
    } catch {}
  }
  async addFromDialog() {
    const filters = this.hooks.filters?.() || [platform.PDF_FILTER];
    const entries = await platform.pickFiles({ multiple: true, title: '选择要合并的文件', filters }).catch(e => { toast('打不开文件选择框：' + e, { kind: 'err' }); return []; });
    if (entries.length) this.addEntries(entries);
  }
  addFromTabs(anchor) {
    const tabs = this.hooks.listTabs();
    if (!tabs.length) { toast('现在没有打开的文档'); return; }
    showMenu(anchor, [{ head: '加入已打开的文档' }, ...tabs.map(t => ({ label: t.name, icon: 'book', act: () => this.addEntries([{ name: t.name, path: t.path, password: t.password, read: t.getBytes }]) })),
      tabs.length > 1 ? '-' : null, tabs.length > 1 ? { label: '全部加入', icon: 'plus', act: () => this.addEntries(tabs.map(t => ({ name: t.name, path: t.path, password: t.password, read: t.getBytes }))) } : null]);
  }

  /* ---------- 删除 / 排序 ---------- */
  #remove(it) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.#dispose(it);
    this.render();
    this.hooks.onCount?.(this.count);
  }
  #dispose(it) {
    it.thumbs.forEach(t => URL.revokeObjectURL(t.url));
    it.thumbs.clear();
    destroyPdf(it.pdf);
    it.pdf = null;
    it.bytes = null;
  }
  async clear() {
    if (!this.items.length) return;
    if (!await confirmDlg({ title: '清空合并列表？', body: `列表里的 ${this.items.length} 个文件会被移出（不会删除文件本身）。`, ok: '清空', danger: true })) return;
    this.items.forEach(it => this.#dispose(it));
    this.items = [];
    this.render();
    this.hooks.onCount?.(0);
  }
  #move(it, d) {
    const i = this.items.indexOf(it), j = i + d;
    if (i < 0 || j < 0 || j >= this.items.length) return;
    this.#flip(() => { [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; this.#reorderDom(); });
  }
  #reorderDom() {
    const list = $('#mlist', this.root);
    this.items.forEach((it, i) => {
      const el = $(`.mcard[data-id="${it.id}"]`, list);
      if (el) { list.append(el); el.querySelector('.idx').textContent = i + 1; }
    });
  }
  #flip(change) {     // FLIP 动画：位置变化平滑过渡
    const cards = $$('.mcard', this.root), before = new Map(cards.map(c => [c, c.getBoundingClientRect().top]));
    change();
    for (const c of cards) {
      const dy = before.get(c) - c.getBoundingClientRect().top;
      if (!dy) continue;
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.3,.7,.3,1)' });
    }
  }
  // 按住左边的把手拖动排序
  #onGrip(e) {
    const grip = e.target.closest('.grip');
    if (!grip || e.button !== 0 || this.busy) return;
    const card = grip.closest('.mcard'), list = $('#mlist', this.root), scroller = this.root;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const r0 = card.getBoundingClientRect();
    const grabDy = e.clientY - r0.top;
    let lastY = e.clientY, raf = 0;
    card.classList.add('lift');
    const place = () => {
      card.style.transform = 'none';
      const natural = card.getBoundingClientRect().top;
      card.style.transform = `translateY(${lastY - grabDy - natural}px) rotate(-.6deg) scale(1.01)`;
    };
    const move = ev => {
      lastY = ev.clientY;
      const others = $$('.mcard', list).filter(c => c !== card);
      let before = null;
      for (const o of others) { const r = o.getBoundingClientRect(); if (lastY < r.top + r.height / 2) { before = o; break; } }
      if (card.nextElementSibling !== before || (before === null && list.lastElementChild !== card)) {
        const pos = new Map(others.map(o => [o, o.getBoundingClientRect().top]));
        list.insertBefore(card, before);
        for (const o of others) {
          const dy = pos.get(o) - o.getBoundingClientRect().top;
          if (dy) o.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
        }
      }
      place();
      // 拖到上下边缘时自动滚动
      const sr = scroller.getBoundingClientRect();
      cancelAnimationFrame(raf);
      const edge = lastY < sr.top + 60 ? -1 : lastY > sr.bottom - 90 ? 1 : 0;
      if (edge) { const step = () => { scroller.scrollTop += edge * 9; place(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }
    };
    const up = () => {
      cancelAnimationFrame(raf);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const from = card.getBoundingClientRect().top;
      card.style.transform = '';
      card.classList.remove('lift');
      const dy = from - card.getBoundingClientRect().top;
      if (dy) card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
      const order = $$('.mcard', list).map(c => c.dataset.id);
      this.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      $$('.mcard', list).forEach((c, i) => { c.querySelector('.idx').textContent = i + 1; });
      this.#summary();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /* ---------- 界面 ---------- */
  render() {
    const n = this.items.length;
    this.root.innerHTML = `<div class="merge-in">
      <header class="mhead">
        <div><div class="k">The Bookbinder</div><h2>合并 PDF</h2>
          <p>按顺序把几份 PDF 装订成一本。拖动左边的把手排顺序；「页码」里写范围就只取那几页——只放一个文件时，就是提取页面。</p></div>
        <div class="mtools">
          <button class="ibtn" data-m="add">${icon('plus', 16)}添加文件</button>
          <button class="ibtn" data-m="tabs">${icon('book', 16)}从已打开的文档</button>
          ${n ? `<button class="ibtn" data-m="clear">${icon('trash', 16)}清空</button>` : ''}
        </div>
      </header>
      ${n ? `<div class="mlist" id="mlist">${this.items.map((it, i) => this.#cardHTML(it, i)).join('')}</div>`
        : `<div class="mempty" data-m="add">${icon('bind', 42, 1.4)}<div class="big">把要合并的 PDF 拖到这里</div><div>或者点这里选择文件（可以一次选好几个）</div>
           <div class="tip">文件会按列表顺序装订；每个文件的原有书签都会保留，并归到以文件名命名的书签下面。加了密码的 PDF 输入密码后也能合并，合并结果不带密码。${platform.isDesktop ? '图片、Word / Excel / PPT、文本、网页也能直接加进来，会先转成 PDF。' : '图片也能直接加进来，会先转成 PDF。'}</div></div>`}
      <div class="mfoot"><div class="mfoot-in panel">
        <div class="sum" id="mSum"></div>
        <div class="opts">
          <label class="chk"><input type="checkbox" id="mBm"${prefs.mergeBookmarks ? ' checked' : ''}>每个文件生成一个书签</label>
          <label class="chk"><input type="checkbox" id="mOpen"${prefs.mergeOpen ? ' checked' : ''}>完成后打开</label>
        </div>
        <label class="outn">文件名<input id="mName" placeholder="合并.pdf" value="${esc(this.outName || '')}"></label>
        <button class="btn" id="mGo"${n ? '' : ' disabled'}>${icon('bind', 18)}合并并保存</button>
      </div></div>
    </div>`;
    this.#summary();
  }
  #cardHTML(it, i) {
    const n = it.numPages;
    const cnt = this.#countText(it);
    return `<div class="mcard${it.error ? ' broken' : ''}" data-id="${it.id}">
      <span class="idx">${i + 1}</span>
      <button class="grip" title="按住拖动，调整顺序" tabindex="-1">${icon('grip', 18)}</button>
      <div class="cv">${it.cover ? `<img src="${it.cover.url}" alt="">` : '<span class="ph"></span>'}</div>
      <div class="info">
        <div class="nm" title="${esc(it.path || it.name)}">${esc(it.name)}</div>
        <div class="meta">${it.loading ? '正在读取…' : it.error ? '读取失败' : `共 ${n} 页`}${it.size ? ` · ${fmtSize(it.size)}` : ''}${it.password ? ` · <span class="lock">已解密（有打开密码）</span>` : ''}${it.path ? ` · ${esc(platform.dirname(it.path))}` : ''}</div>
        ${it.error ? `<div class="err">${esc(it.error)}——这个文件会被跳过，可以移除它</div>` : `<div class="rng"><label>页码</label>
          <input data-r value="${esc(it.rangeText)}" placeholder="${n ? `全部 ${n} 页；例：1-3, 5, 8-` : ''}" spellcheck="false"${it.loading ? ' disabled' : ''}>
          <span class="cnt${cnt.bad ? ' bad' : ''}">${esc(cnt.text)}</span></div>`}
      </div>
      <div class="ops">
        <button class="tb" data-op="up" title="上移"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
        <button class="tb" data-op="down" title="下移"${i === this.items.length - 1 ? ' disabled' : ''}>${icon('down')}</button>
        <button class="tb" data-op="pick" title="看缩略图挑页"${it.pdf ? '' : ' disabled'}>${icon('pages')}</button>
        <button class="tb" data-op="rot" title="整份顺时针转 90°"${it.pdf ? '' : ' disabled'}>${icon('rotCw')}${it.rotation ? `<span class="rot">${it.rotation}°</span>` : ''}</button>
        <button class="tb" data-op="rm" title="移出列表">${icon('close')}</button>
      </div>
    </div>`;
  }
  #countText(it) {
    if (!it.numPages) return { text: '' };
    const r = parseRange(it.rangeText, it.numPages);
    if (r.error) return { text: r.error, bad: true };
    return { text: r.pages ? `已选 ${r.pages.length} 页` : `全部 ${it.numPages} 页` };
  }
  #updateCard(it, full = false) {
    const el = $(`.mcard[data-id="${it.id}"]`, this.root);
    if (!el) return;
    if (full) {
      const i = this.items.indexOf(it);
      const tmp = document.createElement('div');
      tmp.innerHTML = this.#cardHTML(it, i);
      el.replaceWith(tmp.firstElementChild);
      return;
    }
    const cnt = this.#countText(it), c = $('.cnt', el), inp = $('input[data-r]', el);
    if (c) { c.textContent = cnt.text; c.classList.toggle('bad', !!cnt.bad); }
    inp?.classList.toggle('bad', !!cnt.bad);
  }
  #summary() {
    const el = $('#mSum', this.root);
    if (!el) return;
    let pages = 0, files = 0;
    for (const it of this.items) {
      if (!it.numPages || it.error) continue;
      const r = parseRange(it.rangeText, it.numPages);
      if (r.error) continue;
      files++;
      pages += r.pages ? r.pages.length : it.numPages;
    }
    el.innerHTML = this.items.length ? `<b>${files}</b>份文件，共<b>${pages}</b>页` : '还没有文件';
    const go = $('#mGo', this.root);
    if (go) go.disabled = !files || this.busy;
  }

  #itemOf(el) { const c = el.closest('.mcard'); return c && this.items.find(x => x.id === c.dataset.id); }
  #onClick(e) {
    const m = e.target.closest('[data-m]');
    if (m) {
      if (m.dataset.m === 'add') this.addFromDialog();
      else if (m.dataset.m === 'tabs') this.addFromTabs(m);
      else if (m.dataset.m === 'clear') this.clear();
      return;
    }
    if (e.target.closest('#mGo')) return this.merge();
    const op = e.target.closest('[data-op]');
    if (!op) return;
    const it = this.#itemOf(op);
    if (!it) return;
    const k = op.dataset.op;
    if (k === 'rm') this.#flip(() => this.#remove(it));
    else if (k === 'up') this.#move(it, -1);
    else if (k === 'down') this.#move(it, 1);
    else if (k === 'rot') { it.rotation = (it.rotation + 90) % 360; this.#updateCard(it, true); this.#cover(it); }
    else if (k === 'pick') this.#pickPages(it);
  }
  // 输入时就同步 selection（挑页对话框、封面、合并都以它为准）；失焦时再把文字整理成规范写法
  #onInput(e) {
    if (!e.target.matches('input[data-r]')) return;
    const it = this.#itemOf(e.target);
    if (!it) return;
    it.rangeText = e.target.value;
    if (it.numPages) {
      const r = parseRange(it.rangeText, it.numPages);
      if (!r.error) it.selection = r.pages && !(r.pages.length === it.numPages && r.pages.every((p, i) => p === i)) ? r.pages : null;
    }
    this.#updateCard(it);
    this.#summary();
  }
  #onBlur(e) {
    if (!e.target.matches('input[data-r]')) return;
    const it = this.#itemOf(e.target);
    if (!it || !it.numPages || parseRange(it.rangeText, it.numPages).error) return;
    it.rangeText = it.selection ? formatRange(it.selection) : '';
    e.target.value = it.rangeText;
    this.#updateCard(it);
    const first = it.selection?.[0] ?? 0;
    if (first !== this.#coverPage(it)) this.#cover(it);
  }
  #coverPage(it) { return it.cover ? it.coverPage ?? 0 : -1; }
  #onChange(e) {
    if (e.target.id === 'mBm') { prefs.mergeBookmarks = e.target.checked; savePrefs(); }
    else if (e.target.id === 'mOpen') { prefs.mergeOpen = e.target.checked; savePrefs(); }
    else if (e.target.id === 'mName') this.outName = e.target.value.trim();
  }

  /* ---------- 看缩略图挑页 ---------- */
  async #pickPages(it) {
    if (!it.pdf) return;
    const n = it.numPages;
    const sel = new Set(it.selection ?? allPages(n));
    const ordered = !it.selection || it.selection.every((p, i, a) => i === 0 || p > a[i - 1]);
    let lastClick = -1, io = null;
    const cells = allPages(n).map(p => `<button class="pcell${sel.has(p) ? ' on' : ''}" data-p="${p}"><span class="pg">${(it.thumbs.get(`p${p}:${it.rotation}`)?.url && `<img src="${it.thumbs.get(`p${p}:${it.rotation}`).url}" alt="">`) || '<span class="ph"></span>'}</span><span class="no">第 ${p + 1} 页</span><span class="tick">${icon('check', 14, 2.4)}</span></button>`).join('');
    const v = await openDialog({
      cls: 'picker',
      html: `${dlgHead('挑选页面', { k: 'Choosing the Leaves', sub: it.name })}
        <div class="ptools"><button class="ibtn" data-pk="all">全选</button><button class="ibtn" data-pk="none">全不选</button><button class="ibtn" data-pk="inv">反选</button>
          <button class="ibtn" data-pk="odd">奇数页</button><button class="ibtn" data-pk="even">偶数页</button><span class="sp"></span><span class="sel" id="pkN"></span></div>
        <div class="pgrid" id="pkGrid">${cells}</div>
        <div class="dlg-f"><span class="sub" style="margin-right:auto;align-self:center">点选页面，按住 Shift 可以连选${ordered ? '' : '；确定后会按页码顺序排列（原来写的顺序不保留）'}</span><button class="btn ghost" data-dlg="">取消</button><button class="btn" data-dlg="ok">确定</button></div>`,
      onOpen: d => {
        const grid = d.querySelector('#pkGrid');
        const sync = () => {
          d.querySelectorAll('.pcell').forEach(c => c.classList.toggle('on', sel.has(+c.dataset.p)));
          d.querySelector('#pkN').textContent = `已选 ${sel.size} / ${n} 页`;
          d.querySelector('[data-dlg=ok]').disabled = !sel.size;
        };
        sync();
        d.querySelector('.ptools').addEventListener('click', e => {
          const b = e.target.closest('[data-pk]');
          if (!b) return;
          const k = b.dataset.pk;
          if (k === 'all') allPages(n).forEach(p => sel.add(p));
          else if (k === 'none') sel.clear();
          else if (k === 'inv') allPages(n).forEach(p => sel.has(p) ? sel.delete(p) : sel.add(p));
          else { sel.clear(); allPages(n).forEach(p => { if ((p % 2 === 0) === (k === 'odd')) sel.add(p); }); }
          sync();
        });
        grid.addEventListener('click', e => {
          const c = e.target.closest('.pcell');
          if (!c) return;
          const p = +c.dataset.p, on = !sel.has(p);
          if (e.shiftKey && lastClick >= 0) {
            const [a, b] = p > lastClick ? [lastClick, p] : [p, lastClick];
            for (let i = a; i <= b; i++) on ? sel.add(i) : sel.delete(i);
          } else on ? sel.add(p) : sel.delete(p);
          lastClick = p;
          sync();
        });
        // 缩略图滚到附近再画
        const queue = [];
        let busy = false;
        const pump = async () => {
          if (busy) return;
          busy = true;
          while (queue.length && it.pdf && d.open) {
            const p = queue.shift(), key = `p${p}:${it.rotation}`;
            try {
              if (!it.thumbs.has(key)) it.thumbs.set(key, await renderThumb(it.pdf, p + 1, { width: 96, rotation: it.rotation }));
              const pg = grid.querySelector(`.pcell[data-p="${p}"] .pg`);
              if (pg) pg.innerHTML = `<img src="${it.thumbs.get(key).url}" alt="">`;
            } catch {}
          }
          busy = false;
        };
        io = new IntersectionObserver(ents => {
          for (const en of ents) if (en.isIntersecting) { const p = +en.target.dataset.p; if (!it.thumbs.has(`p${p}:${it.rotation}`) && !queue.includes(p)) queue.push(p); io.unobserve(en.target); }
          pump();
        }, { root: grid, rootMargin: '300px 0px' });
        grid.querySelectorAll('.pcell').forEach(c => io.observe(c));
      },
      onClose: () => io?.disconnect(),
    });
    if (v !== 'ok' || !sel.size) return;
    const pages = [...sel].sort((a, b) => a - b);
    it.selection = pages.length === n ? null : pages;
    it.rangeText = it.selection ? formatRange(pages) : '';
    this.#updateCard(it, true);
    this.#cover(it);
    this.#summary();
  }

  /* ---------- 合并 ---------- */
  async merge() {
    if (this.busy) return;
    const bad = this.items.find(it => !it.error && it.numPages && parseRange(it.rangeText, it.numPages).error);
    if (bad) { toast(`「${bad.name}」的页码写得不对：${parseRange(bad.rangeText, bad.numPages).error}`, { kind: 'err' }); $(`.mcard[data-id="${bad.id}"] input[data-r]`, this.root)?.focus(); return; }
    if (this.items.some(it => it.loading)) { toast('还有文件在读取，稍等一下'); return; }
    const use = this.items.filter(it => it.pdf && it.numPages && !it.error);
    if (!use.length) { toast('列表里没有能用的 PDF', { kind: 'err' }); return; }
    const pick = it => parseRange(it.rangeText, it.numPages).pages ?? allPages(it.numPages);   // 直接按输入框里的文字算，不依赖失焦时的整理
    if (use.length === 1 && pick(use[0]).length === use[0].numPages && pick(use[0]).every((p, i) => p === i) && !use[0].rotation) {
      toast('只有一个文件，而且是全部页面——再添加一个文件，或者在「页码」里挑几页（提取页面）');
      return;
    }
    const skipped = this.items.length - use.length;
    // 每个文件要的页 → pdf.js 的 pageInfos：同一份文件里出现重复页时，拆成几段（同一段里不能重复）
    const groups = [], infos = [];
    let slot = 0;
    for (const it of use) {
      const pages = pick(it);
      groups.push({ title: stripExt(it.name), start: slot, count: pages.length, rotate: it.rotation });
      let chunk = new Map();
      const flush = () => {
        if (!chunk.size) return;
        const inc = [...chunk.keys()].sort((a, b) => a - b);
        infos.push({ it, includePages: inc, pageIndices: inc.map(p => chunk.get(p)) });
        chunk = new Map();
      };
      for (const p of pages) { if (chunk.has(p)) flush(); chunk.set(p, slot++); }
      flush();
    }
    const total = slot;
    const first = use[0];
    // 只有一份文件而且加了密：pdf.js 会沿用它的加密，pdf-lib 也改不了加密文件。临时拼进一页别的文件让结果不加密，最后再删掉这一页
    const decrypt = use.length === 1 && !!first.encrypted;
    if (decrypt) infos.push({ tiny: true, includePages: [0], pageIndices: [total] });
    let outName = ($('#mName', this.root)?.value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
    if (!outName) outName = use.length > 1 ? `${stripExt(first.name)} 等${use.length}份（合并）` : `${stripExt(first.name)}（第 ${formatRange(pick(first))} 页）`;
    if (!/\.pdf$/i.test(outName)) outName += '.pdf';

    this.busy = true;
    this.#summary();
    const stage = t => { const s = $('#mgStage'); if (s) s.textContent = t; };
    openDialog({
      dismissable: false,
      html: `${dlgHead('正在装订', { k: 'The Binding', sub: `${use.length} 份文件 · ${total} 页` })}<div class="dlg-b"><div class="prog ind"><i></i></div><div class="sub" id="mgStage" style="margin-top:8px">拼合页面…</div></div>`,
    });
    let out = null;
    try {
      // 1. pdf.js 拼页（第一份文件作「主文档」，其余以字节传入）
      const { pdf: primary } = await loadPdf(first.bytes.slice(), { name: first.name, worker: getMergeWorker(), password: first.password });
      try {
        out = await primary.extractPages(infos.map((inf, i) => inf.tiny ? { document: tinyPdf(), includePages: inf.includePages, pageIndices: inf.pageIndices } : {
          document: i === 0 ? null : inf.it.bytes,
          password: inf.it.password || undefined,
          includePages: inf.includePages,
          pageIndices: inf.pageIndices,
        }));
      } finally { destroyPdf(primary); }
      if (!out || !out.length) throw new Error('pdf.js 没能拼出新文件（可能有文件结构损坏）');

      // 2. 书签 / 旋转 / 文档信息
      stage('整理书签…');
      let topPages = null;
      if (prefs.mergeBookmarks) {
        const chk = await pdfjsLib.getDocument({ ...DOC_OPTS, data: out.slice(), worker: getMergeWorker() }).promise;
        try {
          if (chk.numPages !== total + (decrypt ? 1 : 0)) throw new Error(`页数对不上（应为 ${total}，实际 ${chk.numPages - (decrypt ? 1 : 0)}）`);
          const ol = await chk.getOutline().catch(() => null);
          topPages = ol ? await Promise.all(ol.map(o => destPageIndex(chk, o.dest))) : [];
        } finally { destroyPdf(chk); }
      }
      if (decrypt) {
        out = await postProcess(out.slice(), { groups, topPages, bookmarks: prefs.mergeBookmarks, title: stripExt(outName), total, dropLast: true });
      } else if (prefs.mergeBookmarks || groups.some(g => g.rotate)) {
        try { out = await postProcess(out.slice(), { groups, topPages, bookmarks: prefs.mergeBookmarks, title: stripExt(outName), total }); }
        catch (e) { console.warn(e); toast('书签 / 旋转没能加上，先保存了拼好的版本：' + e.message, { kind: 'err', ms: 8000 }); }
      }

      // 3. 保存
      stage('等待选择保存位置…');
      const res = await platform.savePdf(out, outName, first.dir);
      closeDialog(null);
      if (!res) { toast('没有保存（取消了）'); return; }
      const extra = skipped ? `；有 ${skipped} 个读不了的文件被跳过` : '';
      toast(`合并好了：${res.name}（${total} 页）${extra}`, {
        kind: 'ok', ms: 7000,
        actions: [
          ...(prefs.mergeOpen ? [] : [{ label: '打开', fn: () => this.hooks.openResult(res.name, out, res.path) }]),
          ...(res.path ? [{ label: '在文件夹中显示', fn: () => platform.revealInFolder(res.path) }] : []),
        ],
      });
      if (prefs.mergeOpen) this.hooks.openResult(res.name, out.slice(), res.path);
    } catch (e) {
      closeDialog(null);
      console.error(e);
      toast('合并失败：' + pdfErrorText(e), { kind: 'err', ms: 9000 });
    } finally {
      this.busy = false;
      this.#summary();
    }
  }
}

// 也给「转成 PDF」合成一份时用
export function postProcess(bytes, msg) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./merge-worker.js', import.meta.url), { type: 'module' });
    const done = () => w.terminate();
    w.onmessage = ({ data }) => { done(); data.ok ? resolve(data.bytes) : reject(new Error(data.error)); };
    w.onerror = e => { done(); reject(new Error(e.message || '后台线程出错')); };
    w.postMessage({ ...msg, bytes }, [bytes.buffer]);
  });
}
