// yv-progress.js — a live progress card for the cataloging screens: a circular
// gauge (the "graph") that fills toward completion, a big percent in the center,
// a running clock (elapsed mm:ss), a linear stage bar with the current step, a
// metrics row (window N/M · pages a–b/total · model), and a live WORK TRAIL — a
// scrolling, timestamped log of every window/stage as it happens, so the archivist
// sees exactly what the engine is doing RIGHT NOW inside the system itself.
// Shared across photos/films/documents/tik.
//
// The percent is HONEST-ish, not fabricated: it's the max of (a) a milestone floor
// derived from the engine's own stage log lines in the job's event stream, and
// (b) an elapsed/estimate interpolation — capped at 95% until the job actually
// reports done. It never moves backwards. Elapsed time is real (from begin()).
//
// Drive it from the screen's existing poll loop:
//   yvProgress.begin({ screen:'photos', kind:'photo' });   // at submit
//   yvProgress.pump(job);                                   // each poll (job = {events,status})
//   yvProgress.end(true);  /  yvProgress.end(false, msg);   // on done / error
// For client-side screens with no job object: yvProgress.step('טקסט שלב') advances by text.
(function () {
  'use strict';

  // Rough per-kind expected durations (seconds) — measured estimates; only used
  // to make the bar move smoothly between stage markers, never as ground truth.
  var EST = { photo: 30, doc: 150, film: 180, tik: 390 };

  // Stage markers → floor %. Matched as substrings/regex against event text; the
  // engines emit these (Hebrew "שלב N", "Render", "מעלה", "חילוץ keyframes", …).
  var MILESTONES = [
    { re: /מעלה|uploca|upload|קונטקסט/i, p: 6, he: 'מעלה לשרת' },
    { re: /keyframes|חילוץ/i, p: 14, he: 'מחלץ פריימים' },
    { re: /שלב 1|stage ?1|gemini|קטלוג|קורא|OCR/i, p: 32, he: 'שלב 1 · קריאה' },
    { re: /שלב 2|stage ?2|claude|סינתז|synth/i, p: 66, he: 'שלב 2 · סינתזה' },
    { re: /שלב 3|render|ולידציה|save|נכתב|🎨/i, p: 88, he: 'שלב 3 · הרכבה' },
  ];

  var A = null;      // the single active instance
  var C = 2 * Math.PI * 52;   // ring circumference (r=52)

  function styleOnce() {
    if (document.getElementById('yv-progress-style')) return;
    var s = document.createElement('style');
    s.id = 'yv-progress-style';
    s.textContent =
      '.yv-prog{direction:rtl;text-align:right;display:flex;gap:16px;align-items:center;' +
      'background:#fff;border:1px solid #d7dde3;border-radius:12px;padding:14px 18px;margin:10px 0;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.06);font-family:inherit;flex-wrap:wrap}' +
      '.yv-prog.done{border-color:#9c9;background:#f2fbf4}.yv-prog.err{border-color:#e0a0a0;background:#fdf2f2}' +
      '.yv-prog .ring{position:relative;width:118px;height:118px;flex:0 0 auto}' +
      '.yv-prog .ring svg{transform:rotate(-90deg)}' +
      '.yv-prog .ring .pct{position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;unicode-bidi:isolate}' +
      '.yv-prog .ring .pct b{font-size:26px;color:#2c5f7c;line-height:1}' +
      '.yv-prog .ring.done .pct b{color:#1a7f37}.yv-prog .ring.err .pct b{color:#c0392b}' +
      '.yv-prog .ring .pct small{font-size:11px;color:#8a97a3;margin-top:2px}' +
      '.yv-prog .body{flex:1 1 220px;min-width:200px}' +
      '.yv-prog .clock{font-size:22px;font-weight:700;color:#33475b;unicode-bidi:isolate;' +
      'font-variant-numeric:tabular-nums;letter-spacing:.5px}' +
      '.yv-prog .clock .eta{font-size:12px;font-weight:400;color:#8a97a3;margin-inline-start:10px}' +
      '.yv-prog .stage{font-size:13px;color:#4a5b6b;margin:6px 0 8px;unicode-bidi:isolate;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
      '.yv-prog .bar{height:8px;border-radius:5px;background:#e8edf1;overflow:hidden}' +
      '.yv-prog .bar > i{display:block;height:100%;width:0;border-radius:5px;' +
      'background:linear-gradient(90deg,#2c5f7c,#4a90b8);transition:width .5s ease}' +
      '.yv-prog.done .bar > i{background:#1a7f37}.yv-prog.err .bar > i{background:#c0392b}' +
      // metrics chips (window N/M · pages · model) + the live work-trail log
      '.yv-prog .meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}' +
      '.yv-prog .meta .chip{font-size:11.5px;background:#eef3f7;color:#33586e;border-radius:999px;' +
      'padding:2px 9px;unicode-bidi:isolate;font-variant-numeric:tabular-nums}' +
      '.yv-prog .meta .chip.model{background:#e7f0ff;color:#2a5db0}' +
      '.yv-prog .trail-wrap{flex:1 1 100%;margin:10px 0 0;border-top:1px solid #edf1f4;padding-top:8px}' +
      '.yv-prog .trail-wrap > summary{cursor:pointer;font-size:12px;color:#6b7a89;list-style:none;user-select:none}' +
      '.yv-prog .trail-wrap > summary::-webkit-details-marker{display:none}' +
      '.yv-prog .trail-wrap > summary b{color:#33475b}' +
      '.yv-prog .trail{margin:8px 0 0;padding:0 2px 0 0;max-height:150px;overflow-y:auto;list-style:none;' +
      'font-size:12px;line-height:1.7;color:#4a5b6b;unicode-bidi:isolate}' +
      '.yv-prog .trail li{display:flex;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.yv-prog .trail li .t{color:#9aa7b3;font-variant-numeric:tabular-nums;flex:0 0 auto}' +
      '.yv-prog .trail li .m{overflow:hidden;text-overflow:ellipsis}' +
      '.yv-prog .trail li.now{color:#1f2d3a;font-weight:600}' +
      '.yv-prog .trail li.warn{color:#b26a00}.yv-prog .trail li.bad{color:#c0392b}';
    document.head.appendChild(s);
  }

  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function build(kind) {
    var el = document.createElement('div');
    el.className = 'yv-prog';
    el.innerHTML =
      '<div class="ring"><svg width="118" height="118" viewBox="0 0 118 118">' +
      '<circle cx="59" cy="59" r="52" fill="none" stroke="#e8edf1" stroke-width="11"></circle>' +
      '<circle class="arc" cx="59" cy="59" r="52" fill="none" stroke="#2c5f7c" stroke-width="11" ' +
      'stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"></circle>' +
      '</svg><div class="pct"><b>0%</b><small>התקדמות</small></div></div>' +
      '<div class="body"><div class="clock">00:00<span class="eta"></span></div>' +
      '<div class="stage">ממתין…</div><div class="bar"><i></i></div>' +
      '<div class="meta"></div></div>' +
      '<details class="trail-wrap" open><summary>נתיב העבודה · <b class="tcount">0</b> שלבים</summary>' +
      '<ol class="trail"></ol></details>';
    return el;
  }

  function render() {
    if (!A || !A.el) return;
    var p = Math.round(A.pct);
    A.el.querySelector('.pct b').textContent = p + '%';
    A.el.querySelector('.arc').setAttribute('stroke-dashoffset', (C * (1 - A.pct / 100)).toFixed(1));
    A.el.querySelector('.bar > i').style.width = A.pct + '%';
    var elapsed = (A.now() - A.t0) / 1000;
    var clock = A.el.querySelector('.clock');
    // Freeze the clock once finished; keep the final elapsed.
    var shown = A.frozen != null ? A.frozen : elapsed;
    clock.firstChild.nodeValue = mmss(shown);
    var etaEl = clock.querySelector('.eta');
    if (A.state === 'run') {
      var eta = A.est - elapsed;
      etaEl.textContent = eta > 3 ? '~' + mmss(eta) + ' נותרו (הערכה)' : 'כמעט…';
    } else etaEl.textContent = '';
  }

  function tick() {
    if (!A || A.state !== 'run') return;
    var elapsed = (A.now() - A.t0) / 1000;
    var byTime = Math.min(95, (elapsed / A.est) * 100);
    var target = Math.max(A.floor, byTime);
    if (target > A.pct) A.pct = target;      // monotonic
    render();
  }

  // Parse one engine narration line into structured facts for the metrics row:
  // the current read window (pages a–b of total), which model, the total window
  // count, and whether the line is a warning/error. Pure.
  function parseLine(text) {
    var t = String(text || '');
    var out = { model: /Claude/i.test(t) ? 'Claude' : (/Gemini/i.test(t) ? 'Gemini' : null) };
    var win = t.match(/חלון עמ' (\d+)[–-](\d+)\/(\d+)/u);
    if (win) { out.isWindow = true; out.a = +win[1]; out.b = +win[2]; out.pageTotal = +win[3]; }
    var tot = t.match(/ב-(\d+) חלונות|(\d+) חלונות של/u);
    if (tot) out.totalWindows = +(tot[1] || tot[2]);
    if (/❌|שגיאה|error|נכשל.*בכל/iu.test(t)) out.kind = 'bad';
    else if (/⚠|נכשל|timeout|מפוצל|נופל|גיבוי|🔁|⟳/iu.test(t)) out.kind = 'warn';
    return out;
  }

  function renderMeta() {
    if (!A || !A.el) return;
    var meta = A.el.querySelector('.meta');
    if (!meta) return;
    var chips = [];
    if (A.winDone) {
      var tot = Math.max(A.winTotal || 0, A.winDone);
      chips.push('<span class="chip">חלון ' + A.winDone + (tot ? '/' + tot : '') + '</span>');
    }
    if (A.pageA) chips.push('<span class="chip">עמ׳ ' + A.pageA + '–' + A.pageB +
                            (A.pageTotal ? '/' + A.pageTotal : '') + '</span>');
    if (A.model) chips.push('<span class="chip model">מודל: ' + A.model + '</span>');
    meta.innerHTML = chips.join('');
  }

  // Append the not-yet-shown events to the live work trail (timestamped by when
  // first seen — honest and monotonic), and update the metrics row from them.
  function pushTrail(events) {
    if (!A || !A.el || !Array.isArray(events)) return;
    var ol = A.el.querySelector('.trail');
    var start = A.trailCount || 0;
    var elapsed = (A.now() - A.t0) / 1000;
    for (var i = start; i < events.length; i++) {
      var raw = String(events[i].text || events[i].message || '').trim().split('\n').pop();
      if (!raw) continue;
      var p = parseLine(raw);
      if (p.isWindow) { A.winDone = (A.winDone || 0) + 1; A.pageA = p.a; A.pageB = p.b; A.pageTotal = p.pageTotal; }
      if (p.totalWindows) A.winTotal = p.totalWindows;
      if (p.model) A.model = p.model;
      if (ol) {
        if (A.lastLi) A.lastLi.classList.remove('now');
        var li = document.createElement('li');
        li.className = (p.kind || '') + ' now';
        li.innerHTML = '<span class="t">' + mmss(elapsed) + '</span>' +
                       '<span class="m">' + esc(raw.slice(0, 160)) + '</span>';
        ol.appendChild(li);
        A.lastLi = li;
        ol.scrollTop = ol.scrollHeight;   // keep the newest line in view
      }
    }
    A.trailCount = events.length;
    var cEl = A.el.querySelector('.tcount');
    if (cEl) cEl.textContent = String(events.length);
    renderMeta();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // textOnly: when the server reports an HONEST percent, milestone regexes must
  // not inflate the floor (a generic /gemini/ match jumps to 32% on the very
  // first read window) — events then drive only the stage text.
  function applyEvents(job, textOnly) {
    if (!A || !job || !Array.isArray(job.events)) return;
    for (var i = 0; i < job.events.length; i++) {
      var t = String(job.events[i].text || job.events[i].message || '');
      for (var m = 0; m < MILESTONES.length; m++) {
        if (MILESTONES[m].re.test(t)) {
          if (!textOnly && MILESTONES[m].p > A.floor) A.floor = MILESTONES[m].p;
          if (MILESTONES[m].p > (A.stageP || 0)) { A.stageP = MILESTONES[m].p; A.stageHe = MILESTONES[m].he; }
        }
      }
    }
    // Feed the live trail (new events only) + metrics row.
    pushTrail(job.events);
    // Show the latest human line under the bar (trimmed), else the stage name.
    var last = job.events.length ? job.events[job.events.length - 1] : null;
    var line = last ? String(last.text || last.message || '').trim().split('\n').pop().slice(0, 90) : '';
    if (A.el) A.el.querySelector('.stage').textContent = line || A.stageHe || 'מעבד…';
  }

  window.yvProgress = {
    begin: function (cfg) {
      cfg = cfg || {};
      styleOnce();
      var host = document.querySelector(cfg.mount || '.yv-progress-mount');
      if (!host) return;                       // no mount → silently no-op
      var el = build(cfg.kind);
      host.innerHTML = '';
      host.appendChild(el);
      // now() is injectable for tests; default wall clock.
      var now = cfg.now || function () { return Date.now(); };
      if (A && A.timer) clearInterval(A.timer);
      A = { el: el, kind: cfg.kind, est: cfg.estSec || EST[cfg.kind] || 120,
            t0: now(), now: now, pct: 0, floor: 0, state: 'run', stageHe: '', frozen: null, timer: null,
            trailCount: 0, winDone: 0, winTotal: 0, pageA: 0, pageB: 0, pageTotal: 0, model: '', lastLi: null };
      render();
      if (!cfg.now) A.timer = setInterval(tick, 1000);   // live clock; tests drive tick() manually
      return A;
    },
    // Feed the poll loop's job object (events + status). Safe if begin() was skipped.
    pump: function (job) {
      if (!A || A.state !== 'run' || !job) return;
      // Server-computed HONEST percent (e.g. tik window pages / total pages) beats
      // any milestone guess — adopt it as the floor, and project a real ETA from it
      // (elapsed / pct) instead of the static per-kind estimate.
      var hasSrv = typeof job.progressPct === 'number';
      applyEvents(job, hasSrv);
      if (hasSrv) {
        var sp = Math.min(95, job.progressPct);
        if (sp > A.floor) {
          A.floor = sp;
          var el = (A.now() - A.t0) / 1000;
          if (sp >= 5 && el > 20) A.est = Math.max(A.est, el * 100 / sp);
        }
      }
      if (job.status === 'done') { this.end(true); return; }
      if (job.status === 'error') {
        var er = (job.events || []).filter(function (e) { return e.type === 'error'; }).pop();
        this.end(false, er && (er.message || er.text)); return;
      }
      tick();
    },
    // For client-side screens with no job object — advance by a stage text line.
    // Accumulate into a synthetic cumulative stream so the trail appends (not
    // resets) each call, matching the server-job pump contract.
    step: function (text) {
      if (!A || A.state !== 'run') return;
      A.stepEvents = A.stepEvents || [];
      A.stepEvents.push({ text: String(text || '') });
      applyEvents({ events: A.stepEvents });
      tick();
    },
    end: function (ok, msg) {
      if (!A) return;
      if (A.timer) { clearInterval(A.timer); A.timer = null; }
      A.frozen = (A.now() - A.t0) / 1000;
      A.state = ok ? 'done' : 'err';
      A.pct = ok ? 100 : A.pct;
      if (A.el) {
        A.el.className = 'yv-prog ' + (ok ? 'done' : 'err');
        A.el.querySelector('.ring').className = 'ring ' + (ok ? 'done' : 'err');
        A.el.querySelector('.pct small').textContent = ok ? '✓ הושלם' : '✗ שגיאה';
        if (!ok && msg) A.el.querySelector('.stage').textContent = String(msg).slice(0, 120);
        // Close out the trail: drop the live highlight and stamp a terminal line.
        if (A.lastLi) A.lastLi.classList.remove('now');
        var ol = A.el.querySelector('.trail');
        if (ol) {
          var li = document.createElement('li');
          li.className = ok ? '' : 'bad';
          li.innerHTML = '<span class="t">' + mmss(A.frozen) + '</span><span class="m">' +
                         (ok ? '✓ הקטלוג הושלם' : '✗ ' + esc(String(msg || 'שגיאה').slice(0, 140))) + '</span>';
          ol.appendChild(li);
          ol.scrollTop = ol.scrollHeight;
        }
      }
      render();
    },
    // Remove the card (e.g. when the screen resets).
    clear: function () {
      if (A && A.timer) clearInterval(A.timer);
      if (A && A.el && A.el.parentNode) A.el.parentNode.innerHTML = '';
      A = null;
    },
    _active: function () { return A; },   // test hook
  };
})();
