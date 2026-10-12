/* yv-i18n.js — runtime language layer for every dashboard screen (12.10.2026).
 *
 * The screens are authored in Hebrew. When the viewer picks English (the
 * floating «EN | עב» pill, or ?lang=en), this file translates the DOM — static
 * markup AND everything the inline scripts render later — through one
 * dictionary, photo-system/web/i18n/he-en.js (generated from he-en.json by
 * tools/i18n_extract.py). Nothing in the 44 inline scripts had to change.
 *
 * What is translated: text nodes, <title>, placeholder / title / aria-label /
 * alt, and the value of button-type inputs. Keys match the normalised text
 * (whitespace-collapsed); a key may carry `{}` wildcards for runtime values
 * ("נמצאו {} פריטים"); a text that is a concatenation of several keys is
 * translated run by run. Untranslated Hebrew is left as is — never guessed.
 *
 * What is NEVER translated (record content, not UI): elements matching
 * SKIP_SELECTOR — the Hebrew record cells (.he, .he-cell, .single.he, .compact,
 * .chip-box), textareas, pre/code, contenteditable, [lang="he"], and anything
 * marked data-i18n-skip. The house RTL rule for Hebrew content is preserved:
 * those cells carry explicit direction:rtl in CSS, so flipping the document to
 * LTR for English leaves them right-aligned.
 *
 * Preference: localStorage "mf_lang" (he|en); ?lang=he|en sets it. Switching
 * reloads the page so every script boots in the chosen direction.
 */
