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

// Carries campaign tags (?utm_source=linkedin...) from this page onto the
// links to the app, so the app can record which campaign a signup came from.
// Without tags, passes on the site that sent the visitor here (ref=...), which
// the app would otherwise only see as fieldcompass.org.
(function () {
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'];
  var params = new URLSearchParams(window.location.search);
  var forward = new URLSearchParams();
  KEYS.forEach(function (key) {
    var value = params.get(key);
    if (value) forward.set(key, value);
  });
  if (!forward.toString() && document.referrer) {
    try {
      var host = new URL(document.referrer).hostname;
      if (host && host !== window.location.hostname) forward.set('ref', host);
    } catch (e) {
      // A malformed referrer: nothing to pass on.
    }
  }
  if (!forward.toString()) return;
  var links = document.querySelectorAll('a[href^="https://app."]');
  Array.prototype.forEach.call(links, function (link) {
    var url = new URL(link.href);
    forward.forEach(function (value, key) {
      url.searchParams.set(key, value);
    });
    link.href = url.toString();
  });
})();
