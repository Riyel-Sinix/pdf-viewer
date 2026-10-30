// 签名：手写（鼠标、触控板、手写笔都行；手写笔有压感时线条有粗细，鼠标按快慢变化）或者打字（文楷 / 英文花体），
// 可以记住几个常用的。插入到页面上是一张透明底的 PNG 图片批注，能拖动、拉角缩放。
import { esc, clamp } from './util.js';
import { icon } from './icons.js';
import { prefs, savePrefs, getSignatures, addSignature, removeSignature } from './store.js';
import { openDialog, closeDialog, dlgHead } from './ui.js';

const INKS = [['#1F1A17', '墨'], ['#22406E', '靛青'], ['#A3302A', '朱']];
const SCALE = 3;              // 导出时放大几倍：插到页面上缩小显示，打印也清楚
const PAD_H = 200;
const FONTS = { han: s => `${s}px "Songs Han","LXGW WenKai",KaiTi,STKaiti,serif`, fell: s => `italic ${s}px "Songs Fell","IM Fell English",Georgia,serif` };

function dataUrlToFile(url, name = '签名.png') {
  const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: 'image/png' });
}

/* ---------- 手写笔迹：每一笔是一串点 { x, y, w }，相邻两点之间用二次曲线连起来，线宽跟着点走 ---------- */
function drawStroke(ctx, pts) {
  if (!pts.length) return;
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2); ctx.fill(); return; }
  let px = pts[0].x, py = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], last = i === pts.length - 1;
    const mx = last ? p.x : (p.x + pts[i + 1].x) / 2, my = last ? p.y : (p.y + pts[i + 1].y) / 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(p.x, p.y, mx, my);
    ctx.lineWidth = p.w;
    ctx.stroke();
    px = mx; py = my;
  }
}
function strokesBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p.x - p.w); y0 = Math.min(y0, p.y - p.w); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.w); }
  return { x0, y0, x1, y1 };
}

