// 阅读器：每个标签页一个 pdf.js PDFViewer（下面叫「叶」）。滚动位置、查找、批注编辑器和它的撤销记录都各自留着，
// 切换标签不用重画，没保存的批注也不会丢。共用的界面：侧栏缩略图 / 目录、页码框、缩放、查找条、演示模式、打印、属性，
// 以及给编辑栏用的批注接口（高亮、画笔、文字、图片、签名）。
import { pdfjsLib, DOC_OPTS, IMAGES_URL, getViewWorker } from './pdfjs.js';
import { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget, ScrollMode, SpreadMode, FindState, GenericL10n } from './pdfviewer.js';
import { $, $$, esc, clamp, debounce, canvasToBlobURL, fmtSize, fmtDateTime, nextFrame } from './util.js';
import { icon, FLOURISH } from './icons.js';
import { prefs, savePrefs, getViewState, setViewState, updateRecent } from './store.js';
import * as platform from './platform.js';
import { toast, openDialog, closeDialog, dlgHead, askPassword } from './ui.js';

export { ScrollMode, SpreadMode };
export const ZOOM_PRESETS = [['auto', '自动'], ['page-width', '适合宽度'], ['page-fit', '适合页面'], ['page-actual', '实际大小']];
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const THUMB_W = 116;

/* ---------- 批注编辑（pdf.js 自带的编辑器） ---------- */
export const EditMode = pdfjsLib.AnnotationEditorType;          // NONE 0 / FREETEXT 3 / HIGHLIGHT 9 / STAMP 13 / INK 15
export const EditParam = pdfjsLib.AnnotationEditorParamsType;
// 高亮色：沿用 pdf.js 的五个色名（批注上的颜色菜单有现成的中文），颜色换成水彩里的樱草黄、嫩叶绿、天青、蔷薇、朱砂
export const HIGHLIGHT_COLORS = [['yellow', '#FFE27A', '樱草黄'], ['green', '#BFE39A', '嫩叶绿'], ['blue', '#A3D3F0', '天青'], ['pink', '#F4B8CC', '蔷薇'], ['red', '#FFAE92', '朱砂']];
// pdf.js 界面文字用官方的简体中文（vendor/pdfjs/locale，见 index.html 里的 application/l10n 链接）
const L10N = new GenericL10n('zh-CN');
let defaultsSent = false;

/* ---------- 打开 PDF（带密码处理） ---------- */
export class CancelledError extends Error { constructor() { super('cancelled'); this.cancelled = true; } }

export async function loadPdf(bytes, { name = '', worker = getViewWorker(), password = null } = {}) {
  let pw = password, cancelled = false;
  const task = pdfjsLib.getDocument({ ...DOC_OPTS, data: bytes, worker, password: password ?? undefined });
  task.onPassword = async (update, reason) => {
    const v = await askPassword(name, reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    if (v == null) { cancelled = true; task.destroy(); return; }
    pw = v;
    update(v);
  };
  try {
    const pdf = await task.promise;
    return { pdf, password: pw };
  } catch (e) {
    if (cancelled) throw new CancelledError();
    throw e;
  }
}

// pdf.js 6 的 PDFDocumentProxy 没有 destroy()，要通过它的 loadingTask 释放（会一并关掉它在 worker 里的那份文档）
export function destroyPdf(pdf) { try { pdf?.loadingTask?.destroy(); } catch {} }

export function pdfErrorText(e) {
  const n = e?.name || '';
  if (n === 'InvalidPDFException') return '这不是有效的 PDF 文件，或者文件已经损坏';
  if (n === 'MissingPDFException') return '找不到这个文件';
  if (n === 'PasswordException') return '密码不对';
  if (n === 'UnexpectedResponseException') return '读取文件时出错';
  return String(e?.message || e || '未知错误').replace(/^Error:\s*/, '');
}

// 渲染一页的小图（缩略图、最近打开、合并列表、整理页面共用）；返回 { url, ratio }，url 是 blob: 或 data:
export async function renderThumb(pdf, pageNumber, { width = THUMB_W, rotation = 0, dataURL = false, quality = 0.84 } = {}) {
  const page = await pdf.getPage(pageNumber);
  const rot = ((page.rotate + rotation) % 360 + 360) % 360;
  const vp1 = page.getViewport({ scale: 1, rotation: rot });
  const dpr = dataURL ? 1 : Math.min(2, devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width * dpr) / vp1.width, rotation: rot });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const url = dataURL ? canvas.toDataURL('image/jpeg', quality) : await canvasToBlobURL(canvas, 'image/jpeg', quality);
  canvas.width = canvas.height = 0;
  return { url, ratio: vp.height / vp.width };
}

// 目录项 / 链接的目标页（0 起）；解析不了返回 null
export async function destPageIndex(pdf, dest) {
  try {
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const ref = dest[0];
    if (ref && typeof ref === 'object') return await pdf.getPageIndex(ref);
    if (Number.isInteger(ref)) return ref;
  } catch {}
  return null;
}

/* ---------- 一页纸的小 PDF：只从一份加密文件取页时，加上它 pdf.js 就会写出不加密的结果（之后再删掉这一页） ---------- */
export function tinyPdf() {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 8 8]/Resources<<>>>>'];
  let s = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(s);
}

// 文档信息（标题、作者…）：拼成新文件后补回去；encrypted 表示这份文件加了密
export async function docInfo(pdf) {
  const { info } = await pdf.getMetadata().catch(() => ({ info: null }));
  const d = info?.CreationDate ? pdfjsLib.PDFDateString.toDateObject(info.CreationDate) : null;
  return {
    Title: info?.Title || '', Author: info?.Author || '', Subject: info?.Subject || '', Keywords: info?.Keywords || '',
    Creator: info?.Creator || '', created: d ? d.getTime() : null, encrypted: !!info?.EncryptFilterName,
  };
}

/* ---------- 阅读器 ---------- */
export class Reader {
  /* hooks: onChange(tab) 页码 / 缩放 / 文档变化；onEditMode(tab, mode)、onEditState(tab, states)、onEditParams(tab, details)
   *        批注工具、撤销状态、所选批注的颜色粗细；onFormInput(tab) 填了表单；editDefaults() 各工具的默认颜色粗细 */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.root = $('#reader');
    this.wrap = $('#viewerWrap');
    this.tab = null;
    this.thumbQueue = [];
    this.thumbBusy = false;
    this.find = { query: '', caseSensitive: false, entireWord: false };
    L10N.translate(this.wrap);        // 叶都在 #viewerWrap 里：pdf.js 的批注按钮、提示由它翻成中文

