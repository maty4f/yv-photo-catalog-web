// yv-client-log.js — browser-side activity/error logging for the cataloging
// dashboards (observability Stage B). Batches events to POST /api/client-log on
// the local server; the server writes them to the `client` JSONL stream.
//
// Captures: page loads, button/link clicks, JS errors, unhandled rejections,
// UI freezes (event-loop watchdog), failed API calls — plus a floating
// "דווח בעיה" button that flushes the recent buffer with the user's description.
// Also tags every same-server fetch with an x-yv-session header so server-side
// activity lines correlate to this browser session.
//
// Safety: fire-and-forget only — nothing here may ever break the dashboard.
// If the server answers 404 (e.g. page served from GitHub Pages with no local
// server configured), sending disables itself for the session.
(function () {
  'use strict';
  if (window.__yvLogLoaded) return;
  window.__yvLogLoaded = true;

  // --- session id (per browser tab session) --------------------------------
  var SKEY = 'yvSessionId';
  var sid;
  try {
    sid = sessionStorage.getItem(SKEY);
    if (!sid) {
      sid = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SKEY, sid);
    }
  } catch (e) { sid = 'nosess-' + Date.now().toString(36); }

  // Server base: the dashboards persist their server URL in localStorage
  // (yv_local_server_url); pages served from the server itself use the origin.
  function serverBase() {
    try {
      var u = (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '');
      if (u) return u;
    } catch (e) { /* storage blocked — fall through */ }
    return location.origin;
  }

  var page = (location.pathname.split('/').pop() || 'index.html');
  var buf = [];
  var disabled = false;

  function push(ev) {
    if (disabled) return;
    ev.t = Date.now();
    buf.push(ev);
    if (buf.length >= 25) send();
  }

  function send(useBeacon) {
    if (disabled || !buf.length) return;
    var events = buf.splice(0, 500);
    var body = JSON.stringify({ sessionId: sid, page: page, events: events });
    var url = serverBase() + '/api/client-log';
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }
      origFetch.call(window, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).then(function (r) {
        if (r.status === 404) disabled = true; // no such endpoint here — stop trying
      }).catch(function () { /* offline / server down — events stay lost, never retry-spam */ });
    } catch (e) { /* never break the page */ }
  }

  setInterval(send, 5000);
  window.addEventListener('pagehide', function () { send(true); });

  // --- clicks (event delegation, capture phase) ----------------------------
  window.addEventListener('click', function (e) {
    try {
      var el = e.target && e.target.closest &&
        e.target.closest('button, a, label, select, [role="button"], input[type="checkbox"], input[type="radio"], summary');
      if (!el) return;
      push({
        type: 'click',
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        cls: (typeof el.className === 'string' && el.className.trim().slice(0, 80)) || undefined,
        text: ((el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80)) || undefined,
      });
    } catch (err) { /* never break the page */ }
  }, true);

  // --- JS errors ------------------------------------------------------------
  window.addEventListener('error', function (e) {
    try {
      push({
        type: 'js-error',
        text: String(e.message || (e.target && e.target.src ? 'resource failed: ' + e.target.src : 'unknown')).slice(0, 500),
        src: (e.filename || '') + (e.lineno ? ':' + e.lineno : ''),
      });
    } catch (err) {}
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason;
      push({ type: 'js-rejection', text: String((r && r.message) || r || '').slice(0, 500) });
    } catch (err) {}
  });

  // --- freeze watchdog -------------------------------------------------------
  // A 1s heartbeat that arrives >3s late means the main thread was blocked
  // (frozen UI). Background tabs throttle timers, so ignore ticks while hidden
  // and for a grace period right after returning to the foreground.
  var lastTick = Date.now();
  var visibleSince = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') visibleSince = Date.now();
    lastTick = Date.now();
  });
  setInterval(function () {
    var now = Date.now();
    var blocked = now - lastTick - 1000;
    lastTick = now;
    if (document.visibilityState !== 'visible') return;
    if (now - visibleSince < 5000) return;
    if (blocked > 3000) push({ type: 'freeze', blockedMs: blocked });
  }, 1000);

  // --- fetch wrapper: session header + failed-API capture --------------------
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input : ((input && input.url) || '');
      var sameServer = url.indexOf('/api/') === 0 || url.indexOf(serverBase() + '/api/') === 0;
      if (sameServer) {
        init = init || {};
        var h = new Headers(init.headers || (typeof input === 'object' && input && input.headers) || undefined);
        if (!h.has('x-yv-session')) h.set('x-yv-session', sid);
        init.headers = h;
      }
    } catch (e) { /* fall through to the original call untouched */ }
    var p = origFetch.call(this, input, init);
    try {
      if (url && url.indexOf('/api/client-log') === -1 && /\/api\//.test(url)) {
        p.then(function (r) {
          if (r && r.status >= 500) push({ type: 'api-error', url: url.slice(0, 200), status: r.status });
        }).catch(function (err) {
          push({ type: 'api-fail', url: url.slice(0, 200), text: String((err && err.message) || err).slice(0, 200) });
        });
      }
    } catch (e) {}
    return p;
  };

  // --- "report a problem" button ---------------------------------------------
  // One click: user describes the problem, the whole recent buffer + report is
  // flushed immediately so the admin sees exactly what led up to it.
  function addReportButton() {
    try {
      if (!document.body || document.getElementById('yv-report-btn')) return;
      var btn = document.createElement('button');
      btn.id = 'yv-report-btn';
      btn.type = 'button';
      btn.textContent = '🛟 דווח בעיה';
      btn.setAttribute('style',
        'position:fixed;bottom:12px;left:12px;z-index:99999;direction:rtl;' +
        'background:#8b1e2d;color:#fff;border:none;border-radius:20px;' +
        'padding:8px 14px;font-size:13px;cursor:pointer;opacity:.75;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.3);font-family:inherit;');
      btn.onmouseenter = function () { btn.style.opacity = '1'; };
      btn.onmouseleave = function () { btn.style.opacity = '.75'; };
      btn.onclick = function () {
        var desc = prompt('תאר בקצרה מה קרה / מה נתקע (הלוגים האחרונים יצורפו אוטומטית):');
        if (desc === null) return;
        push({
          type: 'user-report',
          text: (desc || '(ללא תיאור)').slice(0, 1000),
          url: location.href.slice(0, 300),
          w: window.innerWidth, h: window.innerHeight,
        });
        send();
        alert('הדיווח נשלח ✓ תודה');
      };
      document.body.appendChild(btn);
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addReportButton);
  } else {
    addReportButton();
  }

  // --- session start ----------------------------------------------------------
  push({
    type: 'page-load',
    url: location.href.slice(0, 300),
    ua: navigator.userAgent.slice(0, 160),
    w: window.innerWidth, h: window.innerHeight,
    lang: navigator.language,
  });

  // Test hook (jsdom contract tests) — not a public API.
  window.__yvLog = { push: push, send: send, buf: buf, sid: sid };
})();
