// 资源管理器右键「转成 PDF」的小窗口（convert.html）：只显示进度和结果，不开主窗口。
// 转好的存在源文件旁边（同名的已经有了就存成「名字 (1).pdf」，不覆盖），不自动打开；结果里可以点「打开」（在主窗口里开）、「在文件夹中显示」。
// 全都转好、存好了几秒后自己关掉（在窗口里点了、按了键就不关）；有没转成的、存不进去的（源文件夹只读之类）留着，后者可以「另存为…」。
// 多选时资源管理器每个文件启动一次程序，单实例把它们陆续转过来（src-tauri/src/lib.rs）：攒一会儿（最后一个到了 400 毫秒后）一起转；
// 转的时候又来的，转完这一批接着转，结果合在一起显示
import { esc } from './util.js';
import { icon } from './icons.js';
import * as platform from './platform.js';
import { convertEntries, convertError, canConvert } from './convert.js';

const $ = s => document.querySelector(s);
const titleEl = $('#cvwTitle'), body = $('#cvwBody'), foot = $('#cvwFoot'), closeBtn = $('#cvwClose');
document.querySelectorAll('[data-ic]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic, +el.dataset.sz || 18)));

const AUTO_CLOSE_MS = 5000;
const queue = [];
// saved：存好的路径；unsaved：转好了但存不进源文件夹的 { name, bytes, dir, error }；failed：没转成的 { name, error }
const done = { saved: [], unsaved: [], failed: [] };
let total = 0, busy = false, view = 'progress', timer = 0, closeTimer = 0, stay = false;
const finished = () => done.saved.length + done.unsaved.length + done.failed.length;

function enqueue(entries) {
  for (const en of entries) {
    if (canConvert(en.name)) queue.push(en);
    else done.failed.push({ name: en.name, error: '不认得这种文件' });
    total++;
  }
  cancelAutoClose();
  if (!busy) showProgress('正在准备…', 0);
  clearTimeout(timer);
  timer = setTimeout(run, 400);
}

async function run() {
  if (busy) return;                      // 正在转的那一批转完会接着转
  const batch = queue.splice(0);
  if (!batch.length) { if (!busy) showResult(); return; }
  busy = true;
  const before = finished();
  try {
    const res = await convertEntries(batch, { ask: false, combine: false, report: (text, n) => showProgress(text, before + n) });
    done.failed.push(...(res?.failed || []));
    for (const r of res?.results || []) {
      try { done.saved.push(await saveBeside(r)); } catch (e) {
        console.warn(e);
        done.unsaved.push({ name: r.name, bytes: r.bytes, dir: r.dir, error: e?.message || String(e) });
      }
    }
  } catch (e) {
    console.error(e);
    for (const en of batch) done.failed.push({ name: en.name, error: convertError(e) });
  } finally {
    busy = false;
    if (queue.length) run(); else showResult();
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

function showProgress(text, n) {
  view = 'progress';
  document.body.dataset.view = view;
  titleEl.textContent = '正在转成 PDF';
  closeBtn.disabled = true;
  closeBtn.title = '转完才能关';
  const many = total > 1, pct = many ? Math.min(100, Math.round((n / total) * 100)) : 0;
  body.innerHTML = `<div class="prog${many ? '' : ' ind'}"><i${many ? ` style="width:${pct}%"` : ''}></i></div>
    <div class="st">${esc(text)}</div>${many ? `<div class="ct">${Math.min(n, total)} / ${total}</div>` : ''}`;
  foot.innerHTML = '';
}

function showResult() {
  view = 'result';
  document.body.dataset.view = view;
  closeBtn.disabled = false;
  closeBtn.title = '关闭';
  const { saved, unsaved, failed } = done, bad = unsaved.length + failed.length;
  titleEl.textContent = !bad ? '转好了' : saved.length ? `转好了 ${saved.length} 份，${bad} 份有问题` : unsaved.length && !failed.length ? '没能存到源文件旁边' : '没转成';
  const row = (ic, cls, name, note = '') => `<li class="${cls}"><span class="ic">${icon(ic, 16)}</span><span class="nm" title="${esc(name)}">${esc(platform.basename(name))}</span>${note ? `<span class="nt" title="${esc(note)}">${esc(note)}</span>` : ''}</li>`;
  const items = [
    ...failed.map(f => row('alert', 'err', f.name, f.error)),
    ...unsaved.map(u => row('alert', 'err', u.name, `没能存到源文件旁边：${u.error}`)),
    ...saved.map(p => row('ok', 'ok', p)),
  ];
  const lead = !bad
    ? (saved.length === 1 ? '存在源文件旁边：' : `${saved.length} 份 PDF 都存在源文件旁边：`)
    : unsaved.length ? '存不进去的可以另存到别的地方：' : '';
  body.innerHTML = `${lead ? `<div class="ld">${esc(lead)}</div>` : ''}<ol class="cvwlist">${items.join('')}</ol>`;
  foot.innerHTML = `${!bad && !stay ? `<span class="auto" id="cvwAuto">${AUTO_CLOSE_MS / 1000} 秒后自动关闭</span>` : '<span class="auto"></span>'}
    ${unsaved.length ? `<button class="btn" data-act="saveas">${icon('save', 16)}另存为…</button>` : ''}
    ${saved.length ? `<button class="btn ghost" data-act="reveal">${icon('folder', 16)}在文件夹中显示</button>
      <button class="btn${unsaved.length ? ' ghost' : ''}" data-act="open">${icon('open', 16)}打开</button>` : ''}
    ${!saved.length && !unsaved.length ? '<button class="btn" data-act="close">关闭</button>' : ''}`;
  if (!bad && !stay) startAutoClose();
}

function startAutoClose() {
  cancelAutoClose();
  const end = Date.now() + AUTO_CLOSE_MS;
  closeTimer = setInterval(() => {
    const left = Math.ceil((end - Date.now()) / 1000), el = document.getElementById('cvwAuto');
    if (left <= 0) { cancelAutoClose(); close(); return; }
    if (el) el.textContent = `${left} 秒后自动关闭`;
  }, 250);
}
function cancelAutoClose() { clearInterval(closeTimer); closeTimer = 0; }
// 在窗口里点了、按了键：用户在看，不自动关了（不看鼠标移进来：窗口经常正好弹在鼠标底下）
function keepOpen() {
  if (stay) return;
  stay = true;
  if (closeTimer) { cancelAutoClose(); const el = document.getElementById('cvwAuto'); if (el) el.textContent = ''; }
}
document.addEventListener('pointerdown', keepOpen, true);

function close() { if (!busy) platform.win.close(); }

// 存不进源文件夹的：一个个问存到哪里
async function saveAs() {
  for (const u of [...done.unsaved]) {
    const path = await platform.askSavePath(u.name, u.dir);
    if (!path) break;
    try {
      await platform.writeFile(path, u.bytes);
      done.unsaved.splice(done.unsaved.indexOf(u), 1);
      done.saved.push(path);
    } catch (e) { u.error = e?.message || String(e); }
  }
  showResult();
}

foot.addEventListener('click', async e => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (act === 'open') { await platform.openInMain(done.saved).catch(err => console.warn(err)); close(); }
  else if (act === 'reveal') platform.revealInFolder(done.saved[0]);
  else if (act === 'saveas') saveAs();
  else if (act === 'close') close();
});
closeBtn.addEventListener('click', close);
addEventListener('keydown', e => { keepOpen(); if (e.key === 'Escape') close(); });

async function takePending() {
  try {
    const { convert } = await platform.takePendingFiles();
    if (convert.length) enqueue(convert);
  } catch (e) { console.warn(e); }
}

// 调试 / 自动化测试用
window.__cv = {
  state: () => ({ view, busy, total, queued: queue.length, stay, saved: [...done.saved], unsaved: done.unsaved.map(u => ({ name: u.name, dir: u.dir, error: u.error })), failed: [...done.failed] }),
  keepOpen,
  // 看结果页的样子：__cv.demo({ saved: ['D:\a.pdf'], failed: [{ name: 'b.docx', error: '…' }] })
  demo(d) { Object.assign(done, { saved: [], unsaved: [], failed: [] }, d); total = finished(); showResult(); },
};

(async function init() {
  requestAnimationFrame(() => requestAnimationFrame(() => platform.win.showIfHidden().catch(() => {})));
  try { await platform.onFilesPending(takePending); } catch (e) { console.warn(e); }
  await takePending();
  // 没拿到文件（不该出现）：别留个空窗口
  if (platform.isDesktop && !total) setTimeout(() => { if (!total) close(); }, 3000);
})();
