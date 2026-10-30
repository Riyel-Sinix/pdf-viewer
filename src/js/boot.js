// 在页面绘制之前定好主题（跟随上次的选择，没选过就跟随系统），避免一闪
(function () {
  var t = null;
  try { t = localStorage.getItem('pv.theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  var de = document.documentElement;
  de.dataset.theme = t;
  if (window.__TAURI_INTERNALS__) de.classList.add('desktop');
})();
