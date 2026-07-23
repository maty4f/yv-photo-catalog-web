// onboarding.inline1.js — CSP no-inline (review 2026-07-23). The print button's
// former inline onclick="window.print()" is blocked by the strict script-src
// (no 'unsafe-inline'); bind it here instead.
(function () {
  'use strict';
  var b = document.getElementById('btn-print');
  if (b) b.addEventListener('click', function () { window.print(); });
})();
