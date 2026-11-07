// Runs before first paint so the saved look is applied without a flash.
(function () {
  try {
    var t = localStorage.getItem('la.theme');
    if (t && /^(liberty|terminal|glass|daylight)$/.test(t)) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: keep default */ }
})();
