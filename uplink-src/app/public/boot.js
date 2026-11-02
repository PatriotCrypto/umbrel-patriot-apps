// applies the saved look before the page draws, so it never flashes the wrong theme
(function () { var k = 'cyber'; try { k = localStorage.getItem('ul.skin') || 'cyber'; } catch (e) {} document.documentElement.setAttribute('data-skin', k); })();
