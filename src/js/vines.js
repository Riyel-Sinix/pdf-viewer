/* 页边藤蔓（布莱克《天真与经验之歌》式：天真是花叶卷须，经验是荆棘、浆果与火焰），从课表站移植。
 * 两根藤沿窗口左右边缘往上长，到顶部弯成拱，拱顶上坐着 Claude Code 的像素小螃蟹 Clawd。
 * 拱顶压在标题栏下沿（不挡标签页和窗口按钮），阅读时地面的草 / 火焰收起来。 */
import { getTheme } from './store.js';

/* Clawd：
 *    ▐▛███▜▌
 *   ▝▜█████▛▘
 *     ▘▘ ▝▝
 * 每个字符是 2×2 的方块像素，终端字符格高约为宽的两倍，所以像素画成 p × 2p。 */
const CLAWD_ROWS = [
  '...############...',
  '...##.######.##...',
  '.################.',
  '...############...',
  '....#.#....#.#....',
];
function clawdSVG(cx, footY, p, delay) {
  const x0 = cx - 9 * p, y0 = footY - 10 * p, rects = [];
  CLAWD_ROWS.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      let e = c;
      while (row[e + 1] === '#') e++;
      rects.push(`<rect x="${(x0 + c * p).toFixed(1)}" y="${(y0 + r * 2 * p).toFixed(1)}" width="${((e - c + 1) * p).toFixed(1)}" height="${(2 * p).toFixed(1)}"/>`);
      c = e;
    }
  });
  const lid = c => `<rect class="lid" x="${(x0 + c * p).toFixed(1)}" y="${(y0 + 2 * p).toFixed(1)}" width="${p.toFixed(1)}" height="${(2 * p).toFixed(1)}"/>`;
  return `<g class="clawd bud" style="--d:${delay}" fill="#D77757" shape-rendering="crispEdges"><title>Claude</title>${rects.join('')}${lid(5)}${lid(12)}</g>`;
}

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function createVines(svg, box) {
  let growNext = true, lastKey = '';
  function draw() {
    const W = box.clientWidth, H = box.clientHeight;
    if (W < 10 || H < 10) return;
    const dark = getTheme() === 'dark';
    const key = W + 'x' + H + dark;
    if (key === lastKey && !growNext) return;
    lastKey = key;
    const f = n => n.toFixed(1), rand = rng(23);
    const k = W < 900 ? .75 : 1, base = 9, topY = 104, archY = 49, cp = W < 900 ? 2.6 : 3;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const stems = [];
    for (const side of [0, 1]) {
      const pts = [];
      for (let y = H - 18; y > topY; y -= 24) {
        const x = base + 5 * k * Math.sin(y / 60 + side * 2.1) + 2 * k * Math.sin(y / 19 + side);
        pts.push([side ? W - x : x, y]);
      }
      pts.push([side ? W - base : base, topY]);
      let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
      }
      const sx = side ? W - base : base;
      d += `C${f(sx)} ${f(topY - 52)} ${f(W / 2 + (side ? 1 : -1) * W * .24)} ${f(archY - 5)} ${f(W / 2 + (side ? -14 : 14))} ${f(archY)}`;
      stems.push(d);
    }
    svg.innerHTML = stems.map(d => `<path d="${d}"/>`).join('');
    const paths = [...svg.querySelectorAll('path')], lens = paths.map(p => p.getTotalLength());
    const feats = [];
    paths.forEach((p, side) => {
      const L = lens[side];
      const at = s => { const a = p.getPointAtLength(s), b = p.getPointAtLength(Math.min(L, s + 1)); return { x: a.x, y: a.y, ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
      let n = 0;
      for (let s = 20; s < L - 20; s += (dark ? 26 : 30) * k + rand() * 9) {
        const pt = at(s), sg = (n++ % 2 ? 1 : -1) * (side ? -1 : 1), delay = s / L * 1900, deg = pt.ang * 180 / Math.PI;
        if (dark) {
          const tl = (deg + sg * 70) * Math.PI / 180, bx = Math.cos(pt.ang) * 2.4 * k, by = Math.sin(pt.ang) * 2.4 * k;
          feats.push(`<path class="bud" style="--d:${delay | 0}" d="M${f(pt.x - bx)} ${f(pt.y - by)}L${f(pt.x + Math.cos(tl) * 7 * k)} ${f(pt.y + Math.sin(tl) * 7 * k)}L${f(pt.x + bx)} ${f(pt.y + by)}Z" fill="var(--vine)"/>`);
          if (n % 3 === 0) feats.push(`<path class="bud" style="--d:${delay | 0}" transform="translate(${f(pt.x)} ${f(pt.y)}) rotate(${f(deg - sg * 50)}) scale(${f((11 + rand() * 5) / 17 * k)})" d="M0 0C5-4 12-4 17 0C12 4 5 4 0 0Z" fill="hsl(${95 + rand() * 20 | 0} 20% ${24 + rand() * 8 | 0}%)" stroke="#0E0B09" stroke-width=".6"/>`);
        } else {
          const inward = (side === 0) === (Math.cos((deg - sg * 52) * Math.PI / 180) > 0) && pt.y > topY;
          feats.push(`<path class="bud" style="--d:${delay | 0}" transform="translate(${f(pt.x)} ${f(pt.y)}) rotate(${f(deg - sg * 52)}) scale(${f((12 + rand() * 7) * (inward ? .7 : 1) / 17 * k)})" d="M0 0C5-4.6 12-4.2 17 0C12 4.2 5 4.6 0 0Z" fill="hsl(${76 + rand() * 26 | 0} ${30 + rand() * 12 | 0}% ${42 + rand() * 14 | 0}%)" fill-opacity=".85" stroke="#3A2A1F" stroke-opacity=".55" stroke-width=".6"/>`);
        }
      }
      for (let s = 80 * k, j = 0; s < L - 40; s += 120 * k + rand() * 40, j++) {
        const pt = at(s), delay = s / L * 1900 + 200;
        let nx = Math.cos(pt.ang + Math.PI / 2), ny = Math.sin(pt.ang + Math.PI / 2);
        if ((side === 0 && nx > 0) || (side === 1 && nx < 0)) { nx = -nx; ny = -ny; }
        if (pt.y < topY) { nx = 0; ny = -1; }
        if (j % 2 === 0) {
          const cx = pt.x + nx * 9 * k, cy = pt.y + ny * 9 * k, a0 = Math.atan2(pt.y - cy, pt.x - cx), turn = side ? -1 : 1;
          let d = `M${f(pt.x)} ${f(pt.y)}`;
          for (let t = .08; t <= 1; t += .08) { const a = a0 + turn * t * Math.PI * 2.4, r = 9 * k * (1 - t * .82); d += `L${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`; }
          feats.push(`<path class="bud" style="--d:${delay | 0}" d="${d}" fill="none" stroke="var(--vine)" stroke-width="1" stroke-linecap="round"/>`);
        } else if (dark) {
          const bx = pt.x + nx * 8 * k, by = pt.y + ny * 8 * k;
          feats.push(`<g class="bud" style="--d:${delay | 0}" fill="#B3342A" stroke="#1A0E0B" stroke-width=".6"><circle cx="${f(bx)}" cy="${f(by)}" r="${f(3 * k)}"/><circle cx="${f(bx + 4 * k)}" cy="${f(by + 2.5 * k)}" r="${f(2.4 * k)}"/><circle cx="${f(bx + .5 * k)}" cy="${f(by + 4.6 * k)}" r="${f(2.2 * k)}"/></g>`);
        } else {
          const fx = pt.x + nx * 12 * k, fy = pt.y + ny * 12 * k, col = j % 4 === 1 ? '#E9A0AE' : '#F1D06A';
          let pe = '';
          for (let q = 0; q < 5; q++) pe += `<ellipse cy="${f(-4.6 * k)}" rx="${f(2.9 * k)}" ry="${f(4.4 * k)}" transform="rotate(${q * 72})"/>`;
          feats.push(`<g class="bud" style="--d:${delay | 0}" transform="translate(${f(fx)} ${f(fy)}) rotate(${rand() * 72 | 0})"><g fill="${col}" stroke="#3A2A1F" stroke-opacity=".6" stroke-width=".5">${pe}</g><circle r="${f(2 * k)}" fill="#C9962C"/></g>`);
        }
      }
    });
    // 天上：天真之歌是几只飞鸟，经验之歌是几颗星（都放在标题栏右半边的空处）
    const sky = [];
    if (dark) {
      [[.57, 16], [.62, 31], [.67, 12], [.73, 26], [.79, 14]].forEach(([fx, y], i) => {
        const x = W * fx, r = (i % 2 ? 3.2 : 4.4) * Math.max(k, .7);
        sky.push(`<path class="bud" style="--d:${1500 + i * 90}" d="M${f(x)} ${f(y - r)}L${f(x + r * .3)} ${f(y - r * .3)}L${f(x + r)} ${f(y)}L${f(x + r * .3)} ${f(y + r * .3)}L${f(x)} ${f(y + r)}L${f(x - r * .3)} ${f(y + r * .3)}L${f(x - r)} ${f(y)}L${f(x - r * .3)} ${f(y - r * .3)}Z" fill="#E8BE55"/>`);
      });
    } else {
      [[.62, 26, 1], [.68, 15, .8], [.575, 12, .7]].forEach(([fx, y, s], i) => {
        const x = W * fx, w = 7 * s * Math.max(k, .7);
        sky.push(`<path class="bud" style="--d:${1600 + i * 120}" d="M${f(x - w)} ${f(y)}Q${f(x - w / 2)} ${f(y - w * .7)} ${f(x)} ${f(y)}Q${f(x + w / 2)} ${f(y - w * .7)} ${f(x + w)} ${f(y)}" fill="none" stroke="#3A2A1F" stroke-width="1.2" stroke-linecap="round"/>`);
      });
    }
    // 地面：天真是草叶，经验是一排火焰
    const ground = [], gy = H - 10;
    if (dark) {
      for (let i = 0; i < 13; i++) {
        const x = W * (.1 + .8 * i / 12) + (rand() - .5) * 14, h = (18 + rand() * 22) * k, w = (6 + rand() * 4) * k, ln = (rand() - .5) * 10;
        ground.push(`<path class="bud" style="--d:${1700 + i * 50}" d="M${f(x - w)} ${f(gy)}C${f(x - w)} ${f(gy - h * .5)} ${f(x + ln - 2)} ${f(gy - h * .6)} ${f(x + ln)} ${f(gy - h)}C${f(x + ln + 2)} ${f(gy - h * .55)} ${f(x + w)} ${f(gy - h * .45)} ${f(x + w)} ${f(gy)}Z" fill="url(#flame)" opacity=".8"/>`);
      }
    } else {
      for (let i = 0; i < 26; i++) {
        const x = W * (.06 + .88 * i / 25) + (rand() - .5) * 14, h = (8 + rand() * 12) * k, ln = (rand() - .5) * 10;
        ground.push(`<path class="bud" style="--d:${1700 + i * 25}" d="M${f(x)} ${f(gy)}Q${f(x + ln * .3)} ${f(gy - h * .6)} ${f(x + ln)} ${f(gy - h)}" fill="none" stroke="#6B8A3A" stroke-width="1.2" stroke-linecap="round"/>`);
      }
    }
    svg.innerHTML = '<defs><linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#C8402A"/><stop offset=".6" stop-color="#EE8A3A"/><stop offset="1" stop-color="#F7D47A"/></linearGradient></defs>'
      + `<g class="ground">${ground.join('')}</g>`
      + stems.map((d, i) => `<path class="stem" d="${d}" stroke="var(--vine)" stroke-width="${dark ? 2.3 : 2}" style="stroke-dasharray:${f(lens[i])};--len:${f(lens[i])}"/>`).join('')
      + feats.join('') + sky.join('') + clawdSVG(W / 2, archY + 1, cp, 2300);   // 坐在拱顶上
    svg.classList.toggle('grow', growNext);
    growNext = false;
  }
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }).observe(box);
  return { draw, regrow() { growNext = true; draw(); } };
}