(function () {
  'use strict';
  var KEY = 'mf_lang';
  var HE = /[֐-׿]/;
  var SKIP_SELECTOR = '.he, .he-cell, .single.he, .compact, .chip-box, textarea, pre, code, [contenteditable], [lang="he"], [data-i18n-skip], script, style';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var BASE = SRC.replace(/[^/]*$/, '');
  var VERSION = (SRC.match(/[?&]v=([^&]+)/) || [])[1] || '';

  function readLang() {
    var q = null;
    try { q = new URL(location.href).searchParams.get('lang'); } catch (e) { /* ignore */ }
    if (q === 'he' || q === 'en') { try { localStorage.setItem(KEY, q); } catch (e) { /* private mode */ } return q; }
    try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'he'; } catch (e) { return 'he'; }
  }
  var lang = readLang();
  window.MF_LANG = lang;
  window.mfSetLang = function (next) {
    next = next === 'en' ? 'en' : 'he';
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    try {
      var u = new URL(location.href);
      if (u.searchParams.has('lang')) { u.searchParams.set('lang', next); location.href = u.toString(); return; }
    } catch (e) { /* ignore */ }
    location.reload();
  };

  /* ---- switcher pill (every screen, no per-page markup) ---- */
  function injectSwitcher() {
    if (document.getElementById('mf-lang-switch')) return;
    var box = document.createElement('div');
    box.id = 'mf-lang-switch';
    box.setAttribute('data-i18n-skip', '');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', lang === 'en' ? 'Interface language' : 'שפת הממשק');
    box.innerHTML =
      '<button type="button" data-lang="he"' + (lang === 'he' ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ' title="עברית">עב</button>' +
      '<button type="button" data-lang="en"' + (lang === 'en' ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ' title="English">EN</button>';
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-lang]');
      if (b && b.getAttribute('data-lang') !== lang) window.mfSetLang(b.getAttribute('data-lang'));
    });
    var st = document.createElement('style');
    st.textContent =
      '#mf-lang-switch{position:fixed;bottom:12px;right:12px;z-index:2147483000;display:flex;gap:2px;padding:2px;' +
      'background:var(--card,#fff);border:1px solid var(--line,#d8d4cc);border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.12);font:600 11.5px/1 system-ui,sans-serif;direction:ltr}' +
      '#mf-lang-switch button{border:0;background:transparent;color:var(--muted,#666);padding:5px 9px;border-radius:999px;cursor:pointer;font:inherit}' +
      '#mf-lang-switch button.on{background:var(--brand,#1f4e79);color:var(--accent-ink,#fff)}' +
      '#mf-lang-switch button:hover:not(.on){background:var(--tint,#f1efe9);color:var(--ink,#222)}' +
      '@media print{#mf-lang-switch{display:none}}';
    document.head.appendChild(st);
    document.body.appendChild(box);
  }

  if (lang !== 'en') {
    onReady(injectSwitcher);
    return;
  }

  /* ---- English: flip the document, hide until the dictionary is applied ---- */
  var root = document.documentElement;
  root.setAttribute('lang', 'en');
  root.setAttribute('dir', 'ltr');
  root.classList.add('i18n-pending');
  var hide = document.createElement('style');
  hide.id = 'mf-i18n-hide';
  // The theme sets direction:rtl on html/body and many screens repeat it on
  // their containers, so dir="ltr" alone would not flip the UI. In English the
  // whole UI runs LTR except the record cells — they keep their explicit RTL.
  var keep = ['.he', '.he-cell', '.compact', '.chip-box', 'textarea', '[lang="he"]', '[data-i18n-skip]', '[dir="rtl"]'];
  var notList = keep.concat(keep.map(function (k) { return k + ' *'; })).join(', ');
  hide.textContent =
    'html.i18n-pending body{visibility:hidden}' +
    'html[lang="en"] body, html[lang="en"] body *:not(' + notList + '){direction:ltr !important}';
  (document.head || root).appendChild(hide);

  /* text-align:right is physical: an English line flush right reads wrong.
     Flip only what computes to "right" (inherited "right" collapses once body
     is left-aligned) and never inside a record cell. */
  function flipTextAlign(el) {
    if (!el || el.nodeType !== 1 || !window.getComputedStyle) return;
    if (el.closest && el.closest(SKIP_SELECTOR)) return;
    var all = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.closest(SKIP_SELECTOR) || e.id === 'mf-lang-switch') continue;
      if (getComputedStyle(e).textAlign === 'right') e.style.textAlign = 'left';
    }
  }
  var reveal = function () { root.classList.remove('i18n-pending'); };
  setTimeout(reveal, 2500); // never leave the screen blank if the dictionary fails to load

  var exact = Object.create(null);
  var patterns = [];
  var RUN = /[֐-׿](?:[֐-׿\s"'׳״,.:;!?()\-–—/]*[֐-׿])?:?/g;

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function loadDictionary(dict) {
    var keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = dict[k];
      if (!v) continue;
      if (k.indexOf('{}') >= 0) {
        var re = new RegExp('^' + escapeRe(k).split('\\{\\}').join('([\\s\\S]*?)') + '$');
        patterns.push({ re: re, en: v, len: k.length });
      } else {
        exact[k] = v;
      }
    }
    patterns.sort(function (a, b) { return b.len - a.len; }); // most specific first
  }

  function fillPattern(en, groups) {
    var i = 0;
    return en.replace(/\{\}/g, function () { return groups[i++] !== undefined ? groups[i - 1] : ''; });
  }

  /* Translate one normalised string; returns null when nothing matched. */
  function lookup(s) {
    var hit = exact[s];
    if (hit) return hit;
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].re.exec(s);
      if (m) return fillPattern(patterns[i].en, m.slice(1));
    }
    // decoration added by concatenation ("— ", "✓ ", a trailing colon) sits outside the key
    var lead = s.match(/^[^\p{L}\p{N}]+/u), trail = s.match(/[^\p{L}\p{N})]+$/u);
    var a = lead ? lead[0].length : 0, b = trail ? s.length - trail[0].length : s.length;
    if (a < b && (a || b < s.length)) {
      var core = s.slice(a, b);
      if (exact[core]) return s.slice(0, a) + exact[core] + s.slice(b);
    }
    return null;
  }

  function translateText(raw) {
    if (!HE.test(raw)) return null;
    var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    var core = norm(raw);
    if (!core) return null;
    var out = lookup(core);
    if (out === null) {
      // concatenated fragments: translate each Hebrew run that is itself a key
      var changed = false;
      out = core.replace(RUN, function (run) {
        var r = lookup(run);
        if (r === null) return run;
        changed = true;
        return r;
      });
      if (!changed) return null;
    }
    return lead + out + trail;
  }

  function skipped(el) {
    return !!(el && el.closest && el.closest(SKIP_SELECTOR));
  }

  function translateNode(node) {
    if (node.nodeType === 3) {
      if (node.__mfOut !== undefined && node.__mfOut === node.data) return; // our own write
      if (skipped(node.parentNode)) return;
      var t = translateText(node.data);
      if (t !== null && t !== node.data) { node.__mfOut = t; node.data = t; }
      return;
    }
    if (node.nodeType !== 1) return;
    var el = node;
    if (el.matches && el.matches(SKIP_SELECTOR)) return;
    translateAttrs(el);
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return n.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) translateNode(n);
    var els = el.querySelectorAll ? el.querySelectorAll('[placeholder],[title],[aria-label],[alt],input[type="button"],input[type="submit"],input[type="reset"]') : [];
    for (var i = 0; i < els.length; i++) if (!skipped(els[i].parentNode)) translateAttrs(els[i]);
  }

  function translateAttr(el, name) {
    var v = el.getAttribute(name);
    if (!v || !HE.test(v)) return;
    var store = el.__mfAttr || (el.__mfAttr = {});
    if (store[name] === v) return;
    var t = translateText(v);
    if (t !== null && t !== v) { store[name] = t; el.setAttribute(name, t); }
  }
  function translateAttrs(el) {
    if (!el.getAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) translateAttr(el, ATTRS[i]);
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) translateAttr(el, 'value');
  }

  function translateTitle() {
    var t = translateText(document.title);
    if (t !== null) document.title = t;
  }

  function applyAll() {
    translateTitle();
    if (document.body) translateNode(document.body);
  }

  function observe() {
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) { translateNode(r.addedNodes[j]); flipTextAlign(r.addedNodes[j]); }
        } else if (r.type === 'characterData') {
          translateNode(r.target);
        } else if (r.type === 'attributes') {
          if (r.target.nodeType === 1 && !skipped(r.target.parentNode)) {
            if (r.attributeName === 'value') { if (r.target.tagName === 'INPUT') translateAttrs(r.target); }
            else translateAttr(r.target, r.attributeName);
          }
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(['value'])
    });
    var titleEl = document.querySelector('title');
    if (titleEl) new MutationObserver(translateTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  /* alert()/confirm()/prompt() never touch the DOM: translate them line by line. */
  function translateLines(msg) {
    return String(msg).split('\n').map(function (line) {
      var t = translateText(line);
      return t === null ? line : t;
    }).join('\n');
  }
  function wrapDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        if (args.length) args[0] = translateLines(args[0]);
        if (name === 'prompt' && args.length > 1 && typeof args[1] === 'string') args[1] = translateLines(args[1]);
        return orig.apply(window, args);
      };
    });
  }

  function start(dict) {
    loadDictionary(dict || {});
    window.mfTranslate = function (s) { return translateLines(s); };
    wrapDialogs();
    onReady(function () {
      document.body.style.textAlign = 'left';
      applyAll();
      flipTextAlign(document.body);
      observe();
      injectSwitcher();
      reveal();
    });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  if (window.MF_I18N_HE_EN) { start(window.MF_I18N_HE_EN); return; }
  var s = document.createElement('script');
  s.src = BASE + 'i18n/he-en.js' + (VERSION ? '?v=' + VERSION : '');
  s.onload = function () { start(window.MF_I18N_HE_EN); };
  s.onerror = function () { start({}); };
  (document.head || root).appendChild(s);
})();
