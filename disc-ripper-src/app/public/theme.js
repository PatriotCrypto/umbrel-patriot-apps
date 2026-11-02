(function () {
  var t = 'auto', k = 'modern';
  try { t = localStorage.getItem('ag.theme') || 'auto'; k = localStorage.getItem('ag.skin') || 'modern'; } catch (e) {}
  var h = document.documentElement;
  h.setAttribute('data-theme', t);
  h.setAttribute('data-skin', k);
  document.getElementById('cssModern').disabled = k === 'classic';
  document.getElementById('cssClassic').disabled = k !== 'classic';
})();
