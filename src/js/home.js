// 首页：书名页、三张卡片（打开 / 合并 / 转成 PDF）、最近打开、今日之诗（和课表站同一天同一首；默认背景就是那首诗的 Copy Z 原版插图，见 backdrop.js），右下角「背景」
import { $, esc, fmtWhen, fmtSize } from './util.js';
import { icon, FLOURISH } from './icons.js';
import { getRecent, removeRecent, clearRecent, getTheme } from './store.js';
import * as platform from './platform.js';
import { openDialog } from './ui.js';
import SONGS from './songs.js';

const H8 = 8 * 3600e3, DAY = 864e5;
const dayNo = ms => Math.floor((ms + H8) / DAY);               // 按北京时间换日，和课表站一致
const ORDER = (() => {                                         // 天真、经验两卷交替
  const I = SONGS.filter(x => x.b === 'I'), E = SONGS.filter(x => x.b === 'E'), out = [];
  for (let i = 0; i < Math.max(I.length, E.length); i++) { if (I[i]) out.push(I[i]); if (E[i]) out.push(E[i]); }
  return out;
})();
export const todayPoem = () => ORDER[((dayNo(Date.now()) % ORDER.length) + ORDER.length) % ORDER.length];
const bookOf = pm => pm.b === 'I' ? ['Songs of Innocence', 1789] : ['Songs of Experience', 1794];

export function showPoem(pm = todayPoem()) {
  const [book, year] = bookOf(pm);
  openDialog({
    html: `<div class="poem-dlg"><img src="assets/plates/${pm.p}.jpg" alt="${esc(pm.t)}，布莱克原版插图">
      <div class="pd-t">${esc(pm.t)}</div><div class="pd-b">${book}, ${year} · William Blake</div>
      <div class="pd-v">${pm.st.map(st => `<p>${st.map(esc).join('<br>')}</p>`).join('')}</div></div>
      <div class="dlg-f"><button class="btn ghost" data-dlg="ok">关闭</button></div>`,
  });
}

/* actions: { open(), merge(), convert(), openRecent(path), backdrop() } */
export function renderHome(actions) {
  const root = $('#home');
  const dark = getTheme() === 'dark';
  const pm = todayPoem(), [book, year] = bookOf(pm);
  const first = pm.st[0], lines = first.length <= 8 ? first : first.slice(0, 4);
  const recent = platform.isDesktop ? getRecent() : [];
  root.innerHTML = `<div class="home-in">
    <section class="plate panel">
      ${FLOURISH}
      <h1>PDF 查看器</h1>
      <div class="sub">Shewing the Leaves of many Books, &amp; the Binding of them into One</div>
      <div class="sub2">READING · AND · BINDING</div>
      <div class="acts">
        <button class="act" data-home="open">
          <img class="pl" src="assets/plates/${dark ? '30' : '04'}.jpg" alt="">
          <span><span class="t">${icon('open', 22)}打开 PDF</span>
          <span class="d">翻阅、查找、缩放、打印<br><span class="kbd">Ctrl + O</span></span></span>
        </button>
        <button class="act" data-home="merge">
          <img class="pl" src="assets/plates/${dark ? '29' : '03'}.jpg" alt="">
          <span><span class="t">${icon('bind', 22)}合并 PDF</span>
          <span class="d">把几份 PDF 按顺序装订成一本<br>也能只挑其中几页</span></span>
        </button>
        <button class="act wide" data-home="convert">
          <img class="pl" src="assets/plates/${dark ? '42' : '22'}.jpg" alt="">
          <span><span class="t">${icon('convert', 22)}转成 PDF</span>
          <span class="d">${platform.isDesktop ? '图片、Word、Excel、PPT、文本、Markdown、网页都能转成 PDF<br>几个文件也可以合成一份，转好了还能批注、整理页面' : '把照片、截图转成 PDF，几张图也可以合成一份<br>桌面版还能转 Word、Excel、PPT、文本和网页'}</span></span>
        </button>
      </div>
      <div class="hint">${icon('drop', 16)}${platform.isDesktop ? '也可以把 PDF、图片、Office 文档直接拖进窗口' : '也可以把 PDF 或图片直接拖进窗口'}</div>
    </section>
    ${recent.length ? `<section class="recent">
      <div class="recent-h"><h2>最近打开<i>Of late</i></h2><button class="lnk" data-home="clear">清空记录</button></div>
      <div class="rgrid">${recent.map(r => {
        const pct = r.pages ? Math.min(100, Math.round((r.page || 1) / r.pages * 100)) : 0;
        return `<button class="rc" data-path="${esc(r.path)}" title="${esc(r.path)}">
          <span class="cv">${r.thumb ? `<img src="${r.thumb}" alt="">` : `<span class="ph">${icon('book', 26)}</span>`}</span>
          <span class="n">${esc(r.name)}</span>
          <span class="m"><span>${r.pages ? `第 ${r.page || 1} / ${r.pages} 页` : (r.size ? fmtSize(r.size) : '')}</span><span>${fmtWhen(r.at)}</span></span>
          <span class="bar"><i style="width:${pct}%"></i></span>
          <span class="rm" data-rm="${esc(r.path)}" title="从列表里去掉">${icon('close', 14)}</span>
        </button>`;
      }).join('')}</div></section>` : ''}
    <footer class="colophon" data-home="poem" title="读全诗">${FLOURISH}<div class="v">${lines.map(esc).join('<br>')}</div><div class="src">— ${esc(pm.t)}, ${book}, ${year}</div></footer>
  </div>
  <button class="bgfab" data-home="backdrop" title="换背景：今日之诗、水彩画、素纸，或者自己的图片">${icon('backdrop', 18)}<span>背景</span></button>`;
  root.onclick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); removeRecent(rm.dataset.rm); renderHome(actions); return; }
    const rc = e.target.closest('.rc');
    if (rc) return actions.openRecent(rc.dataset.path);
    const b = e.target.closest('[data-home]');
    if (!b) return;
    const a = b.dataset.home;
    if (a === 'open') actions.open();
    else if (a === 'merge') actions.merge();
    else if (a === 'convert') actions.convert();
    else if (a === 'poem') showPoem();
    else if (a === 'backdrop') actions.backdrop();
    else if (a === 'clear') { clearRecent(); renderHome(actions); }
  };
  // 文件被移走 / 删掉的，灰掉并标出来
  if (recent.length) {
    platform.pathsExist(recent.map(r => r.path)).then(ok => {
      ok.forEach((y, i) => {
        if (y) return;
        const el = root.querySelector(`.rc[data-path="${CSS.escape(recent[i].path)}"]`);
        if (!el) return;
        el.classList.add('missing');
        el.querySelector('.m span').innerHTML = '<b>文件不在原处了</b>';
      });
    }).catch(() => {});
  }
}
