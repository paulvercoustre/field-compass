// Adds a hairline border under the nav once the page scrolls.
// Kept in its own file so the site's CSP can stay `script-src 'self'`.
(function () {
  var nav = document.getElementById('nav');
  if (!nav) return;
  var apply = function () {
    nav.dataset.scrolled = window.scrollY > 8 ? 'true' : 'false';
  };
  apply();
  window.addEventListener('scroll', apply, { passive: true });
})();
