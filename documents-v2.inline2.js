/* White-label: one server env (YV_ARCHIVE_NAME) sets the archive name shown here. Empty = generic. */
(function () {
  function apply(name) {
    if (!name) return;
    window.ARCHIVE_NAME = name;
    if (document.title.indexOf(name) === -1) document.title += ' — ' + name;
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent.indexOf(name) === -1) h1.appendChild(document.createTextNode(' — ' + name));
    var r = document.getElementById('r-rights');
    if (r && (!r.value || r.value === 'הארכיון')) r.value = name;
  }
  var base = '';
  try { if (typeof serverBase === 'function') base = serverBase(); } catch (e) {}
  fetch(base + '/api/config').then(function (r) { return r.json(); }).then(function (c) {
    // Managed Gemini key (system review 2026-07-21 #14): this screen never read
    // the flag, so the owner saw an empty/stale personal-key field — exactly
    // the regression the managed-key feature exists to prevent.
    if (c && c.geminiKeyManaged) {
      window.YV_GEMINI_MANAGED = true;
      try { localStorage.removeItem('yv_api_key_gemini'); } catch (e) {}
      try { if (typeof state === 'object' && state && 'apiKey' in state) state.apiKey = 'server-managed'; } catch (e) {}
      var _k = document.getElementById('api-key');
      if (_k) {
        var _row = _k.closest('.provider-row') || _k.closest('label') || _k.parentElement;
        if (_row) _row.style.display = 'none';
      }
    }
    var n = c && c.archiveName; if (!n) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(n); });
    else apply(n);
  }).catch(function () {});
})();
