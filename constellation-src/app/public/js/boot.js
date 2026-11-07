// Runs before first paint so the saved look is applied without a flash.
(function () {
  try {
    var t = localStorage.getItem('cs.theme');
    if (t && /^(orbit|glass|daylight|mission|mars|polar)$/.test(t)) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: keep default */ }
})();
