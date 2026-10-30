// 浏览器预览里手动测试用的小工具：node tools/serve.mjs 之后在页面里 import("/__test/helpers.js")（serve.mjs 把这个路径映射到本文件）
const H = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  ent: n => ({ name: n, path: null, size: null, read: async () => new Uint8Array(await (await fetch('/__test/' + encodeURIComponent(n))).arrayBuffer()) }),
  async open(n) {
    const before = __pv.state.tabs.length;
    await __pv.openEntries([H.ent(n)]);
    for (let i = 0; i < 80; i++) {
      await H.sleep(150);
      const t = __pv.state.tabs[before];
      if (t && !t.loading && t.leaf && !t.leaf.pending && t.leaf.ui) return t;
    }
    return __pv.state.tabs[before];
  },
  layer(p = 1) { return document.querySelector(`.vc.on .page[data-page-number="${p}"] .annotationEditorLayer`); },
  ev(el, type, x, y, b = 1, id = 11) {
    const r = H.layer().getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: b, pointerId: id, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }));
  },
  async text(x, y, s) {
    __pv.reader.setEditMode(3);
    await H.sleep(600);
    const L = H.layer();
    H.ev(L, 'pointerdown', x, y);
    H.ev(L, 'pointerup', x, y, 0);
    await H.sleep(300);
    const all = document.querySelectorAll('.vc.on .freeTextEditor .internal');
    const ed = all[all.length - 1];
    ed.focus();
    document.execCommand('insertText', false, s);
    __pv.reader.commitEdits();
    await H.sleep(300);
  },
  async ink(x0, y0) {
    __pv.reader.setEditMode(15);
    await H.sleep(600);
    const L = H.layer();
    H.ev(L, 'pointerdown', x0, y0, 1, 12);
    for (let i = 1; i <= 24; i++) { H.ev(L, 'pointermove', x0 + i * 10, y0 + Math.sin(i / 3) * 24, 1, 12); await H.sleep(5); }
    H.ev(L, 'pointerup', x0 + 240, y0, 0, 12);
    await H.sleep(200);
    __pv.reader.setEditMode(0);
    await H.sleep(600);
  },
  async put(name, bytes) { await fetch('/__out/' + encodeURIComponent(name), { method: 'PUT', body: bytes }); },
  types(t) { return [...(t.pdf.annotationStorage.serializable.map?.values() || [])].map(v => v.annotationType); },
  // 在签名板上画两笔（用 pen 事件，带压力）
  signStrokes() {
    const cv = document.querySelector('#sgCv'), r = cv.getBoundingClientRect();
    const pe = (type, x, y, b = 1, pr = 0.5) => cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: b, pointerId: 21, pointerType: 'pen', pressure: pr, isPrimary: true, bubbles: true, cancelable: true }));
    const stroke = pts => { pe('pointerdown', ...pts[0], 1, 0.2); pts.forEach((p, i) => pe('pointermove', p[0], p[1], 1, 0.25 + 0.6 * Math.sin(i / pts.length * Math.PI))); pe('pointerup', ...pts[pts.length - 1], 0, 0); };
    stroke(Array.from({ length: 61 }, (_, i) => { const t = i / 60; return [60 + t * 160, 120 - Math.abs(Math.sin(t * Math.PI * 2)) * 60 + t * 10]; }));
    stroke(Array.from({ length: 41 }, (_, i) => { const t = i / 40; return [250 + Math.cos(t * Math.PI * 2) * 30 + t * 40, 100 + Math.sin(t * Math.PI * 2) * 30]; }));
  },
  // 测试 PDF / 图片做成 File
  async file(n, type = 'application/pdf') { return new File([await H.ent(n).read()], n, { type }); },
  async png(w = 400, h = 250, color = '#B4372A', label = '') {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
    if (label) { x.fillStyle = '#fff'; x.font = `bold ${Math.round(h / 3)}px serif`; x.textAlign = 'center'; x.fillText(label, w / 2, h * 0.62); }
    return new File([await new Promise(r => c.toBlob(r, 'image/png'))], (label || 'img') + '.png', { type: 'image/png' });
  },
  // 下一次弹文件选择框（网页版的 <input type=file>）时直接把这些文件塞进去
  feedFiles(files) {
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return orig.call(this);
      HTMLInputElement.prototype.click = orig;
      const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
      this.files = dt.files;
      setTimeout(() => this.dispatchEvent(new Event('change')));
    };
  },
  // 拦下网页版的「下载」，文件存到 .cache/out；done() 恢复并返回 [{ name, size }]
  catchDownloads() {
    const orig = HTMLAnchorElement.prototype.click, got = [];
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return orig.call(this);
      const name = this.download;
      got.push(fetch(this.href).then(r => r.arrayBuffer()).then(b => H.put(name, new Uint8Array(b)).then(() => ({ name, size: b.byteLength }))));
    };
    return { done: async () => { HTMLAnchorElement.prototype.click = orig; return Promise.all(got); } };
  },
  org: () => document.querySelector('#orgDlg'),
  ocells: () => [...document.querySelectorAll('#orgDlg .ocell')].map(c => c.querySelector('b').textContent + '|' + c.querySelector('small').textContent),
  oclick(a) { document.querySelector(`#orgDlg [data-a="${a}"]`).click(); },
  // 点第 i 个格子（0 起），mods: { ctrlKey, shiftKey }
  osel(i, mods = {}) {
    const c = document.querySelectorAll('#orgDlg .ocell')[i], r = c.getBoundingClientRect();
    const o = { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 1, pointerId: 31, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, ...mods };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    window.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  },
};
window.__h = H;
export default H;
