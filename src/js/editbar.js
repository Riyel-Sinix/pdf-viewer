// 编辑栏：批注工具（阅读 / 高亮 / 画笔 / 文字 / 图片 / 签名）、颜色和粗细、撤销重做删除、整理页面、保存。
// 工具和参数都交给 pdf.js 的批注编辑器（reader.setEditMode / editParam）；选中了某条批注时，改颜色粗细改的是它。
import { $, $$, esc } from './util.js';
import { icon } from './icons.js';
import { prefs, savePrefs } from './store.js';
import { EditMode, EditParam as P, HIGHLIGHT_COLORS } from './reader.js';

// 画笔和文字的颜色：布莱克手工上色常用的几种
export const INKS = [['#2B231D', '墨'], ['#B4372A', '朱砂'], ['#2B5B8A', '普鲁士蓝'], ['#4E7A2D', '苔绿'], ['#A35A28', '赭石'], ['#6A3D72', '堇紫']];
const HLS = HIGHLIGHT_COLORS.map(([, c, n]) => [c, n]);

const TOOLS = [
  { mode: EditMode.NONE, ic: 'cursor', label: '阅读', tip: '阅读：选文字、点链接、填表单（Esc）' },
  { mode: EditMode.HIGHLIGHT, ic: 'marker', label: '高亮', tip: '高亮：拖选文字；在没有文字的地方也可以随手涂' },
  { mode: EditMode.INK, ic: 'pen', label: '画笔', tip: '画笔：随手画、圈、写' },
  { mode: EditMode.FREETEXT, ic: 'text', label: '文字', tip: '文字：在页面上点一下，就可以输入' },
  { mode: EditMode.STAMP, ic: 'image', label: '图片', tip: '图片：选一张图片放到当前页上（也可以直接把图片拖进来、粘贴进来）', act: 'image' },
  { mode: 'sign', ic: 'sign', label: '签名', tip: '签名：手写或打字，放到当前页上', act: 'sign' },
];
const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export class EditBar {
  /* hooks: image() sign() pages() save() undo() redo() */
  constructor(reader, hooks) {
    this.reader = reader;
    this.hooks = hooks;
    this.el = $('#editbar');
    this.mode = EditMode.NONE;
    this.selected = false;          // 现在有没有选中的批注（有的话，改颜色粗细只改它，不动默认值）
    $('#etools').innerHTML = TOOLS.map(t => `<button class="et" data-tool="${t.act || t.mode}" title="${esc(t.tip)}">${icon(t.ic, 18)}<span>${t.label}</span></button>`).join('');
    this.el.addEventListener('click', e => this.#onClick(e));
    this.el.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // 点按钮不抢焦点：正在打字的文字框、选中的批注都还在
    this.el.addEventListener('input', e => this.#onInput(e));
    this.el.addEventListener('change', e => { if (e.target.matches('input[type=range],input[type=color]')) this.reader.focus(); });
    this.show(prefs.editbar, false);
    this.#props();
    new ResizeObserver(() => this.#fit()).observe(this.el);
  }
  get open() { return !this.el.hidden; }
  show(on, save = true) {
    this.el.hidden = !on;
    if (on) this.#fit();
    $('#tbEdit').classList.toggle('on', !!on);
    if (save) { prefs.editbar = !!on; savePrefs(); }
    if (!on && this.reader.editMode !== EditMode.NONE) { this.reader.commitEdits(); this.reader.setEditMode(EditMode.NONE); }
  }
  toggle() { this.show(!this.open); }

  // 各工具的默认值（pdf.js 编辑器一准备好就设一次）
  defaults() {
    return [
      [P.HIGHLIGHT_COLOR, prefs.hl.color], [P.HIGHLIGHT_THICKNESS, prefs.hl.width],
      [P.INK_COLOR, prefs.ink.color], [P.INK_THICKNESS, prefs.ink.width], [P.INK_OPACITY, prefs.ink.opacity],
      [P.FREETEXT_COLOR, prefs.text.color], [P.FREETEXT_SIZE, prefs.text.size],
    ];
  }

  /* ---------- 阅读器 → 编辑栏 ---------- */
  setMode(mode) {
    if (mode !== EditMode.NONE && !this.open) this.show(true);
    const changed = mode !== this.mode;
    this.mode = mode;
    $$('.et', this.el).forEach(b => b.classList.toggle('on', b.dataset.tool === String(mode)));
    if (changed) { this.selected = false; this.#props(); }
  }
  setState(st = {}) {
    $('#ebDel').disabled = !st.hasSelectedEditor;
    const had = this.selected;
    this.selected = !!st.hasSelectedEditor;
    if (had && !this.selected) this.#props();       // 取消选中：控件回到默认值
  }
  setUndo(canUndo, canRedo) {
    $('#ebUndo').disabled = !canUndo;
    $('#ebRedo').disabled = !canRedo;
  }
  setDirty(dirty) { $('#ebSave').classList.toggle('dirty', !!dirty); }
  setEnabled(on) {
    $$('.et, #ebPages, #ebSave', this.el).forEach(b => { b.disabled = !on; });
  }
  // 选中了某条批注：控件显示它的颜色粗细
  setParams(details) {
    for (const [type, value] of details || []) {
      for (const el of $$(`[data-p="${type}"]`, this.el)) {
        if (el.matches('.swc')) el.classList.toggle('on', sameColor(el.dataset.v, value));
        else if (el.type === 'color') el.value = value;
        else if (el.type === 'range') { el.value = type === P.INK_OPACITY ? Math.round(value * 100) : value; this.#rangeText(el); }
      }
    }
  }

  /* ---------- 颜色、粗细 ---------- */
  #props() {
    const box = $('#eprops'), m = this.mode;
    const sw = (list, cur, type) => `<span class="swrow">${list.map(([c, n]) => `<button class="swc${sameColor(c, cur) ? ' on' : ''}" style="--c:${c}" data-p="${type}" data-v="${c}" title="${n}"></button>`).join('')}</span>`;
    const pick = (type, cur) => `<label class="cpick" title="别的颜色"><input type="color" data-p="${type}" value="${cur}">${icon('plus', 14, 2)}</label>`;
    const rng = (label, type, min, max, step, val, unit = '', tip = '') => `<label class="erng" title="${esc(tip || label)}"><span>${label}</span><input type="range" data-p="${type}" min="${min}" max="${max}" step="${step}" value="${val}" data-u="${unit}"><b>${val}${unit}</b></label>`;
    const hint = t => `<span class="ehint">${t}</span>`;
    if (m === EditMode.HIGHLIGHT) box.innerHTML = sw(HLS, prefs.hl.color, P.HIGHLIGHT_COLOR) + rng('笔宽', P.HIGHLIGHT_THICKNESS, 8, 24, 1, prefs.hl.width, '', '在没有文字的地方随手涂时的笔宽');
    else if (m === EditMode.INK) box.innerHTML = sw(INKS, prefs.ink.color, P.INK_COLOR) + pick(P.INK_COLOR, prefs.ink.color)
      + rng('粗细', P.INK_THICKNESS, 1, 20, 1, prefs.ink.width) + rng('浓淡', P.INK_OPACITY, 10, 100, 5, Math.round(prefs.ink.opacity * 100), '%');
    else if (m === EditMode.FREETEXT) box.innerHTML = sw(INKS, prefs.text.color, P.FREETEXT_COLOR) + pick(P.FREETEXT_COLOR, prefs.text.color) + rng('字号', P.FREETEXT_SIZE, 6, 72, 1, prefs.text.size);
    else if (m === EditMode.STAMP) box.innerHTML = hint('拖动挪位置，拉四角改大小；选中后按 Delete 删除');
    else box.innerHTML = hint('选中文字就能高亮；双击页面上原有的批注可以修改');
    this.#fit();
  }
  // 放不下时一级一级收紧：先藏滑块的名字（鼠标停上去还能看到），再缩短滑块、藏数值、藏「别的颜色」。
  // 各工具的控件多少不一样，所以按实际宽度量，不按窗口宽度猜
  #fit() {
    const box = $('#eprops'), levels = ['k1', 'k2', 'k3', 'k4'];
    this.el.classList.remove(...levels);
    if (this.el.hidden) return;
    for (const k of levels) {
      if (box.scrollWidth <= box.clientWidth + 1) break;
      this.el.classList.add(k);
    }
  }
  #rangeText(el) { const b = el.parentElement.querySelector('b'); if (b) b.textContent = el.value + (el.dataset.u || ''); }
  #set(type, value) {
    this.reader.editParam(type, value);
    if (this.selected) return;                       // 改的是选中的那条批注
    const p = { [P.HIGHLIGHT_COLOR]: ['hl', 'color'], [P.HIGHLIGHT_THICKNESS]: ['hl', 'width'], [P.INK_COLOR]: ['ink', 'color'], [P.INK_THICKNESS]: ['ink', 'width'],
      [P.INK_OPACITY]: ['ink', 'opacity'], [P.FREETEXT_COLOR]: ['text', 'color'], [P.FREETEXT_SIZE]: ['text', 'size'] }[type];
    if (p) { prefs[p[0]] = { ...prefs[p[0]], [p[1]]: value }; savePrefs(); }
  }
  #onInput(e) {
    const el = e.target, type = +el.dataset.p;
    if (!el.dataset.p) return;
    if (el.type === 'range') {
      this.#rangeText(el);
      this.#set(type, type === P.INK_OPACITY ? +el.value / 100 : +el.value);
    } else if (el.type === 'color') {
      $$(`.swc[data-p="${type}"]`, this.el).forEach(b => b.classList.toggle('on', sameColor(b.dataset.v, el.value)));
      this.#set(type, el.value);
    }
  }
  #onClick(e) {
    const t = e.target.closest('[data-tool]');
    if (t && !t.disabled) {
      const k = t.dataset.tool;
      if (k === 'image') this.hooks.image();
      else if (k === 'sign') this.hooks.sign();
      else this.reader.setEditMode(+k);
      return;
    }
    const s = e.target.closest('.swc[data-p]');
    if (s) {
      const type = +s.dataset.p;
      $$(`.swc[data-p="${type}"]`, this.el).forEach(b => b.classList.toggle('on', b === s));
      const c = $(`input[type=color][data-p="${type}"]`, this.el);
      if (c) c.value = s.dataset.v;
      this.#set(type, s.dataset.v);
      this.reader.focus();
      return;
    }
    const b = e.target.closest('button[id]');
    if (!b || b.disabled) return;
    if (b.id === 'ebUndo') this.hooks.undo();
    else if (b.id === 'ebRedo') this.hooks.redo();
    else if (b.id === 'ebDel') this.reader.editAction('delete');
    else if (b.id === 'ebPages') this.hooks.pages();
    else if (b.id === 'ebSave') this.hooks.save();
    else if (b.id === 'ebClose') { this.show(false); this.reader.focus(); }
  }
}
