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
    // Admin-only chips (logs, users): revealed ONLY when an admin endpoint
    // answers 200 — i.e. the operator's own session (local, or their Access
    // email on the admin list). A worker's session gets 403 there, so workers
    // never see the admin links at all; on the public Pages/demo deploy there
    // is no server and nothing fires.
    fetch(base + '/api/admin/users').then(function (r) {
      if (!r.ok) return;
      var showAdmin = function () { ['nav-logs', 'nav-trends', 'nav-users'].forEach(function (id) { var lk = document.getElementById(id); if (lk) lk.style.display = 'inline-block'; }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showAdmin);
      else showAdmin();
    }).catch(function () {});
    var n = c && c.archiveName; if (!n) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(n); });
    else apply(n);
  }).catch(function () {});
})();
