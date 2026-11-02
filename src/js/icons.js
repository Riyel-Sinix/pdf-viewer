// 线条图标：和课表站同一路子（圆头描边，略带手绘的不规则），颜色跟随 currentColor
const P = {
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><path d="M9.2 4.6c.3 5 .1 9.9 0 14.8"/><path d="M5.4 8.2h1.8M5.4 11h1.8M5.4 13.8h1.8"/>',
  open: '<path d="M3.6 18.6V6.2a1.6 1.6 0 0 1 1.6-1.6h3.9l2 2.3h6.7a1.6 1.6 0 0 1 1.6 1.6v2"/><path d="M3.7 18.7 6.6 11.9a1.6 1.6 0 0 1 1.5-1h12.1a.8.8 0 0 1 .75 1.1l-2.7 6.4a1.6 1.6 0 0 1-1.5 1H4.4a.8.8 0 0 1-.7-.7z"/>',
  book: '<path d="M4 5.4A2.4 2.4 0 0 1 6.4 3H19.6v14.6H6.4A2.4 2.4 0 0 0 4 20z"/><path d="M4 20a2.4 2.4 0 0 0 2.4 2.4h13.2v-4.8"/><path d="M8.6 7.4h6.6M8.6 10.6h4.4"/>',
  bind: '<path d="M4.2 3.6h6.2l2.2 2.2v8.6a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1z"/><path d="M12.6 8.4h1.2l2.2 2.2"/><path d="M13.8 8.4h5.6a1 1 0 0 1 1 1v10.2a1 1 0 0 1-1 1h-7.2a1 1 0 0 1-1-1v-4.2"/><path d="M6 8.2c1.6.6 3 .5 4.4-.2M6 11c1.4.5 2.5.4 3.6-.1M14.6 14.4c1.5.5 2.9.4 4-.2M14.6 17.2c1.2.4 2.2.3 3.2-.1"/>',
  up: '<path d="m17.6 14.6-5.6-5.4-5.6 5.4"/>',
  down: '<path d="m6.4 9.4 5.6 5.4 5.6-5.4"/>',
  left: '<path d="m14.6 6.4-5.4 5.6 5.4 5.6"/>',
  right: '<path d="m9.4 6.4 5.4 5.6-5.4 5.6"/>',
  first: '<path d="M6.2 5.2c-.2 4.6-.1 9.1 0 13.6"/><path d="m17.4 17.6-5.6-5.6 5.6-5.6"/>',
  last: '<path d="M17.8 5.2c.2 4.6.1 9.1 0 13.6"/><path d="m6.6 17.6 5.6-5.6-5.6-5.6"/>',
  zoomOut: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m20.4 20.4-4.9-4.9M7.6 10.7c2-.2 4-.2 6 0"/>',
  zoomIn: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m20.4 20.4-4.9-4.9M7.6 10.7c2-.2 4-.2 6 0M10.6 7.6c.2 2 .2 4 0 6"/>',
  rotCw: '<path d="M19.6 12.6A7.6 7.6 0 1 1 17.3 6.4"/><path d="M19.4 3.8 19.6 8.6l-4.8.3"/>',
  rotCcw: '<path d="M4.4 12.6A7.6 7.6 0 1 0 6.7 6.4"/><path d="M4.6 3.8 4.4 8.6l4.8.3"/>',
  find: '<circle cx="10.4" cy="10.4" r="6.4"/><path d="m20.2 20.2-5.2-5.2"/>',
  print: '<path d="M7 8.8V3.6h10v5.2"/><path d="M6.6 17.2H4.8a1.4 1.4 0 0 1-1.4-1.4v-5.6A1.6 1.6 0 0 1 5 8.6h14a1.6 1.6 0 0 1 1.6 1.6v5.6a1.4 1.4 0 0 1-1.4 1.4h-1.8"/><path d="M7 13.8h10v6.6H7z"/><path d="M17.2 11.4h.01"/>',
  save: '<path d="M12 3.6c.2 3.6.1 7.3 0 10.9"/><path d="m7.6 10.4 4.4 4.4 4.4-4.4"/><path d="M4 15.6v2.8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.8"/>',
  more: '<circle cx="5.6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.4" cy="12" r="1.2" fill="currentColor"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  close: '<path d="M6.4 6.2c3.8 3.7 7.5 7.6 11.2 11.6M17.6 6.2C13.8 9.9 10.1 13.8 6.4 17.8"/>',
  min: '<path d="M5.6 12.4c4.3-.2 8.5-.2 12.8 0"/>',
  max: '<rect x="5.6" y="5.6" width="12.8" height="12.8" rx="1.8"/>',
  restore: '<rect x="5.4" y="8.6" width="10" height="10" rx="1.6"/><path d="M8.6 8.4V6.9a1.4 1.4 0 0 1 1.4-1.4h7.2a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4h-1.6"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11c.2 1.9.2 3.7 0 5.6M12 7.7h.01"/>',
  present: '<rect x="3.4" y="4.4" width="17.2" height="11.2" rx="1.8"/><path d="M12 15.6v4.4M8.4 20.4h7.2"/><path d="m10.4 7.9 4 2.1-4 2.1z" fill="currentColor"/>',
  layout1: '<rect x="7" y="3.4" width="10" height="17.2" rx="1.6"/><path d="M9.6 7.6h4.8M9.6 10.4h4.8M9.6 13.2h3"/>',
  layout2: '<rect x="2.6" y="4.6" width="9" height="14.8" rx="1.3"/><rect x="12.4" y="4.6" width="9" height="14.8" rx="1.3"/>',
  layoutCover: '<rect x="2.6" y="4.6" width="5.6" height="14.8" rx="1.2"/><rect x="9.6" y="4.6" width="5.6" height="14.8" rx="1.2"/><rect x="16" y="4.6" width="5.6" height="14.8" rx="1.2"/>',
  layoutPage: '<rect x="6" y="3.4" width="12" height="15.6" rx="1.6"/><path d="M9 21.2h6"/><path d="m10.6 8.8 3 2.4-3 2.4"/>',
  layoutGrid: '<rect x="3.6" y="3.6" width="7" height="7.6" rx="1.2"/><rect x="13.4" y="3.6" width="7" height="7.6" rx="1.2"/><rect x="3.6" y="13" width="7" height="7.6" rx="1.2"/><rect x="13.4" y="13" width="7" height="7.6" rx="1.2"/>',
  tone: '<path d="M12 3.4c3.2 4 6.2 7.3 6.2 10.8a6.2 6.2 0 0 1-12.4 0c0-3.5 3-6.8 6.2-10.8z"/><path d="M9.4 14.6a2.8 2.8 0 0 0 2.4 2.6"/>',
  folder: '<path d="M3.6 6.8a1.5 1.5 0 0 1 1.5-1.5h4l2 2.4h7.8a1.5 1.5 0 0 1 1.5 1.5v8.6a1.5 1.5 0 0 1-1.5 1.5H5.1a1.5 1.5 0 0 1-1.5-1.5z"/>',
  plus: '<path d="M12 5.4c.2 4.4.2 8.8 0 13.2M5.4 12c4.4-.2 8.8-.2 13.2 0"/>',
  trash: '<path d="M4.6 7h14.8M9.6 7V4.6h4.8V7"/><path d="m6.6 7 .9 12.1a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3L17.4 7"/>',
  grip: '<circle cx="9" cy="6.5" r="1.2" fill="currentColor"/><circle cx="15" cy="6.5" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17.5" r="1.2" fill="currentColor"/><circle cx="15" cy="17.5" r="1.2" fill="currentColor"/>',
  check: '<path d="m5.2 12.6 4.4 4.3 9.2-9.6"/>',
  pages: '<rect x="3.8" y="3.6" width="7" height="7.8" rx="1.1"/><rect x="13.2" y="3.6" width="7" height="7.8" rx="1.1"/><rect x="3.8" y="13" width="7" height="7.4" rx="1.1"/><rect x="13.2" y="13" width="7" height="7.4" rx="1.1"/>',
  alert: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.6c.2 1.8.2 3.6 0 5.4M12 16.2h.01"/>',
  ok: '<circle cx="12" cy="12" r="8.8"/><path d="m8 12.4 2.8 2.8 5.4-5.6"/>',
  lock: '<rect x="5" y="10.4" width="14" height="10" rx="2"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/>',
  copy: '<rect x="8.6" y="8.6" width="11" height="12" rx="1.6"/><path d="M15.4 8.4V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3.4"/>',
  hand: '<path d="M8.6 12.2V5.8a1.4 1.4 0 0 1 2.8 0v5.4M11.4 11V4.4a1.4 1.4 0 0 1 2.8 0V11M14.2 11V5.6a1.4 1.4 0 0 1 2.8 0v7.6"/><path d="M17 9.6a1.4 1.4 0 0 1 2.8 0v4.6a6.6 6.6 0 0 1-6.6 6.6h-1.2a6.4 6.4 0 0 1-4.9-2.3L4.2 14.6a1.4 1.4 0 0 1 2.1-1.9l2.3 2"/>',
  cursor: '<path d="M6 3.6v14.6l4-3.8 2.6 6 2.4-1-2.6-5.9h5.4z"/>',
  fitWidth: '<path d="M3.8 12h16.4M7 8.8 3.8 12 7 15.2M17 8.8l3.2 3.2-3.2 3.2"/>',
  fitPage: '<rect x="5.6" y="3.4" width="12.8" height="17.2" rx="1.6"/><path d="M12 6.6v10.8M9.6 9 12 6.6 14.4 9M9.6 15 12 17.4l2.4-2.4"/>',
  home: '<path d="M4 11.2 12 4l8 7.2"/><path d="M6.2 9.6v9.4a1 1 0 0 0 1 1h3.4v-5.4h2.8V20h3.4a1 1 0 0 0 1-1V9.6"/>',
  drop: '<path d="M12 3.6v10.6"/><path d="m7.4 9.8 4.6 4.6 4.6-4.6"/><path d="M4.4 15.4v2.6a2.4 2.4 0 0 0 2.4 2.4h10.4a2.4 2.4 0 0 0 2.4-2.4v-2.6"/>',
  feather: '<path d="M19.6 4.4C13 4.6 7.6 9 6.6 16.4l-.4 3.2"/><path d="M19.6 4.4c-.6 6.4-4.8 11-11.6 12.4"/><path d="M10.2 11.4h5.2M8.4 14.4h4.8"/>',
  // 编辑
  pen: '<path d="M15.6 3.8c2.3 1 4 2.8 4.6 5.2l-7.4 7.5-5.3 1.5 1.5-5.3z"/><path d="m12.8 16.5-3.6-3.6"/><path d="M3.6 20.6c2.4-.3 4-1 5-2.1"/>',
  marker: '<path d="m14.2 3.8 6 6-8.3 8.4H8.7l-2.4-2.4v-3.3z"/><path d="M8.7 18.2 7 19.9H3.6l2.7-2.7"/><path d="M12.6 20.6c2.6-.2 5.2-.2 7.8 0"/>',
  text: '<path d="M5.2 6.4c4.5-.3 9.1-.3 13.6 0"/><path d="M5.3 6.3v1.6M18.7 6.3v1.6"/><path d="M12 6.4c.2 4.3.2 8.6 0 12.9"/><path d="M9.4 19.3c1.7-.1 3.5-.1 5.2 0"/>',
  image: '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2"/><path d="m4.4 17.6 4.9-5.1 3.4 3.4 2.5-2.5 4.4 4.3"/><circle cx="15.4" cy="9.2" r="1.5"/>',
  sign: '<path d="M3.6 17.2c1.6-.3 2.6-2.7 3.6-5.6.9-2.8 1.9-4.6 2.8-4.2.9.4-.2 3.5-1 6.1-.8 2.6-.8 4 .3 3.7 1.1-.3 2.1-3 3.1-3.4.9-.3.6 2 1.6 2.2 1 .2 1.8-1.4 2.8-1.6 1-.2 1.6.8 2.6.8"/><path d="M3.6 20.6c5.6-.3 11.2-.3 16.8 0"/>',
  undo: '<path d="M8.8 6.2 4.6 10.4l4.2 4.2"/><path d="M5 10.4h8.6a5.4 5.4 0 0 1 0 10.8h-2.8"/>',
  redo: '<path d="m15.2 6.2 4.2 4.2-4.2 4.2"/><path d="M19 10.4h-8.6a5.4 5.4 0 0 0 0 10.8h2.8"/>',
  blank: '<path d="M6 3.6h8.2L18 7.4v13H6z"/><path d="M14 3.8v3.8h3.8"/><path d="M12 10.8c.1 2.1.1 4.2 0 6.3M8.8 14c2.1-.1 4.3-.1 6.4 0"/>',
  addPdf: '<path d="M9.2 7.6V3.6h6l3.8 3.8v13h-9.8v-3.4"/><path d="M15 3.8v3.8h3.8"/><path d="M2.8 12.4c2.9-.2 5.8-.2 8.6 0M8.4 9.2l3.2 3.2-3.2 3.2"/>',
  extract: '<path d="M14.6 10.4V7.4L10.8 3.6h-6v16.8h9.8v-3"/><path d="M10.8 3.8v3.6h3.6"/><path d="M10.6 13.8c3.2-.2 6.4-.2 9.6 0M17.2 10.6l3.2 3.2-3.2 3.2"/>',
  dot: '<circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none"/>',
  // 转成 PDF：左边一张小画，弯箭头，右边一页书
  convert: '<rect x="2.8" y="3.6" width="8.2" height="7.2" rx="1.3"/><path d="m3.6 9.6 2.2-2.3 1.7 1.6 1.2-1 1.5 1.6"/><path d="M14.4 9.6h3.2l2.6 2.6v7.2a1 1 0 0 1-1 1h-4.8a1 1 0 0 1-1-1v-8.8a1 1 0 0 1 1-1z"/><path d="M15.8 15.2h2.8M15.8 17.6h1.8"/><path d="M5.6 13.6c.2 3.4 2.2 5.2 5.6 5.4"/><path d="m9.4 17.2 1.9 1.8-1.9 1.9"/>',
};

export function icon(name, size = 18, sw = 1.75) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// 课表站的花体分隔线
export const FLOURISH = '<svg class="fl" viewBox="0 0 300 30" aria-hidden="true"><path d="M6 16C40 4 74 26 112 14 128 9 136 2 146 6c8 3 6 13-2 12-7-1-5-10 3-11 14-2 20 12 38 12 30 0 56-16 110-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
// 工具栏分组之间的小枝
export const SPRIG = '<svg class="sep" viewBox="0 0 14 26" aria-hidden="true"><path d="M7 2.5C5.2 8 8.8 11.5 7 17s.4 5.5.2 6.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M7.1 9.2C9.6 7.6 11.8 7.9 12.6 8.6 11 10.2 9 10.4 7.1 9.2z" fill="currentColor" opacity=".8"/><path d="M6.9 15.4C4.6 13.8 2.4 14 1.6 14.8c1.6 1.6 3.4 1.8 5.3.6z" fill="currentColor" opacity=".7"/></svg>';
