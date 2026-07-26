/* yv-editcapture.js — capture the archivist's hand-edits to the model's output.
 *
 * Replaces the autosave-diff capture that was removed on 2026-07-26. Instead of
 * snapshotting whole forms on a timer and diffing them later, this records the
 * ONE thing the learning loop actually needs: a field the archivist changed,
 * with the model's value before her edit and hers after it.
 *
 * Capture point: focus → change. On focusin we remember what the field holds;
 * on change/focusout, if it differs, one edit event is POSTed. That is exactly
 * the moment the value became hers, it needs no per-screen wiring, and it never
 * fires for a field she only read.
 *
 * Scope: the r-* result fields (r-title-he, r-summary-en…) — the model's output.
 * Intake fields she fills in herself (photo id, donor) are not "corrections" and
 * are skipped, as are secret fields.
 *
 * Nothing here decides anything. The events land in the `edit` log stream and
 * wait for the operator in edits.html — no rule reaches the prompts without an
 * explicit human approval (owner decision, 2026-07-26).
 */
(function () {
  'use strict';
  var SECRET_RE = /key|password|token|pw\b|secret/i;
  var MAX_LEN = 4000;
  var pending = Object.create(null);   // field id → value at focus time

  function screenName() {
    return (location.pathname.replace(/^.*\//, '').replace(/\.html$/, '') || 'index');
  }
  function isResultField(el) {
    if (!el || !el.id || el.id.indexOf('r-') !== 0) return false;
    if (el.type === 'password' || el.type === 'file' || SECRET_RE.test(el.id)) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }
  function readVal(el) {
    if (el.isContentEditable) return el.innerText || '';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '';
    return el.value == null ? '' : String(el.value);
  }
  // The record this edit belongs to, so the review screen can show context and
  // so recurrence can be counted per RECORD (one session editing one title 20
  // times is one correction, not twenty).
  function itemId() {
    var ids = ['r-photo-id', 'r-archive-id', 'r-source-file', 'r-title-he'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) { var v = readVal(el).trim(); if (v) return v.slice(0, 200); }
    }
    return '';
  }

  document.addEventListener('focusin', function (ev) {
    var el = ev.target;
    if (isResultField(el)) pending[el.id] = readVal(el);
  }, true);

  function maybeSend(el) {
    if (!isResultField(el)) return;
    if (!Object.prototype.hasOwnProperty.call(pending, el.id)) return;
    var before = pending[el.id];
    var after = readVal(el);
    if (after === before) return;
    pending[el.id] = after;               // a further edit is measured from here
    if (!before.trim() && !after.trim()) return;
    try {
      fetch('/api/field-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen: screenName(),
          field: el.id,
          label: (el.getAttribute('data-label') || el.getAttribute('aria-label') || '').slice(0, 120),
          item: itemId(),
          original: before.slice(0, MAX_LEN),
          edited: after.slice(0, MAX_LEN),
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* capture must never disturb cataloging */ }
  }

  document.addEventListener('change', function (ev) { maybeSend(ev.target); }, true);
  document.addEventListener('focusout', function (ev) { maybeSend(ev.target); }, true);
})();