    // 外部链接交给系统浏览器；内部链接（#…）由 pdf.js 自己处理
    const onLink = e => {
      const a = e.target.closest?.('a[href]');
      if (!a || !this.container?.contains(a)) return;
      const href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); e.stopPropagation(); if (e.type === 'click' || e.button === 1) platform.openExternal(href); }
    };
    this.wrap.addEventListener('click', onLink, true);
    this.wrap.addEventListener('auxclick', onLink, true);

    // Ctrl + 滚轮缩放（以鼠标位置为中心）；触控板捏合也是 ctrl+wheel
    this.wrap.addEventListener('wheel', e => {
      if (document.body.classList.contains('present')) return this.#presentWheel(e);
      if (!e.ctrlKey || !this.viewer) return;
      e.preventDefault();
      const origin = [e.clientX, e.clientY];
      if (e.deltaMode === 0 && Math.abs(e.deltaY) < 40) this.viewer.updateScale({ scaleFactor: Math.exp(-e.deltaY / 120), origin, drawingDelay: 300 });
      else this.viewer.updateScale({ steps: e.deltaY < 0 ? 1 : -1, origin, drawingDelay: 300 });
    }, { passive: false });

    // 预设缩放（适合宽度 / 页面）在窗口大小变化后重新套用；后台的叶等切回来时再套
    new ResizeObserver(() => { const L = this.leaf; if (L && !L.pending) this.#refit(L); this.#hideSelBar(); }).observe(this.wrap);

    this.#initHand();
    this.#initSidebar();
    this.#initFindbar();
    this.#initPageBox();
    this.#initSelBar();
    this.setTone(prefs.tone);
  }

  get leaf() { return this.tab?.leaf || null; }
  get viewer() { return this.leaf?.viewer || null; }
  get container() { return this.leaf?.container || null; }
  get linkService() { return this.leaf?.linkService || null; }
  get pdf() { return this.tab?.pdf || null; }
  get page() { return this.viewer?.currentPageNumber || 1; }
  get pages() { return this.tab?.numPages || 0; }
  focus() { this.container?.focus({ preventScroll: true }); }

  /* ---------- 叶：每个标签页自己的 PDFViewer ---------- */
  #leafFor(tab) {
    if (tab.leaf) return tab.leaf;
    const container = document.createElement('div');
    container.className = 'vc';
    container.tabIndex = 0;
    const el = document.createElement('div');
    el.className = 'pdfViewer';
    container.append(el);
    this.wrap.prepend(container);
    const ac = new AbortController();
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
    const findController = new PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
    const viewer = new PDFViewer({
      container, viewer: el, eventBus, linkService, findController, l10n: L10N, abortSignal: ac.signal,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, annotationEditorMode: EditMode.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS.map(([k, c]) => `${k}=${c}`).join(','),
      enableHighlightFloatingButton: false,     // 选中文字后的「高亮」小条自己做（pdf.js 的那个会被每个叶各弹一个）
      imageResourcesPath: IMAGES_URL, maxCanvasPixels: 2 ** 25, enableAutoLinking: true,
    });
    linkService.setViewer(viewer);
    const L = tab.leaf = { tab, container, eventBus, linkService, findController, viewer, ac, ui: null, mode: EditMode.NONE, edit: {}, pending: true, sized: '', restoreMode: 0 };
    this.#wire(L);
    viewer.setDocument(tab.pdf);
    linkService.setDocument(tab.pdf, null);
    return L;
  }

  #wire(L) {
    const { tab, eventBus: bus } = L, active = () => this.tab === tab;
    bus.on('pagesinit', () => this.#onPagesInit(L));
    bus.on('pagechanging', ({ pageNumber }) => { if (active()) this.#onPage(pageNumber); });
    bus.on('scalechanging', () => { if (active()) { this.#syncZoom(); this.#hideSelBar(); } });
    bus.on('rotationchanging', () => this.#onRotation(tab));
    bus.on('updateviewarea', ({ location }) => {
      if (L.pending || L.viewer.pdfDocument !== tab.pdf) return;
      tab.view = { scale: L.viewer.currentScaleValue, loc: location };
      this.#persist(tab);
    });
    bus.on('updatefindmatchescount', ({ matchesCount }) => { if (active()) this.#findCount(matchesCount); });
    bus.on('updatefindcontrolstate', ({ state, matchesCount }) => { if (active()) this.#findCount(matchesCount, state); });

    // 批注编辑器：每份文档一个 uiManager；工具切换、撤销状态、所选批注的参数都通过 eventBus 报出来
    bus.on('annotationeditoruimanager', ({ uiManager }) => { L.ui = uiManager; });
    bus.on('annotationeditorlayerrendered', () => {
      // 各工具的默认颜色粗细是 pdf.js 编辑器类上的静态值，第一次有编辑层时设一次就行
      if (defaultsSent || !L.ui) return;
      defaultsSent = true;
      for (const [type, value] of this.hooks.editDefaults?.() || []) this.#param(L, type, value);
    });
    bus.on('annotationeditormodechanged', ({ mode }) => {
      L.mode = mode;
      L.container.classList.toggle('editing', mode !== EditMode.NONE);
      if (mode !== EditMode.NONE) this.#hideSelBar();
      if (active()) { this.setHand(this.hand); this.hooks.onEditMode?.(tab, mode); }
    });
    // 编辑器自己要换工具（点了另一种批注、双击文档里原有的批注、从选中文字直接高亮）：照办
    bus.on('switchannotationeditormode', evt => this.#setMode(L, evt));
    bus.on('showannotationeditorui', ({ mode }) => this.#setMode(L, { mode }));
    bus.on('editingstateschanged', ({ details }) => { L.edit = { ...details }; this.hooks.onEditState?.(tab, L.edit); });
    bus.on('annotationeditorparamschanged', ({ details }) => { if (active()) this.hooks.onEditParams?.(tab, details); });
    // 表单：填了就算改动
    const formEdit = e => { if (e.target.closest?.('.annotationLayer')) this.hooks.onFormInput?.(tab); };
    L.container.addEventListener('input', formEdit);
    L.container.addEventListener('change', formEdit);
  }

  /* ---------- 挂上 / 取下 / 换文档 ---------- */
  attach(tab) {
    if (this.tab === tab) return;
    this.#leave();
    this.tab = tab;
    const L = this.#leafFor(tab);
    L.container.classList.add('on');
    $('#pageInput').value = L.pending ? (tab.view?.loc?.pageNumber || tab.view?.page || 1) : L.viewer.currentPageNumber;
    $('#pageTotal').textContent = tab.numPages;
    this.#buildSidebar();
    if (!L.pending) {
      if (L.viewer.scrollMode !== prefs.scroll || L.viewer.spreadMode !== prefs.spread) this.setLayout(prefs.scroll, prefs.spread, false);
      this.#refit(L);
      this.#onPage(L.viewer.currentPageNumber);
      this.#syncZoom();
    }
    this.setHand(this.hand);
    this.hooks.onEditMode?.(tab, L.mode);
    this.hooks.onEditState?.(tab, L.edit);
    this.hooks.onChange?.(tab);
  }
  #leave() {
    const t = this.tab;
    if (!t) return;
    this.#saveLive();
    this.closeFind(true);
    this.#hideSelBar();
    const L = t.leaf;
    if (L) {
      if (L.mode !== EditMode.NONE) { this.commitEdits(t); this.#setMode(L, { mode: EditMode.NONE }); }   // 只有前台的叶处在编辑状态
      L.container.classList.remove('on');
    }
    this.tab = null;
  }
  detach() {
    this.#leave();
    this.thumbQueue = [];
    $('#thumbs').innerHTML = '';
    $('#outline').innerHTML = '';
  }
  // 标签页关掉时：拆掉它的叶，释放 pdf.js 文档和缩略图
  dispose(tab) {
    if (this.tab === tab) this.detach();
    this.#persist.flush(tab);
    const L = tab.leaf;
    if (L) {
      try { L.viewer.setDocument(null); L.linkService.setDocument(null, null); } catch {}
      L.ac.abort();
      L.container.remove();
      tab.leaf = null;
    }
    tab.thumbs?.forEach(u => URL.revokeObjectURL(u.url));
    tab.thumbs?.clear();
    destroyPdf(tab.pdf);
  }
  // 保存、整理页面之后：同一个标签页换上新文档（叶不拆，阅读位置和当前工具都接着用）
  replaceDocument(tab, pdf) {
    const L = tab.leaf, active = this.tab === tab;
    if (L && !L.pending && L.viewer.pdfDocument === tab.pdf) tab.view = { scale: L.viewer.currentScaleValue, loc: L.viewer._location || tab.view?.loc };
    if (active) { this.closeFind(true); this.#hideSelBar(); }
    const old = tab.pdf;
    tab.thumbs.forEach(u => URL.revokeObjectURL(u.url));
    tab.thumbs.clear();
    Object.assign(tab, { pdf, numPages: pdf.numPages, fp: pdf.fingerprints?.[0] || null, outline: undefined, labels: undefined, olFlat: null });
    if (L) {
      L.restoreMode = active ? L.mode : EditMode.NONE;
      Object.assign(L, { pending: true, ui: null, mode: EditMode.NONE, edit: {} });
      L.container.classList.remove('editing');
      L.viewer.setDocument(pdf);
      L.linkService.setDocument(pdf, null);
    }
    if (active) {
      $('#pageTotal').textContent = tab.numPages;
      this.#buildSidebar();
      this.hooks.onEditMode?.(tab, EditMode.NONE);
      this.hooks.onEditState?.(tab, {});
      this.hooks.onChange?.(tab);
    }
    destroyPdf(old);
  }

  flush() { this.#saveLive(); }
  #saveLive() {
    const t = this.tab, L = t?.leaf;
    if (!L || L.pending || L.viewer.pdfDocument !== t.pdf) return;
    t.view = { scale: L.viewer.currentScaleValue, loc: L.viewer._location || t.view?.loc };
    this.#persist.flush(t);
  }
  #persist = debounce(t => {
    const l = t?.view?.loc;
    if (!l) return;
    setViewState(t.fp, { page: l.pageNumber, scale: t.view.scale, rot: l.rotation, left: l.left, top: l.top });
    updateRecent(t.path, { page: l.pageNumber, pages: t.numPages });
  }, 700);

  #onPagesInit(L) {
    const { tab, viewer } = L;
    if (viewer.pdfDocument !== tab.pdf) return;
    const v = tab.view || getViewState(tab.fp) || {};
    const loc = v.loc || null;
    try {
      viewer.scrollMode = prefs.scroll;
      viewer.spreadMode = prefs.spread;
      viewer.pagesRotation = loc ? loc.rotation : (v.rot || 0);
      viewer.currentScaleValue = v.scale || 'auto';
      const page = clamp(loc ? loc.pageNumber : (v.page || 1), 1, tab.numPages);
      const left = loc ? loc.left : v.left, top = loc ? loc.top : v.top;
      if (page > 1 || top != null) {
        viewer.scrollPageIntoView({ pageNumber: page, destArray: [null, { name: 'XYZ' }, left ?? null, top ?? null, null], allowNegativeOffset: true });
      }
    } catch (e) { console.warn('恢复阅读位置失败', e); }
    L.pending = false;
    L.sized = this.#sizeKey();
    if (this.tab === tab) {
      this.#onPage(viewer.currentPageNumber);
      this.#syncZoom();
      this.hooks.onChange?.(tab);
      L.container.focus({ preventScroll: true });
    }
    if (tab.labels === undefined) {
      tab.pdf.getPageLabels().then(l => {
        tab.labels = l && l.some((x, i) => x !== String(i + 1)) ? l : null;
        if (!tab.labels || tab.leaf !== L || viewer.pdfDocument !== tab.pdf) return;
        viewer.setPageLabels(tab.labels);
        if (this.tab === tab) { this.#onPage(viewer.currentPageNumber); this.#relabelThumbs(); }
      }).catch(() => { tab.labels = null; });
    } else if (tab.labels) viewer.setPageLabels(tab.labels);
    if (L.restoreMode) {         // 换了文档（保存后重新载入）：接着用刚才的工具
      const m = L.restoreMode;
      L.restoreMode = 0;
      if (this.tab === tab) setTimeout(() => this.#setMode(L, { mode: m }), 0);
    }
  }

  #onPage(n) {
    const tab = this.tab;
    if (!tab) return;
    const inp = $('#pageInput');
    if (document.activeElement !== inp) inp.value = n;
    const lab = tab.labels?.[n - 1];
    $('#pageLabel').textContent = lab && lab !== String(n) ? `（${lab}）` : '';
    $('#tbPrev').disabled = n <= 1;
    $('#tbNext').disabled = n >= tab.numPages;
    const cur = $('#thumbs .thumb.on');
    if (cur?.dataset.page !== String(n)) {
      cur?.classList.remove('on');
      const el = $(`#thumbs .thumb[data-page="${n}"]`);
      if (el) {
        el.classList.add('on');
        if (prefs.sidebar && prefs.sbTab === 'thumbs' && !this.thumbScrolling) el.scrollIntoView({ block: 'nearest' });
      }
    }
    this.hooks.onPage?.(n);
  }

  #syncZoom() {
    const v = this.viewer;
    if (!v) return;
    const z = v.currentScaleValue, s = v.currentScale;
    const preset = ZOOM_PRESETS.find(p => p[0] === z);
    $('#zoomLabel').textContent = preset ? preset[1] : `${Math.round(s * 100)}%`;
    $('#tbZoomOut').disabled = s <= 0.1;
    $('#tbZoomIn').disabled = s >= 25;
  }

  #sizeKey() { return `${this.wrap.clientWidth}x${this.wrap.clientHeight}`; }
  #refit(L) {
    const k = this.#sizeKey();
    if (!this.wrap.clientWidth || L.sized === k) return;
    L.sized = k;
    const v = L.viewer.currentScaleValue;
    if (['auto', 'page-fit', 'page-width'].includes(v)) L.viewer.currentScaleValue = v;
  }

  /* ---------- 页码输入 ---------- */
  #initPageBox() {
    const inp = $('#pageInput');
    const go = () => {
      if (!this.tab) return;
      const v = inp.value.trim();
      if (!v) { inp.value = this.page; return; }
      if (/^\d+$/.test(v)) this.goTo(+v);
      else if (this.tab.labels) {                              // 也可以输入页码标签（如 iv）
        const i = this.tab.labels.findIndex(l => l.toLowerCase() === v.toLowerCase());
        if (i >= 0) this.goTo(i + 1);
      }
      inp.value = this.page;
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); go(); this.focus(); }
      else if (e.key === 'Escape') { inp.value = this.page; this.focus(); }
    });
    inp.addEventListener('change', go);
    inp.addEventListener('focus', () => inp.select());
  }

  /* ---------- 翻页 / 缩放 / 旋转 / 版式 ---------- */
  goTo(n) { if (this.viewer && this.tab) this.viewer.currentPageNumber = clamp(Math.round(n), 1, this.tab.numPages); }
  prevPage() { this.viewer?.previousPage(); }
  nextPage() { this.viewer?.nextPage(); }
  firstPage() { this.goTo(1); }
  lastPage() { this.goTo(this.pages); }
  zoomIn() { this.viewer?.increaseScale({ drawingDelay: 200 }); }
  zoomOut() { this.viewer?.decreaseScale({ drawingDelay: 200 }); }
  setZoom(v) { if (this.viewer) this.viewer.currentScaleValue = String(v); }
  rotate(delta) { const v = this.viewer; if (v) v.pagesRotation = (v.pagesRotation + delta + 360) % 360; }
  setLayout(scroll, spread, save = true) {
    if (save) { prefs.scroll = scroll; prefs.spread = spread; savePrefs(); }
    const v = this.viewer;
    if (!v) return;
    const p = this.page;
    v.scrollMode = scroll;
    v.spreadMode = spread;
    const z = v.currentScaleValue;
    if (['auto', 'page-fit', 'page-width'].includes(z)) v.currentScaleValue = z;
    v.currentPageNumber = p;
    this.hooks.onChange?.(this.tab);
  }
  get layout() { const v = this.viewer; return v ? { scroll: v.scrollMode, spread: v.spreadMode } : { scroll: prefs.scroll, spread: prefs.spread }; }
  setTone(t) {
    prefs.tone = ['paper', 'night'].includes(t) ? t : 'normal';
    savePrefs();
    this.root.dataset.tone = prefs.tone;
  }
  #onRotation(tab) {
    tab.thumbs.forEach(u => URL.revokeObjectURL(u.url));
    tab.thumbs.clear();
    if (this.tab === tab) this.#buildThumbs();
  }

  /* ---------- 手形工具（按住空格临时切换；编辑批注时不用） ---------- */
  #initHand() {
    this.hand = false;
    let drag = null, space = false;
    const set = () => { const c = this.container; if (c) c.style.cursor = drag ? 'grabbing' : (this.hand || space) && this.editMode === EditMode.NONE ? 'grab' : ''; };
    this.setHand = on => { this.hand = !!on; set(); this.hooks.onChange?.(this.tab); };
    addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.repeat && this.tab && document.activeElement === this.container && !space && this.editMode === EditMode.NONE) { space = true; set(); e.preventDefault(); }
    });
    addEventListener('keyup', e => { if (e.code === 'Space' && space) { space = false; set(); } });
    this.wrap.addEventListener('pointerdown', e => {
      const c = this.container;
      if (!c || !c.contains(e.target) || e.button !== 0 || !(this.hand || space) || this.editMode !== EditMode.NONE) return;
      if (e.target.closest('a,input,select,textarea,button,.annotationLayer section')) return;
      drag = { x: e.clientX, y: e.clientY, l: c.scrollLeft, t: c.scrollTop, c };
      try { c.setPointerCapture(e.pointerId); } catch {}
      set();
      e.preventDefault();
    });
    this.wrap.addEventListener('pointermove', e => { if (drag) { drag.c.scrollLeft = drag.l - (e.clientX - drag.x); drag.c.scrollTop = drag.t - (e.clientY - drag.y); } });
    const end = () => { if (drag) { drag = null; set(); } };
    this.wrap.addEventListener('pointerup', end);
    this.wrap.addEventListener('pointercancel', end);
  }

  /* ---------- 选中文字后的小条：高亮 / 复制 / 查找 ---------- */
  #initSelBar() {
    const bar = this.selBar = document.createElement('div');
    bar.className = 'selbar';
    bar.hidden = true;
    bar.innerHTML = `<button data-sel="hl" title="把选中的文字高亮（会打开编辑栏）">${icon('marker', 16)}高亮</button>`
      + `<button data-sel="copy" title="复制（Ctrl+C）">${icon('copy', 16)}复制</button><button data-sel="find" title="在文档里查找">${icon('find', 16)}查找</button>`;
    this.wrap.append(bar);
    bar.addEventListener('mousedown', e => e.preventDefault());         // 点按钮时别把选中的文字取消掉
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-sel]');
      if (!b) return;
      const k = b.dataset.sel, text = getSelection()?.toString().trim() || '';
      this.#hideSelBar();
      if (k === 'hl') this.highlightSelection();
      else if (k === 'copy') { document.execCommand('copy'); toast('已复制', { ms: 1400 }); }
      else if (k === 'find') this.openFind(text);
    });
    let t = 0;
    this.wrap.addEventListener('pointerup', e => { if (!bar.contains(e.target)) { clearTimeout(t); t = setTimeout(() => this.#showSelBar(), 30); } });
    this.wrap.addEventListener('pointerdown', e => { if (!bar.contains(e.target)) this.#hideSelBar(); });
    this.wrap.addEventListener('scroll', () => this.#hideSelBar(), true);
    document.addEventListener('selectionchange', () => { if (!bar.hidden && getSelection()?.isCollapsed) this.#hideSelBar(); });
  }
  #showSelBar() {
    const L = this.leaf, bar = this.selBar;
    if (!L || L.mode !== EditMode.NONE || this.present) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return;
    const node = sel.focusNode, el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el?.closest('.textLayer') || !L.container.contains(el)) return;
    const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    let backward = false;
    try { const r = document.createRange(); r.setStart(sel.anchorNode, sel.anchorOffset); r.setEnd(sel.focusNode, sel.focusOffset); backward = r.collapsed; } catch {}
    const r = backward ? rects[0] : rects[rects.length - 1], w = this.wrap.getBoundingClientRect();
    bar.querySelector('[data-sel=hl]').hidden = !L.ui;
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = (backward ? r.left : r.right) - w.left - bw / 2;
    let y = backward ? r.top - w.top - bh - 8 : r.bottom - w.top + 8;
    if (y + bh > w.height - 6) y = r.top - w.top - bh - 8;
    if (y < 6) y = r.bottom - w.top + 8;
    bar.style.left = clamp(x, 6, w.width - bw - 6) + 'px';
    bar.style.top = clamp(y, 6, w.height - bh - 6) + 'px';
  }
  #hideSelBar() { if (this.selBar && !this.selBar.hidden) this.selBar.hidden = true; }

  /* ---------- 批注编辑：给编辑栏用 ---------- */
  get editMode() { return this.leaf?.mode ?? EditMode.NONE; }
  get editState() { return this.leaf?.edit || {}; }
  get canEdit() { return !!this.leaf?.ui; }
  setEditMode(mode) { const L = this.leaf; if (L) this.#setMode(L, { mode }); }
  #setMode(L, { mode, editId = null, isFromKeyboard = false, mustEnterInEditMode = false, editComment = false }) {
    if (!L.ui || L.viewer.pdfDocument !== L.tab.pdf) return;
    if (mode !== EditMode.NONE && this.tab !== L.tab) return;     // 后台的叶不进编辑状态（它们的键盘、粘贴监听是全局的）
    if (mode !== EditMode.NONE && this.present) return;
    try { L.viewer.annotationEditorMode = { mode, editId, isFromKeyboard, mustEnterInEditMode, editComment }; }
    catch (e) { console.warn('切换批注工具失败', e); }
  }
  #ensureMode(L, mode) {
    if (L.mode === mode) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { L.eventBus.off('annotationeditormodechanged', on); clearTimeout(timer); resolve(); };
      const on = ({ mode: m }) => { if (m === mode) done(); };
      const timer = setTimeout(done, 4000);
      L.eventBus.on('annotationeditormodechanged', on);
      this.#setMode(L, { mode });
    });
  }
  // 改颜色、粗细、字号：选中了批注就改它，没选中就改这种工具的默认值
  editParam(type, value) { const L = this.leaf; if (L?.ui) this.#param(L, type, value); }
  #param(L, type, value) { L.eventBus.dispatch('switchannotationeditorparams', { source: this, type, value }); }
  // undo / redo / delete / selectAll
  editAction(name) { const L = this.leaf; if (L?.ui) L.eventBus.dispatch('editingaction', { source: this, name }); }
  // 保存前：正在打的字、正在画的那一笔先落下来
  commitEdits(tab = this.tab) {
    const L = tab?.leaf;
    if (!L?.ui) return;
    const a = document.activeElement;
    if (a && L.container.contains(a) && a.isContentEditable) a.blur();
    try {
      L.ui.endCurrentEditing?.();
      // 失焦不一定会触发（窗口没有焦点时浏览器不发 blur）：还在输入状态的文字框逐个落下来，空的就删掉
      for (let i = 0; i < tab.numPages; i++) for (const ed of L.ui.getEditors(i)) if (ed.isInEditMode?.()) ed.commitOrRemove();
    } catch (e) { console.warn('提交批注失败', e); }
  }
  // 把选中的文字高亮：pdf.js 会切到高亮工具再加上
  // 粘贴复制过的批注：只交给当前文档的编辑器，而且要在编辑状态（阅读状态下不粘）
  pasteEditors(e) {
    const L = this.leaf;
    if (L?.ui && L.mode !== EditMode.NONE) L.ui.paste(e).catch(err => console.warn('粘贴批注失败', err));
  }
  highlightSelection() {
    const L = this.leaf;
    if (!L?.ui) return;
    try { L.ui.highlightSelection('floating_button'); } catch (e) { console.warn(e); }
  }
  // 插入图片批注（图片、签名）：放在当前页可见部分的中间，可以拖动、拉角缩放；widthPt 给了就按这个宽度（磅）放
  async insertImage(file, { widthPt = 0, aspect = 0, at = null } = {}) {
    const L = this.leaf;
    if (!L?.ui) return false;
    await this.#ensureMode(L, EditMode.STAMP);
    if (this.leaf !== L || !L.ui) return false;
    let layer = null, pos = null;
    if (at) {                                   // 拖进来的图片：放到鼠标下面那一页、鼠标松开的地方
      const pg = document.elementFromPoint(at.x, at.y)?.closest('.page[data-page-number]');
      if (pg && L.container.contains(pg)) layer = L.ui.getLayer(+pg.dataset.pageNumber - 1);
      if (layer?.div) pos = this.#toLayer(layer, at.x, at.y);
    }
    layer ||= L.ui.currentLayer;
    if (!layer?.div) return false;
    const editor = layer.createAndAddNewEditor(pos || this.#layerCenter(layer), true, { bitmapFile: file });
    if (editor && widthPt && aspect) {
      const [pw, ph] = layer.pageDimensions;
      const w = Math.min(widthPt, pw * 0.6);
      editor.width = w / pw;
      editor.height = Math.min(w * aspect, ph * 0.6) / ph;
    }
    return !!editor;
  }
  // 编辑层可见部分的中心
  #layerCenter(layer) {
    const r = layer.div.getBoundingClientRect(), c = this.container.getBoundingClientRect();
    const x0 = Math.max(r.left, c.left), y0 = Math.max(r.top, c.top), x1 = Math.min(r.right, c.right), y1 = Math.min(r.bottom, c.bottom);
    return this.#toLayer(layer, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  // 屏幕坐标换成编辑层自己的坐标。页面转了方向时编辑层是整个用 CSS 绕左上角转过去的
  // （pdf_viewer.css 的 [data-main-rotation]），除了宽高对调，原点也跟着换了角
  #toLayer(layer, sx, sy) {
    const r = layer.div.getBoundingClientRect(), x = sx - r.left, y = sy - r.top;
    switch (layer.viewport.rotation) {
      case 90: return { offsetX: y, offsetY: r.width - x };
      case 180: return { offsetX: r.width - x, offsetY: r.height - y };
      case 270: return { offsetX: r.height - y, offsetY: x };
      default: return { offsetX: x, offsetY: y };
    }
  }

  /* ---------- 侧栏 ---------- */
  #initSidebar() {
    const seg = $('#sbSeg');
    seg.addEventListener('click', e => {
      const b = e.target.closest('button[data-sb]');
      if (b) this.showSidebarTab(b.dataset.sb);
    });
    $('#thumbs').addEventListener('click', e => {
      const b = e.target.closest('.thumb');
      if (!b) return;
      this.thumbScrolling = true;
      this.goTo(+b.dataset.page);
      this.thumbScrolling = false;
    });
    $('#outline').addEventListener('click', e => {
      const tg = e.target.closest('.ol-tg');
      if (tg) {
        tg.classList.toggle('closed');
        tg.closest('li').querySelector(':scope > .ol-kids')?.classList.toggle('closed');
        return;
      }
      const it = e.target.closest('.ol-it');
      if (!it || !this.tab) return;
      $$('#outline .ol-it.cur').forEach(x => x.classList.remove('cur'));
      it.classList.add('cur');
      const item = this.tab.olFlat?.[+it.dataset.i];
      if (!item) return;
      if (item.dest) this.linkService?.goToDestination(item.dest);
      else if (item.url) platform.openExternal(item.url);
      else if (item.action) this.linkService?.executeNamedAction(item.action);
    });
    $('#outline').addEventListener('dblclick', e => {        // 双击目录空白处：全部展开 / 收起
      if (e.target.closest('.ol-it,.ol-tg')) return;
      const tgs = $$('#outline .ol-tg:not(.leaf)'), anyClosed = tgs.some(t => t.classList.contains('closed'));
      tgs.forEach(t => { t.classList.toggle('closed', !anyClosed); t.closest('li').querySelector(':scope > .ol-kids')?.classList.toggle('closed', !anyClosed); });
    });
    this.thumbIO = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) this.#queueThumb(+en.target.dataset.page);
    }, { root: $('#sbBody'), rootMargin: '500px 0px' });
    this.showSidebar(prefs.sidebar, false);
    this.showSidebarTab(prefs.sbTab, false);
  }
  showSidebar(on, save = true) {
    prefs.sidebar = !!on;
    if (save) savePrefs();
    this.root.classList.toggle('nosb', !on);
    $('#tbSidebar').classList.toggle('on', !!on);
    if (on) requestAnimationFrame(() => $('#thumbs .thumb.on')?.scrollIntoView({ block: 'nearest' }));
  }
  toggleSidebar() { this.showSidebar(!prefs.sidebar); }
  showSidebarTab(tab, save = true) {
    prefs.sbTab = tab === 'outline' ? 'outline' : 'thumbs';
    if (save) savePrefs();
    $$('#sbSeg button').forEach(b => b.classList.toggle('on', b.dataset.sb === prefs.sbTab));
    $('#thumbs').hidden = prefs.sbTab !== 'thumbs';
    $('#outline').hidden = prefs.sbTab !== 'outline';
    if (prefs.sbTab === 'thumbs') requestAnimationFrame(() => $('#thumbs .thumb.on')?.scrollIntoView({ block: 'nearest' }));
  }
  #buildSidebar() { this.#buildThumbs(); this.#buildOutline(); }

  #buildThumbs() {
    const tab = this.tab, box = $('#thumbs');
    this.thumbIO.disconnect();
    box.innerHTML = '';
    this.thumbQueue = [];
    if (!tab) return;
    const ratio = tab.ratio || 1.414, th = Math.round(THUMB_W * ratio);
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= tab.numPages; i++) {
      const b = document.createElement('button');
      b.className = 'thumb';
      b.dataset.page = i;
      b.title = `第 ${i} 页（右键：旋转、删除、插入…）`;
      const c = tab.thumbs.get(i);
      const h = c ? Math.round(THUMB_W * c.ratio) : th;
      b.innerHTML = `<span class="pg" style="--tw:${THUMB_W}px;--th:${h}px">${c ? `<img src="${c.url}" alt="" draggable="false">` : ''}</span><span class="no">${esc(this.#thumbLabel(i))}</span>`;
      frag.append(b);
    }
    box.append(frag);
    $$('.thumb', box).forEach(b => this.thumbIO.observe(b));
    const cur = $(`.thumb[data-page="${this.viewer?.currentPageNumber || 1}"]`, box);
    cur?.classList.add('on');
  }
  #thumbLabel(i) { const l = this.tab?.labels?.[i - 1]; return l && l !== String(i) ? `${i}（${l}）` : String(i); }
  #relabelThumbs() { $$('#thumbs .thumb').forEach(b => { b.querySelector('.no').textContent = this.#thumbLabel(+b.dataset.page); }); }
  #queueThumb(n) {
    const t = this.tab;
    if (!t || t.thumbs.has(n) || this.thumbQueue.includes(n)) return;
    this.thumbQueue.push(n);
    this.#pumpThumbs();
  }
  async #pumpThumbs() {
    if (this.thumbBusy) return;
    this.thumbBusy = true;
    try {
      while (this.thumbQueue.length) {
        const t = this.tab;
        if (!t) break;
        // 先画离当前页近的
        const cur = this.viewer?.currentPageNumber || 1;
        this.thumbQueue.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
        const n = this.thumbQueue.shift();
        if (t.thumbs.has(n)) continue;
        const pdf = t.pdf;
        let r;
        try { r = await renderThumb(pdf, n, { rotation: this.viewer?.pagesRotation || 0 }); } catch { continue; }
        if (this.tab !== t || t.pdf !== pdf) { URL.revokeObjectURL(r.url); break; }
        t.thumbs.set(n, r);
        const pg = $(`#thumbs .thumb[data-page="${n}"] .pg`);
        if (pg) {
          pg.style.setProperty('--th', Math.round(THUMB_W * r.ratio) + 'px');
          pg.innerHTML = `<img src="${r.url}" alt="" draggable="false">`;
        }
      }
    } finally { this.thumbBusy = false; }
  }

  async #buildOutline() {
    const tab = this.tab, box = $('#outline');
    box.innerHTML = '';
    if (!tab) return;
    const pdf = tab.pdf;
    if (tab.outline === undefined) {
      const ol = await pdf.getOutline().catch(() => null);
      if (tab.pdf !== pdf) return;
      tab.outline = ol;
    }
    if (this.tab !== tab) return;
    if (!tab.outline?.length) {
      box.innerHTML = `<div class="sb-empty">${FLOURISH}这份文件没有目录<br>可以用「缩略图」翻看</div>`;
      return;
    }
    const flat = tab.olFlat = [];
    let total = 0;
    const countAll = items => items.forEach(it => { total++; if (it.items?.length) countAll(it.items); });
    countAll(tab.outline);
    const render = (items, depth) => '<ul>' + items.map(it => {
      const i = flat.push(it) - 1, kids = it.items?.length;
      const open = kids && (depth === 0 ? total <= 400 || it.count > 0 : it.count > 0 || total <= 60);
      return `<li><div class="ol-row"><button class="ol-tg${kids ? (open ? '' : ' closed') : ' leaf'}" tabindex="-1">${icon('down', 14, 2)}</button>`
        + `<button class="ol-it${it.bold ? ' b' : ''}${it.italic ? ' i' : ''}" data-i="${i}">${esc(it.title || '（无标题）')}</button></div>`
        + (kids ? `<div class="ol-kids${open ? '' : ' closed'}">${render(it.items, depth + 1)}</div>` : '') + '</li>';
    }).join('') + '</ul>';
    box.innerHTML = render(tab.outline, 0);
  }

  /* ---------- 查找 ---------- */
  #initFindbar() {
    const inp = $('#findInput');
    const run = debounce(() => this.#dispatchFind(''), 220);
    inp.addEventListener('input', () => { this.find.query = inp.value; if (!inp.value) { this.#dispatchFind(''); $('#findCount').textContent = ''; } else run(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); run.cancel(); this.findAgain(e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    $('#findPrev').addEventListener('click', () => this.findAgain(true));
    $('#findNext').addEventListener('click', () => this.findAgain(false));
    $('#findClose').addEventListener('click', () => this.closeFind());
    $('#findCase').addEventListener('click', e => { this.find.caseSensitive = !this.find.caseSensitive; e.currentTarget.classList.toggle('on', this.find.caseSensitive); this.#dispatchFind(''); });
    $('#findWord').addEventListener('click', e => { this.find.entireWord = !this.find.entireWord; e.currentTarget.classList.toggle('on', this.find.entireWord); this.#dispatchFind(''); });
  }
  openFind(text) {
    if (!this.tab) return;
    const fb = $('#findbar'), inp = $('#findInput');
    fb.hidden = false;
    $('#tbFind').classList.add('on');
    if (text) { inp.value = text.slice(0, 200); this.find.query = inp.value; this.#dispatchFind(''); }
    inp.focus();
    inp.select();
  }
  closeFind(silent = false) {
    const fb = $('#findbar');
    if (fb.hidden) return;
    fb.hidden = true;
    $('#tbFind').classList.remove('on');
    $('#findCount').textContent = '';
    this.leaf?.eventBus.dispatch('findbarclose', { source: this });
    if (!silent) this.focus();
  }
  toggleFind() { $('#findbar').hidden ? this.openFind(window.getSelection()?.toString().trim()) : this.closeFind(); }
  findAgain(prev = false) {
    if (!this.tab) return;
    if ($('#findbar').hidden) return this.openFind();
    if (!this.find.query) return $('#findInput').focus();
    this.#dispatchFind('again', prev);
  }
  #dispatchFind(type, prev = false) {
    const L = this.leaf;
    if (!L) return;
    L.eventBus.dispatch('find', {
      source: this, type, query: this.find.query, caseSensitive: this.find.caseSensitive, entireWord: this.find.entireWord,
      highlightAll: true, findPrevious: prev, matchDiacritics: false,
    });
  }
  #findCount(mc, state) {
    const el = $('#findCount');
    if (!this.find.query) { el.textContent = ''; return; }
    if (state === FindState.PENDING) { el.textContent = '查找中…'; el.classList.remove('miss'); return; }
    if (state === FindState.NOT_FOUND || (mc && mc.total === 0 && state !== undefined)) { el.textContent = '没有找到'; el.classList.add('miss'); return; }
    if (mc && mc.total > 0) {
      el.textContent = `${mc.current || 0} / ${mc.total}${mc.total >= 1000 ? '+' : ''}`;
      el.classList.remove('miss');
    }
    if (state === FindState.WRAPPED) toast('已经找了一圈，回到另一头继续', { ms: 1600 });
  }

  /* ---------- 演示模式 ---------- */
  async enterPresentation() {
    const v = this.viewer;
    if (!v || this.present) return;
    this.closeFind(true);
    this.#hideSelBar();
    if (this.editMode !== EditMode.NONE) { this.commitEdits(); this.setEditMode(EditMode.NONE); }
    this.present = { scroll: v.scrollMode, spread: v.spreadMode, scale: v.currentScaleValue, page: this.page, hand: this.hand };
    document.body.classList.add('present');
    await platform.win.setFullscreen(true);
    v.presentationModeState = 3;           // PresentationModeState.FULLSCREEN：适合页面时不留边距
    v.scrollMode = ScrollMode.PAGE;
    v.spreadMode = SpreadMode.NONE;
    const page = this.present.page;
    await new Promise(r => setTimeout(r, 160));
    v.currentScaleValue = 'page-fit';
    v.currentPageNumber = page;
    this.focus();
    this.#presentCursor();
  }
  async exitPresentation() {
    if (!this.present) return;
    const p = this.present, page = this.page, v = this.viewer;
    this.present = null;
    document.body.classList.remove('present');
    clearTimeout(this.cursorTimer);
    this.container?.classList.remove('cursor');
    await platform.win.setFullscreen(false);
    if (!v) return;
    v.presentationModeState = 1;           // NORMAL
    v.scrollMode = p.scroll;
    v.spreadMode = p.spread;
    await new Promise(r => setTimeout(r, 120));
    v.currentScaleValue = p.scale;
    // 版式和缩放切回去时 pdf.js 会按演示时的旧位置重新定位，等布局稳定后再回到退出时的那一页
    await nextFrame();
    await nextFrame();
    v.scrollPageIntoView({ pageNumber: page });
  }
  #presentCursor() {
    const c = this.container;
    if (!c) return;
    c.classList.add('cursor');
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => c.classList.remove('cursor'), 1800);
  }
  #presentWheel(e) {
    e.preventDefault();
    const now = Date.now();
    if (now - (this.lastFlip || 0) < 280 || Math.abs(e.deltaY) < 4) return;
    this.lastFlip = now;
    e.deltaY > 0 ? this.nextPage() : this.prevPage();
  }
  presentKey(e) {
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'j'].includes(k)) this.nextPage();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'k'].includes(k)) this.prevPage();
    else if (k === 'Home') this.firstPage();
    else if (k === 'End') this.lastPage();
    else if (k === 'Escape' || k === 'F5') this.exitPresentation();
    else return false;
    e.preventDefault();
    return true;
  }
  presentPointer(e) {
    this.#presentCursor();
    if (e.type !== 'mousedown' || e.target.closest('a')) return;
    if (e.button === 0) this.nextPage();
    else if (e.button === 2) this.prevPage();
  }

  /* ---------- 文档属性 ---------- */
  async showProperties() {
    const t = this.tab;
    if (!t) return;
    const pdf = t.pdf;
    const [{ info, metadata }, page1, perms] = await Promise.all([pdf.getMetadata().catch(() => ({})), pdf.getPage(1), pdf.getPermissions().catch(() => null)]);
    const dc = k => { try { return metadata?.get(k) || ''; } catch { return ''; } };
    const date = s => { const d = s ? pdfjsLib.PDFDateString.toDateObject(s) : null; return d ? fmtDateTime(d) : ''; };
    const vp = page1.getViewport({ scale: 1 });
    const mm = x => Math.round(x / 72 * 25.4);
    const w = mm(vp.width), h = mm(vp.height);
    const near = (a, b) => Math.abs(a - b) <= 2;
    const name = [['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['B5', 176, 250], ['B5（JIS）', 182, 257], ['Letter', 216, 279], ['Legal', 216, 356]]
      .find(([, a, b]) => (near(w, a) && near(h, b)) || (near(w, b) && near(h, a)))?.[0];
    const size = t.size ?? (await pdf.getDownloadInfo().catch(() => ({}))).length;
    const enc = info?.EncryptFilterName ? (t.password ? '有打开密码' : perms ? '有权限限制（没有打开密码）' : '已加密') : '无';
    const rows = [
      ['文件名', t.name], ['位置', t.path ? platform.dirname(t.path) : ''], ['文件大小', size ? `${fmtSize(size)}（${size.toLocaleString()} 字节）` : ''],
      ['页数', `${t.numPages} 页`], ['页面尺寸', `${w} × ${h} 毫米${name ? `（${name}，${w > h ? '横向' : '纵向'}）` : `（${w > h ? '横向' : '纵向'}）`}`],
      ['标题', info?.Title || dc('dc:title')], ['作者', info?.Author || dc('dc:creator')], ['主题', info?.Subject || dc('dc:description')], ['关键词', info?.Keywords],
      ['创建时间', date(info?.CreationDate)], ['修改时间', date(info?.ModDate)], ['创建程序', info?.Creator], ['PDF 生成器', info?.Producer],
      ['PDF 版本', info?.PDFFormatVersion], ['快速网页查看', info?.IsLinearized ? '是' : '否'],
      ['加密', enc], ['表单', info?.IsXFAPresent ? 'XFA 表单' : info?.IsAcroFormPresent ? '有可填写的表单' : '无'],
    ].filter(r => r[1]);
    openDialog({
      html: `${dlgHead('文档属性', { k: 'Of this Book', sub: t.name })}<dl class="kv" style="margin-top:16px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="dlg-f">${t.path && platform.isDesktop ? '<button class="btn ghost" id="pRev">在文件夹中显示</button>' : ''}<button class="btn" data-dlg="ok" autofocus>关闭</button></div>`,
      onOpen: d => d.querySelector('#pRev')?.addEventListener('click', () => platform.revealInFolder(t.path)),
    });
  }

  /* ---------- 打印：每页按 150 dpi 画成图片，交给系统打印（和 pdf.js 自带阅读器的做法一样；没保存的批注也会印出来） ---------- */
  async print() {
    const t = this.tab;
    if (!t) return;
    this.commitEdits(t);
    const pdf = t.pdf, n = t.numPages;
    let cancelled = false;
    openDialog({
      dismissable: false,
      html: `${dlgHead('正在准备打印', { k: 'To the Press', sub: t.name })}<div class="dlg-b"><div class="prog"><i id="prI"></i></div><div class="sub" id="prT" style="margin-top:8px">0 / ${n}</div></div>
        <div class="dlg-f"><button class="btn ghost" id="prC">取消</button></div>`,
      onOpen: d => d.querySelector('#prC').addEventListener('click', () => { cancelled = true; closeDialog(null); }),
    });
    const box = $('#printContainer'), urls = [];
    box.innerHTML = '';
    let style = $('#printStyle');
    if (!style) { style = document.createElement('style'); style.id = 'printStyle'; document.head.append(style); }
    try {
      const p1 = await pdf.getPage(1), v1 = p1.getViewport({ scale: 1 });
      style.textContent = `@page{size:${v1.width}pt ${v1.height}pt;margin:0}`;
      const printStorage = pdf.annotationStorage?.print;
      for (let i = 1; i <= n && !cancelled; i++) {
        const page = await pdf.getPage(i);
        let scale = 150 / 72;
        const vp0 = page.getViewport({ scale: 1 });
        if (vp0.width * vp0.height * scale * scale > 2 ** 25) scale = Math.sqrt(2 ** 25 / (vp0.width * vp0.height));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, intent: 'print', annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE, printAnnotationStorage: printStorage }).promise;
        const url = await canvasToBlobURL(canvas, 'image/png');
        canvas.width = canvas.height = 0;
        urls.push(url);
        const wrap = document.createElement('div');
        wrap.className = 'pp';
        const img = new Image();
        img.src = url;
        wrap.append(img);
        box.append(wrap);
        await img.decode().catch(() => {});
        const bar = $('#prI'), txt = $('#prT');
        if (bar) bar.style.width = `${(i / n) * 100}%`;
        if (txt) txt.textContent = `${i} / ${n}`;
      }
      if (cancelled) return;
      closeDialog(null);
      await nextFrame();
      window.print();
    } catch (e) {
      closeDialog(null);
      toast('打印失败：' + pdfErrorText(e), { kind: 'err' });
    } finally {
      setTimeout(() => { box.innerHTML = ''; urls.forEach(u => URL.revokeObjectURL(u)); }, 1000);
    }
  }
}
