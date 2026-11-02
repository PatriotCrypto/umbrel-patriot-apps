// Apply the saved look before first paint so there is no flash.
(function () {
  try {
    var s = localStorage.getItem('rp.skin');
    if (s && /^(bunker|nightred|homestead|blueprint)$/.test(s)) document.documentElement.setAttribute('data-skin', s);
  } catch (e) { /* storage unavailable */ }
})();
