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
    // Section-2 security: when the server manages the Gemini key (injected by
    // the proxy), the browser must not hold one. Purge any stored key, hide the
    // field, and use an in-memory sentinel so existing key-gates still pass —
    // the server overrides x-goog-api-key, so this value never reaches Google
    // and nothing is persisted client-side. No-op if the server has no key.
    if (c && c.geminiKeyManaged) {
      window.YV_GEMINI_MANAGED = true;   // owner: proxy injects the key — never prompt for one
      try { localStorage.removeItem('yv_api_key_gemini'); } catch (e) {}
      try {
        if (typeof state === 'object' && state) {
          if (state.apiKeys) state.apiKeys.gemini = 'server-managed';
          if ('keyGemini' in state) state.keyGemini = 'server-managed';
        }
      } catch (e) {}
      var _gk = document.getElementById('api-key-gemini') || document.getElementById('key-gemini');
      if (_gk) {
        _gk.value = '';
        var _row = _gk.closest('.row, .field, label') || _gk.parentElement;
        if (_row) _row.style.display = 'none';
      }
      try { if (typeof refreshButtons === 'function') refreshButtons(); } catch (e) {}
      try { if (typeof syncEngineUI === 'function') syncEngineUI(); } catch (e) {}
    }
    var n = c && c.archiveName; if (!n) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(n); });
    else apply(n);
  }).catch(function () {});
})();
