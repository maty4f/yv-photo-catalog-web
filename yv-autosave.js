/* yv-autosave.js — save-in-progress guard for the cataloging dashboards.
 *
 * The archivist edits a catalog's fields for minutes before copying to Sapir; a
 * refresh or crash used to lose that work. This script periodically snapshots
 * every form field to localStorage (keeping the last few versions), offers a
 * non-intrusive "restore last draft" button on load, and mirrors a backup to the
 * server so the operator has an off-browser copy too.
 *
 * Generic by design: it walks the DOM for input/textarea/select/[contenteditable]
 * with an id, so it works on any dashboard without per-page wiring. Secrets are
 * never saved (password/file inputs and any id containing key/password/token/pw).
 */
(function () {
  'use strict';
  var PAGE = location.pathname.replace(/[^\w.-]+/g, '_') || 'root';
  var KEY = 'yv_autosave_' + PAGE;
  var VERKEY = KEY + '_versions';
  var MAX_VERSIONS = 5;
  var SAVE_DEBOUNCE_MS = 1500;
  var BACKUP_EVERY_MS = 60000;
  var SECRET_RE = /key|password|token|pw\b|secret/i;

  function fields() {
    return Array.prototype.slice.call(
      document.querySelectorAll('input[id], textarea[id], select[id], [contenteditable][id]'));
  }
  function isSecret(el) {
    return el.type === 'password' || el.type === 'file' || SECRET_RE.test(el.id || '');
  }
  function readVal(el) {
    if (el.isContentEditable) return el.innerHTML;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '';
    return el.value;
  }
  function writeVal(el, v) {
    if (el.isContentEditable) { el.innerHTML = v; return; }
    if (el.type === 'checkbox' || el.type === 'radio') { el.checked = v === '1'; return; }
    el.value = v;
  }
  function snapshot() {
    var data = {};
    fields().forEach(function (el) {
      if (isSecret(el)) return;
      var v = readVal(el);
      if (v != null && String(v).trim() !== '') data[el.id] = v;
    });
    return data;
  }
  function nonEmpty(data) { for (var k in data) if (data.hasOwnProperty(k)) return true; return false; }

  function save() {
    try {
      var data = snapshot();
      if (!nonEmpty(data)) return;
      var rec = { ts: Date.now(), page: PAGE, data: data };
      localStorage.setItem(KEY, JSON.stringify(rec));
      var vers = [];
      try { vers = JSON.parse(localStorage.getItem(VERKEY) || '[]'); } catch (e) {}
      vers.unshift({ ts: rec.ts, data: data });
      if (vers.length > MAX_VERSIONS) vers = vers.slice(0, MAX_VERSIONS);
      localStorage.setItem(VERKEY, JSON.stringify(vers));
    } catch (e) { /* quota/serialization — never break the page */ }
  }

  function restore(data) {
    var restored = 0;
    fields().forEach(function (el) {
      if (isSecret(el)) return;
      if (Object.prototype.hasOwnProperty.call(data, el.id)) {
        writeVal(el, data[el.id]);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        restored++;
      }
    });
    return restored;
  }

  function fmtAge(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'לפני ' + s + ' שניות';
    if (s < 3600) return 'לפני ' + Math.round(s / 60) + ' דקות';
    return new Date(ts).toLocaleString('he-IL');
  }

  function offerRestore() {
    var raw = localStorage.getItem(KEY);
    if (!raw) return;
    var rec; try { rec = JSON.parse(raw); } catch (e) { return; }
    if (!rec || !nonEmpty(rec.data)) return;

    var bar = document.createElement('div');
    bar.setAttribute('dir', 'rtl');
    bar.style.cssText = 'position:fixed;bottom:14px;inset-inline-start:14px;z-index:99999;' +
      'background:#2c5d3a;color:#fff;padding:10px 14px;border-radius:10px;font:14px -apple-system,Arial;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.25);direction:rtl;text-align:right;max-width:320px;';
    bar.innerHTML = '💾 יש טיוטה שמורה (' + fmtAge(rec.ts) + '). ' +
      '<button id="yv-as-restore" style="margin-inline-start:8px;background:#fff;color:#2c5d3a;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:bold;">שחזר</button>' +
      '<button id="yv-as-dismiss" style="margin-inline-start:6px;background:transparent;color:#cfe6d6;border:0;cursor:pointer;">התעלם</button>';
    document.body.appendChild(bar);
    document.getElementById('yv-as-restore').onclick = function () {
      var n = restore(rec.data);
      bar.innerHTML = '✓ שוחזרו ' + n + ' שדות';
      setTimeout(function () { bar.remove(); }, 2500);
    };
    document.getElementById('yv-as-dismiss').onclick = function () { bar.remove(); };
    setTimeout(function () { if (bar.parentNode) bar.style.opacity = '0.55'; }, 12000);
  }

  // Debounced local save on any edit + a periodic tick.
  var t = null;
  function scheduleSave() { clearTimeout(t); t = setTimeout(save, SAVE_DEBOUNCE_MS); }
  document.addEventListener('input', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  setInterval(save, 15000);

  // Server-side backup (off-browser copy for the operator). Best-effort; only
  // posts when there's something and the content changed since the last backup.
  var lastBackup = '';
  function backup() {
    try {
      var data = snapshot();
      if (!nonEmpty(data)) return;
      var body = JSON.stringify({ page: PAGE, ts: Date.now(), data: data });
      if (body === lastBackup) return;
      lastBackup = body;
      if (navigator.sendBeacon) navigator.sendBeacon('/api/autosave', new Blob([body], { type: 'application/json' }));
      else fetch('/api/autosave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  setInterval(backup, BACKUP_EVERY_MS);
  window.addEventListener('beforeunload', function () { save(); backup(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', offerRestore);
  else offerRestore();
})();
