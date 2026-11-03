// Runs before the page paints so the chosen look never flashes.
(function () {
  var skins = ['phosphor', 'amber', 'ice', 'nightred', 'paper'];
  var s = 'phosphor';
  try { var v = localStorage.getItem('ht.skin'); if (skins.indexOf(v) >= 0) s = v; } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute('data-skin', s);
})();
