// Applied before first paint so the chosen look never flashes.
(function () {
  try {
    var s = localStorage.getItem('sk.skin');
    if (['cyberdeck', 'terminal', 'battlefield', 'nightred', 'princess', 'machine'].indexOf(s) >= 0) document.documentElement.setAttribute('data-skin', s);
  } catch (e) {}
})();
