// yv-flow.js — a small "processing flow" selector for the cataloging screens.
// Each screen calls yvFlow.init() with its own options; the control renders into
// the first `.yv-flow-mount` (or a given selector), persists the choice to
// localStorage, and the screen reads yvFlow.current(screen) at submit time to
// append it to the request (photos/films/doc → `flow`; tik → `reader`). The
// server maps it to a per-job engine env, overriding the global default for that
// one job. RTL, self-contained, fail-soft (no mount → current() still returns the
// default so submit never breaks).
(function () {
  'use strict';
  var CFG = {};   // screen → config
  var VAL = {};   // screen → current value (flow / reader)
  var BE = {};    // screen → Claude backend value ('' = default/subscription | 'api')

  // The Claude-backend toggle is identical on every screen: subscription CLI
  // (default, $0) vs the Anthropic API (paid, no headless CLI stalls). '' means
  // "leave the server default" so an unset toggle never changes behavior.
  var BACKEND_OPTS = [
    { value: '', label: 'Claude: מנוי (0$)', hint: 'CLI המנוי — ברירת מחדל' },
    { value: 'api', label: 'Claude: API', hint: 'Anthropic API — ללא סטולים, ~$0.05/פריט' },
  ];

  function styleOnce() {
    if (document.getElementById('yv-flow-style')) return;
    var s = document.createElement('style');
    s.id = 'yv-flow-style';
    s.textContent =
      '.yv-flow{display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;' +
      'direction:rtl;text-align:right;font-size:13px;color:#33475b;margin:6px 0}' +
      '.yv-flow > b{font-weight:600}' +
      '.yv-flow select{font:inherit;padding:3px 8px;border:1px solid #c3ccd6;' +
      'border-radius:7px;background:#fff;color:#1f3a4d;cursor:pointer;unicode-bidi:isolate}' +
      '.yv-flow-hint{color:#7a8794;font-size:12px;unicode-bidi:isolate}';
    document.head.appendChild(s);
  }

  function updateHint(wrap, cfg, val) {
    var o = cfg.options.filter(function (x) { return x.value === val; })[0];
    wrap.querySelector('.yv-flow-hint').textContent = (o && o.hint) ? ('— ' + o.hint) : '';
  }

  function build(cfg) {
    var wrap = document.createElement('label');
    wrap.className = 'yv-flow';
    var b = document.createElement('b');
    b.textContent = cfg.label || 'זרימת עיבוד:';
    wrap.appendChild(b);

    var sel = document.createElement('select');
    cfg.options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.hint) opt.title = o.hint;
      sel.appendChild(opt);
    });
    var saved = null;
    try { saved = localStorage.getItem('yv_flow_' + cfg.screen); } catch (e) { /* storage blocked */ }
    var valid = cfg.options.some(function (o) { return o.value === saved; });
    sel.value = valid ? saved : cfg.def;
    VAL[cfg.screen] = sel.value;
    sel.addEventListener('change', function () {
      VAL[cfg.screen] = sel.value;
      try { localStorage.setItem('yv_flow_' + cfg.screen, sel.value); } catch (e) { /* ignore */ }
      updateHint(wrap, cfg, sel.value);
    });
    wrap.appendChild(sel);

    var hint = document.createElement('span');
    hint.className = 'yv-flow-hint';
    wrap.appendChild(hint);
    updateHint(wrap, cfg, sel.value);

    // Optional Claude-backend toggle (opt-in via cfg.backend). Independent of the
    // flow/reader choice above; persisted under its own key so it survives reloads.
    if (cfg.backend) {
      var beSel = document.createElement('select');
      BACKEND_OPTS.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        if (o.hint) opt.title = o.hint;
        beSel.appendChild(opt);
      });
      var beSaved = null;
      try { beSaved = localStorage.getItem('yv_backend_' + cfg.screen); } catch (e) { /* storage blocked */ }
      var beValid = BACKEND_OPTS.some(function (o) { return o.value === beSaved; });
      beSel.value = beValid ? beSaved : '';
      BE[cfg.screen] = beSel.value;
      beSel.addEventListener('change', function () {
        BE[cfg.screen] = beSel.value;
        try { localStorage.setItem('yv_backend_' + cfg.screen, beSel.value); } catch (e) { /* ignore */ }
      });
      wrap.appendChild(beSel);
    }
    return wrap;
  }

  window.yvFlow = {
    init: function (cfg) {
      if (!cfg || !cfg.screen || !cfg.options || !cfg.options.length) return;
      cfg.def = cfg.def || cfg.options[0].value;
      CFG[cfg.screen] = cfg;
      VAL[cfg.screen] = cfg.def;   // so current() is valid even before the mount renders
      styleOnce();
      function mount() {
        var host = document.querySelector(cfg.mount || '.yv-flow-mount');
        if (!host || host.querySelector('.yv-flow')) return;
        host.appendChild(build(cfg));
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
      else mount();
    },
    // The screen's current choice (falls back to the configured default).
    current: function (screen) {
      return VAL[screen] != null ? VAL[screen] : (CFG[screen] && CFG[screen].def) || '';
    },
    // The screen's Claude-backend choice ('' | 'api'). '' when the toggle is off
    // or untouched → the server keeps its default (subscription CLI).
    backend: function (screen) {
      return BE[screen] != null ? BE[screen] : '';
    },
  };
})();
