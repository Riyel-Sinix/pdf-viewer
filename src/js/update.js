// 新版本提示（桌面版）：启动后过一会儿问一下 GitHub 上最新发布的版本（一天最多一次），比现在的新就弹个提示——
// 「去下载」打开发布页面；「跳过这一版」以后不再为这一版提醒；「以后再说」明天再提醒。⋯ 菜单里「检查更新」随时手动查。
// 只读公开的发布信息（api.github.com，CSP 里放行了），不下载、不安装任何东西；连不上网就悄悄算了（手动查时才提示）
import { store } from './store.js';
import * as platform from './platform.js';
import { toast } from './ui.js';

const REPO = 'Riyel-Sinix/pdf-viewer';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/latest`;
const EVERY = 20 * 3600e3;            // 自动检查的间隔：差不多一天一次
const DELAY = 6000;                   // 启动后等一会儿再查，不跟打开文件抢

// 'v1.4.2' → [1, 4, 2]；认不出来返回 null
const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : null; };
export function newer(a, b) {           // a 比 b 新？
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

let current = null;
async function currentVersion() { return (current ??= (await platform.appInfo())?.version || null); }

async function latest() {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(API, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub 返回 ${r.status}`);
    const d = await r.json();
    if (!parse(d.tag_name)) throw new Error('没认出版本号');
    return { version: d.tag_name.replace(/^v/, ''), url: /^https:\/\/github\.com\//.test(d.html_url) ? d.html_url : PAGE };
  } finally { clearTimeout(t); }
}

let shown = null;
function offer(rel, cur) {
  shown?.close();
  shown = toast(`有新版本 ${rel.version} 了（你现在用的是 ${cur}）`, {
    kind: 'ok', ms: 0,
    actions: [
      { label: '去下载', fn: () => platform.openExternal(rel.url) },
      { label: '跳过这一版', fn: () => store.set('updateSkip', rel.version) },
      { label: '以后再说', fn: () => {} },
    ],
  });
}

// 手动检查（⋯ 菜单）：每种结果都说一声；跳过过的版本也照样提示
export async function checkNow() {
  const cur = await currentVersion();
  if (!cur) return;
  const wait = toast('正在检查新版本…', { ms: 0 });
  try {
    const rel = await latest();
    store.set('updateChecked', Date.now());
    wait.close();
    if (newer(rel.version, cur)) offer(rel, cur);
    else toast(`已经是最新版本（${cur}）`, { kind: 'ok' });
  } catch (e) {
    wait.close();
    toast(`检查不了新版本：${e?.name === 'AbortError' ? '连不上 GitHub' : e?.message || e}`, { kind: 'err', ms: 6000, actions: [{ label: '打开发布页面', fn: () => platform.openExternal(PAGE) }] });
  }
}

// 启动时：一天最多查一次；自动化测试时不查（不联网、不弹提示）
export function checkLater() {
  if (!platform.isDesktop) return;
  setTimeout(async () => {
    try {
      const info = await platform.appInfo();
      if (!info || info.test) return;
      current = info.version;
      if (Date.now() - store.get('updateChecked', 0) < EVERY) return;
      const rel = await latest();
      store.set('updateChecked', Date.now());
      if (newer(rel.version, current) && store.get('updateSkip', '') !== rel.version) offer(rel, current);
    } catch (e) { console.info('没查到新版本：', e?.message || e); }
  }, DELAY);
}
