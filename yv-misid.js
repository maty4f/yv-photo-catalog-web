// yv-misid.js — "זיהוי שגוי" ליד כל שדה תוצאה (משוב ארכיונאית → זרם misid → דוקטור-הזיהויים).
// נטען בכל מסכי הקטלוג. סורק את מכולות התוצאות בלבד (roots) ומצמיד לכל שדה כפתור
// דגל קטן; לחיצה שולחת מסך/פריט/שדה/ערך ל-POST /api/feedback/misid ונרשמת בזרם
// misid בלוגים. עמיד לרינדור-מחדש (MutationObserver), לא נוגע בשדות קלט שלפני
// ההרצה, ולעולם לא מפיל את המסך (שליחה fail-soft עם אפשרות ניסיון חוזר).
(function () {
  'use strict';
  let CFG = null;
  const seen = new WeakSet();

  const css = `
  .yvm-btn{display:inline-block;margin-inline-start:8px;padding:0 7px;font-size:11px;line-height:18px;
    border:1px solid #d0a0a0;border-radius:10px;background:#fff;color:#a33;cursor:pointer;
    vertical-align:middle;user-select:none;unicode-bidi:isolate;font-family:inherit}
  .yvm-btn:hover{background:#fdeaea;border-color:#b66}
  .yvm-btn.yvm-sent{color:#1a7f37;border-color:#9c9;background:#effaf1;cursor:default}
  .yvm-btn.yvm-err{border-color:#e60;color:#e60}`;

  function ensureStyle() {
    if (document.getElementById('yvm-style')) return;
    const s = document.createElement('style');
    s.id = 'yvm-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // בסיס השרת — אותו דפוס כמו yv-client-log.js: הדשבורדים שומרים את כתובת
  // השרת ב-localStorage (yv_local_server_url); דף שמוגש מהשרת עצמו משתמש ב-origin.
  // כך הכפתור עובד גם ממשטח ה-Pages (github.io), לא רק מאותו origin.
  function serverBase() {
    try {
      var u = (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '');
      if (u) return u;
    } catch (e) { /* storage blocked — fall through */ }
    return location.origin;
  }

  // מזהה הפריט: עדיפות ל-getter של המסך; אחרת — קישור הפלט האחרון שמופיע בדף
  // (כל המסכים מציגים קישור /api/output/<שם הרשומה> אחרי שהעבודה הסתיימה).
  function itemId() {
    try {
      if (CFG && typeof CFG.item === 'function') {
        const v = CFG.item();
        if (v) return String(v).slice(0, 180);
      }
    } catch { /* getter של מסך לא חייב להצליח */ }
    const links = document.querySelectorAll('a[href*="/api/output/"]');
    const a = links[links.length - 1];
    if (a) {
      try { return decodeURIComponent(a.href.split('/api/output/')[1].split(/[?#]/)[0]).slice(0, 180); }
      catch { /* href לא צפוי — נוותר */ }
    }
    return '';
  }

  function sourceName() {
    const el = document.querySelector('.filename');
    return el && el.textContent ? el.textContent.trim().slice(0, 150) : '';
  }

  function send(btn, payload) {
    btn.disabled = true;
    btn.textContent = '…';
    fetch(serverBase() + '/api/feedback/misid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function () {
        btn.classList.remove('yvm-err');
        btn.classList.add('yvm-sent');
        btn.textContent = '✓ דווח';
        btn.title = 'נרשם ללוג — ייבדק על-ידי דוקטור-הזיהויים';
        btn.disabled = false;
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.classList.add('yvm-err');
        btn.textContent = '✗ שגוי';
        btn.title = 'השליחה נכשלה (' + err.message + ') — לחץ לניסיון חוזר';
      });
  }

  function makeBtn(field, label, getValue) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yvm-btn';
    b.textContent = '✗ שגוי';
    b.title = 'סמן זיהוי שגוי — נשלח ללוג לבדיקה';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (b.classList.contains('yvm-sent')) return;
      send(b, {
        screen: CFG.screen,
        item: itemId(),
        source: sourceName(),
        field: field,
        label: label,
        value: String(getValue() == null ? '' : getValue()).slice(0, 4000),
      });
    });
    return b;
  }

  function labelFor(el) {
    const p = el.parentElement;
    if (!p) return null;
    let lab = p.querySelector(':scope > .lang-tag, :scope > label');
    if (!lab) {
      const row = el.closest('.compact-row, .row');
      if (row) lab = row.querySelector('label');
    }
    return lab;
  }

  // דפוס א' (photos/films/documents/documents-v2): שדות תוצאה סטטיים עם id.
  function attachInput(el) {
    if (seen.has(el) || !el.id) return;
    const t = (el.type || '').toLowerCase();
    if (t === 'file' || t === 'checkbox' || t === 'radio' || t === 'hidden' || t === 'button') return;
    seen.add(el);
    const lab = labelFor(el);
    const btn = makeBtn(el.id, lab ? lab.textContent.trim().slice(0, 120) : el.id, function () { return el.value; });
    if (lab) lab.appendChild(btn);
    else el.insertAdjacentElement('beforebegin', btn);
  }

  // דפוס ב' (documents-tik): שדות נבנים דינמית — .field > .head (label+copy) + .body[id].
  function attachTikField(head) {
    const field = head.parentElement;
    const body = field ? field.querySelector(':scope > .body[id]') : null;
    if (!body || seen.has(head)) return;
    seen.add(head);
    const labEl = head.querySelector('.label');
    const btn = makeBtn(body.id, labEl ? labEl.textContent.trim().slice(0, 120) : body.id,
      function () { return (body.innerText || body.textContent || '').slice(0, 4000); });
    head.appendChild(btn);
  }

  let pending = null;
  function scan() {
    pending = null;
    if (!CFG) return;
    ensureStyle();
    for (let i = 0; i < CFG.roots.length; i++) {
      const found = document.querySelectorAll(CFG.roots[i]);
      for (let j = 0; j < found.length; j++) {
        found[j].querySelectorAll('textarea[id], input[id], select[id]').forEach(attachInput);
        found[j].querySelectorAll('.field > .head').forEach(attachTikField);
      }
    }
  }
  function scheduleScan() { if (!pending) pending = setTimeout(scan, 250); }

  window.yvMisid = {
    init: function (cfg) {
      CFG = Object.assign({ roots: ['#results'] }, cfg || {});
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
      else scan();
      new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    },
    scan: scan,
  };
})();
