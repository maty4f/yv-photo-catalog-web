// yv-misid.js — משוב ארכיונאית פר-שדה, שלושה ערוצים:
//   ✗ "זיהוי שגוי"  — לחיצה אחת → זרם misid → דוקטור-הזיהויים (אבחון).
//   💡 "שיפור"      — הערה חופשית על התוצאה/אופן ההצגה → זרם improve →
//                      improve-doctor שמאמת את הטענה ומכין תיקון קוד/פרומפט.
//   ✓ "נכון"        — אישור חיובי בלחיצה אחת → זרם confirm → מונה מצטבר;
//                      שדה שאושר שוב ושוב הופך לכלל "שמור על הסגנון" והסוכן
//                      יודע לא "לתקן" חלק שהמקטלגת אישרה שעובד.
// נטען בכל מסכי הקטלוג. סורק את מכולות התוצאות בלבד (roots) ומצמיד לכל שדה
// זוג כפתורים; עמיד לרינדור-מחדש (MutationObserver), לא נוגע בשדות קלט שלפני
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
  .yvm-btn.yvm-err{border-color:#e60;color:#e60}
  .yvm-btn.yvm-imp{border-color:#c9b458;color:#7a6a10}
  .yvm-btn.yvm-imp:hover{background:#fdf7dd;border-color:#b09a2e}
  .yvm-btn.yvm-imp.yvm-sent{color:#1a7f37;border-color:#9c9;background:#effaf1}
  .yvm-btn.yvm-ok{border-color:#8bc79b;color:#1a7f37}
  .yvm-btn.yvm-ok:hover{background:#effaf1;border-color:#5aa96e}
  .yvm-pop{position:fixed;z-index:99999;background:#fffdf3;border:1px solid #c9b458;border-radius:8px;
    box-shadow:0 4px 14px rgba(0,0,0,.18);padding:10px;width:min(340px,92vw);
    direction:rtl;text-align:right;font-family:inherit}
  .yvm-pop textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;font-family:inherit;
    font-size:13px;direction:rtl;text-align:right;border:1px solid #ccc;border-radius:6px;padding:6px}
  .yvm-pop .yvm-pop-title{font-size:12px;color:#7a6a10;margin-bottom:6px;font-weight:bold}
  .yvm-pop .yvm-pop-actions{margin-top:8px;display:flex;gap:8px;justify-content:flex-start}
  .yvm-pop button{padding:3px 14px;font-size:12px;border-radius:6px;border:1px solid #b09a2e;
    background:#f7edc0;color:#5c4f0a;cursor:pointer;font-family:inherit}
  .yvm-pop button.yvm-cancel{background:#fff;border-color:#bbb;color:#666}
  .yvm-pop .yvm-pop-err{color:#c00;font-size:12px;margin-top:6px;display:none}`;

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

  // ---- 💡 שיפור: הערה חופשית → POST /api/feedback/improve --------------------
  let openPop = null;
  function closePop() {
    if (openPop) { openPop.remove(); openPop = null; }
  }
  document.addEventListener('click', function (ev) {
    if (openPop && !openPop.contains(ev.target) && !(ev.target.classList && ev.target.classList.contains('yvm-imp'))) closePop();
  }, true);

  function sendImprove(pop, btn, payload) {
    const err = pop.querySelector('.yvm-pop-err');
    const sendBtn = pop.querySelector('.yvm-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '…';
    fetch(serverBase() + '/api/feedback/improve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function () {
        closePop();
        btn.classList.add('yvm-sent');
        btn.textContent = '✓ נשלח';
        btn.title = 'הערת השיפור נרשמה — תיבדק ותטופל על-ידי סוכן השיפורים';
      })
      .catch(function (e) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'שלח';
        err.textContent = 'השליחה נכשלה (' + e.message + ') — נסה שוב';
        err.style.display = 'block';
      });
  }

  function openImprovePop(btn, field, label, getValue) {
    closePop();
    const pop = document.createElement('div');
    pop.className = 'yvm-pop';
    pop.innerHTML =
      '<div class="yvm-pop-title">💡 הערת שיפור — מה כדאי לשפר בתוצאה או באופן ההצגה?</div>' +
      '<textarea placeholder="למשל: הכותר ארוך מדי; התאריך צריך להופיע לפני המקום; הטבלה נחתכת במסך"></textarea>' +
      '<div class="yvm-pop-err"></div>' +
      '<div class="yvm-pop-actions"><button type="button" class="yvm-send">שלח</button>' +
      '<button type="button" class="yvm-cancel">ביטול</button></div>';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left - 150, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    openPop = pop;
    const ta = pop.querySelector('textarea');
    ta.focus();
    pop.querySelector('.yvm-cancel').addEventListener('click', closePop);
    pop.querySelector('.yvm-send').addEventListener('click', function () {
      const note = ta.value.trim();
      if (!note) { ta.focus(); return; }
      sendImprove(pop, btn, {
        screen: CFG.screen,
        item: itemId(),
        source: sourceName(),
        field: field,
        label: label,
        value: String(getValue() == null ? '' : getValue()).slice(0, 4000),
        note: note.slice(0, 4000),
      });
    });
  }

  // ---- ✓ נכון: אישור חיובי בלחיצה אחת → POST /api/feedback/confirm ----------
  function makeConfirmBtn(field, label, getValue) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yvm-btn yvm-ok';
    b.textContent = '✓ נכון';
    b.title = 'אשר שהשדה קוטלג נכון — המערכת לומדת מה עובד ושומרת על הסגנון';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (b.classList.contains('yvm-sent')) return;
      b.disabled = true;
      b.textContent = '…';
      fetch(serverBase() + '/api/feedback/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen: CFG.screen,
          item: itemId(),
          source: sourceName(),
          field: field,
          label: label,
          value: String(getValue() == null ? '' : getValue()).slice(0, 4000),
        }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function () {
          b.classList.remove('yvm-err');
          b.classList.add('yvm-sent');
          b.textContent = '✓ אושר';
          b.title = 'האישור נרשם — המערכת יודעת שהחלק הזה עובד';
          b.disabled = false;
        })
        .catch(function (err) {
          b.disabled = false;
          b.classList.add('yvm-err');
          b.textContent = '✓ נכון';
          b.title = 'השליחה נכשלה (' + err.message + ') — לחץ לניסיון חוזר';
        });
    });
    return b;
  }

  function makeImproveBtn(field, label, getValue) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yvm-btn yvm-imp';
    b.textContent = '💡 שיפור';
    b.title = 'כתוב הערת שיפור על התוצאה או אופן ההצגה — תיבדק ותטופל אוטומטית';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (openPop) { closePop(); return; }
      openImprovePop(b, field, label, getValue);
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
    const labelText = lab ? lab.textContent.trim().slice(0, 120) : el.id;
    const getVal = function () { return el.value; };
    const btn = makeBtn(el.id, labelText, getVal);
    const imp = makeImproveBtn(el.id, labelText, getVal);
    const ok = makeConfirmBtn(el.id, labelText, getVal);
    if (lab) { lab.appendChild(btn); lab.appendChild(imp); lab.appendChild(ok); }
    else { el.insertAdjacentElement('beforebegin', btn); btn.insertAdjacentElement('afterend', imp); imp.insertAdjacentElement('afterend', ok); }
  }

  // דפוס ב' (documents-tik): שדות נבנים דינמית — .field > .head (label+copy) + .body[id].
  function attachTikField(head) {
    const field = head.parentElement;
    const body = field ? field.querySelector(':scope > .body[id]') : null;
    if (!body || seen.has(head)) return;
    seen.add(head);
    const labEl = head.querySelector('.label');
    const labelText = labEl ? labEl.textContent.trim().slice(0, 120) : body.id;
    const getVal = function () { return (body.innerText || body.textContent || '').slice(0, 4000); };
    head.appendChild(makeBtn(body.id, labelText, getVal));
    head.appendChild(makeImproveBtn(body.id, labelText, getVal));
    head.appendChild(makeConfirmBtn(body.id, labelText, getVal));
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