// 返回 { file, aspect }（aspect = 高 / 宽），取消返回 null
export async function signatureDialog() {
  let result = null;
  const saved = getSignatures();
  let mode = saved.length ? 'saved' : 'draw', color = INKS[0][0], font = 'han';
  const strokes = [];
  let ro = null;
  const v = await openDialog({
    cls: 'signdlg',
    html: `${dlgHead('签名', { k: 'Sign Thy Name', sub: '写好或者打好字，插入后可以拖动位置、拉四角调大小' })}
      <div class="seg sgseg"><button data-m="draw">手写</button><button data-m="type">打字</button><button data-m="saved"${saved.length ? '' : ' hidden'}>存着的（${saved.length}）</button></div>
      <div class="sgpane" data-p="draw"><div class="sgpad"><canvas id="sgCv"></canvas><span class="sgline"></span><span class="sghint">在这里写下名字</span></div></div>
      <div class="sgpane" data-p="type" hidden>
        <div class="sgtype"><input id="sgText" placeholder="输入名字" maxlength="40" autocomplete="off" spellcheck="false">
          <span class="seg sgfont"><button data-f="han" class="on">楷体</button><button data-f="fell">英文花体</button></span></div>
        <div class="sgpad"><canvas id="sgTc"></canvas><span class="sgline"></span></div></div>
      <div class="sgpane" data-p="saved" hidden><div class="sglist" id="sgList"></div></div>
      <div class="sgbar" id="sgBar"><span class="sginks">${INKS.map(([c, n], i) => `<button class="swc${i ? '' : ' on'}" style="--c:${c}" data-c="${c}" title="${n}"></button>`).join('')}</span>
        <span style="flex:1"></span><button class="lnk" id="sgUndo">撤销一笔</button><button class="lnk" id="sgClear">全部擦掉</button></div>
      <div class="dlg-f"><label class="chk" id="sgKeepL"><input type="checkbox" id="sgKeep"${prefs.signRemember ? ' checked' : ''}>记住这个签名（只存在这台电脑上）</label>
        <span style="flex:1"></span><button class="btn ghost" data-dlg="">取消</button><button class="btn" id="sgOk" disabled>${icon('sign', 18)}插入签名</button></div>`,
    onOpen(d) {
      const q = s => d.querySelector(s);
      const cv = q('#sgCv'), tc = q('#sgTc'), ok = q('#sgOk'), txt = q('#sgText');
      const dpr = Math.min(3, devicePixelRatio || 1);
      let W = 0;
      // 画布像素尺寸跟着签名板的实际宽度走。新建的 canvas 默认就是 300×150，所以不能拿 width 是不是 0 来判断量没量过
      const fit = c => {
        const w = c.parentElement.clientWidth;
        if (!w) return false;               // 那一页现在藏着，等显示出来再量
        W = w;
        if (+c.dataset.w === w) return false;
        c.dataset.w = w;
        c.width = Math.round(w * dpr);
        c.height = Math.round(PAD_H * dpr);
        return true;
      };
      const ctxOf = c => { const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.lineCap = 'round'; x.lineJoin = 'round'; return x; };
      const redraw = () => {
        fit(cv);
        const x = ctxOf(cv);
        x.clearRect(0, 0, cv.width, cv.height);
        x.strokeStyle = x.fillStyle = color;
        strokes.forEach(s => drawStroke(x, s));
        q('.sghint').hidden = strokes.length > 0;
      };
      const typed = () => {
        fit(tc);
        const x = ctxOf(tc), t = txt.value.trim();
        x.clearRect(0, 0, tc.width, tc.height);
        if (!t) return;
        let fs = 64;
        x.font = FONTS[font](fs);
        const w = x.measureText(t).width;
        if (w > W - 40) { fs = Math.max(20, fs * (W - 40) / w); x.font = FONTS[font](fs); }
        x.fillStyle = color;
        x.textAlign = 'center';
        x.textBaseline = 'alphabetic';
        x.fillText(t, W / 2, PAD_H * 0.68);
      };
      const sync = () => {
        d.querySelectorAll('.sgseg button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
        d.querySelectorAll('.sgpane').forEach(p => { p.hidden = p.dataset.p !== mode; });
        q('#sgBar').hidden = mode === 'saved';
        q('#sgUndo').hidden = q('#sgClear').hidden = mode !== 'draw';
        q('#sgKeepL').hidden = mode === 'saved';
        ok.hidden = mode === 'saved';
        ok.disabled = mode === 'draw' ? !strokes.length : !txt.value.trim();
      };
      const setMode = m => {
        mode = m;
        sync();
        if (m === 'draw') redraw();
        if (m === 'type') { typed(); txt.focus(); }
      };
      d.querySelector('.sgseg').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
      d.querySelector('.sgfont').addEventListener('click', e => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        font = b.dataset.f;
        d.querySelectorAll('.sgfont button').forEach(x => x.classList.toggle('on', x === b));
        document.fonts.load(FONTS[font](64)).finally(typed);
      });
      q('.sginks').addEventListener('click', e => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        color = b.dataset.c;
        d.querySelectorAll('.sginks .swc').forEach(x => x.classList.toggle('on', x === b));
        redraw();
        typed();
      });
      q('#sgUndo').addEventListener('click', () => { strokes.pop(); redraw(); sync(); });
      q('#sgClear').addEventListener('click', () => { strokes.length = 0; redraw(); sync(); });
      txt.addEventListener('input', () => { typed(); sync(); });
      txt.addEventListener('keydown', e => { if (e.key === 'Enter' && txt.value.trim()) { e.preventDefault(); ok.click(); } });
      document.fonts.load(FONTS.han(64)).then(() => { if (mode === 'type') typed(); });

      // 手写：压感笔用压力，鼠标 / 手指按快慢（写得快线条细一点），再做一点平滑
      let cur = null, lastT = 0;
      const BASE = 2.6;
      const point = (e, prev) => {
        const r = cv.getBoundingClientRect(), x = clamp(e.clientX - r.left, 0, r.width), y = clamp(e.clientY - r.top, 0, r.height);
        let w;
        if (e.pointerType === 'pen' && e.pressure > 0) w = BASE * (0.35 + 1.25 * e.pressure);
        else if (prev) {
          const dt = Math.max(1, e.timeStamp - lastT), vel = Math.hypot(x - prev.x, y - prev.y) / dt;
          w = prev.w * 0.6 + BASE * clamp(1.55 - 0.6 * vel, 0.5, 1.55) * 0.4;
        } else w = BASE * 1.1;
        lastT = e.timeStamp;
        return { x, y, w };
      };
      cv.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch {}
        cur = [point(e, null)];
        strokes.push(cur);
        redraw();
      });
      cv.addEventListener('pointermove', e => {
        if (!cur) return;
        const evs = e.getCoalescedEvents?.();       // 不可信事件会给空数组
        for (const ev of evs?.length ? evs : [e]) {
          const p = point(ev, cur[cur.length - 1]);
          if (Math.hypot(p.x - cur[cur.length - 1].x, p.y - cur[cur.length - 1].y) >= 0.8) cur.push(p);
        }
        redraw();
      });
      const end = () => { if (!cur) return; cur = null; sync(); };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);

      // 存着的签名：点一下就用
      const list = q('#sgList');
      const renderList = () => {
        const all = getSignatures();
        list.innerHTML = all.length ? all.map(s => `<div class="sgitem" data-u="${esc(s.url)}"><img src="${esc(s.url)}" alt="签名"><button class="x" title="不再保存这个签名">${icon('close', 13, 2)}</button></div>`).join('')
          : '<div class="sub">还没有存着的签名</div>';
        q('.sgseg [data-m=saved]').textContent = `存着的（${all.length}）`;
      };
      renderList();
      list.addEventListener('click', e => {
        const it = e.target.closest('.sgitem');
        if (!it) return;
        const s = getSignatures().find(x => x.url === it.dataset.u);
        if (!s) return;
        if (e.target.closest('.x')) { removeSignature(s.url); renderList(); if (!getSignatures().length) setMode('draw'); return; }
        addSignature(s);                     // 挪到最前面
        result = { file: dataUrlToFile(s.url), aspect: s.h / s.w };
        closeDialog('ok');
      });

      ok.addEventListener('click', async () => {
        const keep = q('#sgKeep').checked;
        prefs.signRemember = keep;
        savePrefs();
        let out;
        if (mode === 'draw') {
          if (!strokes.length) return;
          const b = strokesBox(strokes), pad = 4, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
          out = document.createElement('canvas');
          out.width = Math.ceil(w * SCALE);
          out.height = Math.ceil(h * SCALE);
          const x = out.getContext('2d');
          x.setTransform(SCALE, 0, 0, SCALE, (pad - b.x0) * SCALE, (pad - b.y0) * SCALE);
          x.lineCap = 'round';
          x.lineJoin = 'round';
          x.strokeStyle = x.fillStyle = color;
          strokes.forEach(s => drawStroke(x, s));
        } else {
          const t = txt.value.trim();
          if (!t) return;
          await document.fonts.load(FONTS[font](64)).catch(() => {});
          const fs = 64, m = document.createElement('canvas').getContext('2d');
          m.font = FONTS[font](fs);
          const mt = m.measureText(t), asc = mt.actualBoundingBoxAscent || fs * 0.8, desc = mt.actualBoundingBoxDescent || fs * 0.25;
          const left = mt.actualBoundingBoxLeft || 0, w = (mt.actualBoundingBoxRight || mt.width) + left + 8, h = asc + desc + 8;
          out = document.createElement('canvas');
          out.width = Math.ceil(w * SCALE);
          out.height = Math.ceil(h * SCALE);
          const x = out.getContext('2d');
          x.setTransform(SCALE, 0, 0, SCALE, 0, 0);
          x.font = FONTS[font](fs);
          x.fillStyle = color;
          x.textBaseline = 'alphabetic';
          x.fillText(t, 4 + left, 4 + asc);
        }
        const url = out.toDataURL('image/png');
        if (keep) addSignature({ url, w: out.width, h: out.height });
        result = { file: dataUrlToFile(url), aspect: out.height / out.width };
        out.width = out.height = 0;
        closeDialog('ok');
      });
      // 窗口大小变了签名板会跟着变宽变窄，重新量一下再画（笔迹存的是 CSS 像素坐标，不用换算）
      ro = new ResizeObserver(() => { if (mode === 'draw') redraw(); else if (mode === 'type') typed(); });
      ro.observe(cv.parentElement);
      ro.observe(tc.parentElement);
      setMode(mode);
    },
    onClose: () => ro?.disconnect(),
  });
  return v === 'ok' ? result : null;
}
