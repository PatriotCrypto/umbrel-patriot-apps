/* Applies the saved look before the page paints. */
(function () {
  var look = 'studio';
  try { look = localStorage.getItem('sn.look') || 'studio'; } catch (e) {}
  if (['studio', 'analog', 'legalpad', 'midnight'].indexOf(look) < 0) look = 'studio';
  document.documentElement.setAttribute('data-look', look);
})();
