yvFlow.init({ screen: 'films', backend: true, label: 'זרימת עיבוד:', options: [
  { value: 'auto', label: 'אוטומטי (מומלץ)', hint: 'Gemini לפריימים + גיבוי Qwen' },
  { value: 'nofallback', label: 'Gemini בלבד', hint: 'ללא גיבוי Qwen' },
  { value: 'consensus', label: 'אימות דו-מודלי', hint: 'Gemini + Claude קוראים כיתובים ומפייסים (איטי/יקר יותר)' },
] });

// רמת-הקטלוג של ציר-הזמן (20.10.2026; שילוב רמות 22.10.2026): מה כל שורה בציר-הזמן
// מייצגת. אפשר לסמן כמה רמות — אז ציר-הזמן מדורג: שורות הרמה הגסה מכילות את שורות הרמה
// העדינה. נשלח כ-`level` ("scene,shot") → MF_FILM_LEVEL במנוע. ברירת-מחדל: סצנה.
(function () {
  var OPTS = [
    { value: 'reel', label: 'סליל', hint: '3–8 שורות לכל הסרט (מתומצת)' },
    { value: 'intertitle', label: 'כותרות-ביניים', hint: 'קטע בין שתי כותרות-ביניים (סרטים אילמים)' },
    { value: 'sequence', label: 'רצף', hint: 'אירוע או פרק שלם, 5–25 שוטים' },
    { value: 'scene', label: 'סצנה', hint: 'רצף של 2–8 שוטים באותו מקום/פעולה (ברירת-מחדל)' },
    { value: 'shot', label: 'שוט', hint: 'שורה לכל שוט — ציר-זמן מפורט מאוד' },
  ];
  var KEY = 'mf_film_level';
  var host = document.querySelector('.yv-level-mount');
  if (!host) return;
  var wrap = document.createElement('div'); wrap.className = 'yv-flow';
  var lab = document.createElement('b'); lab.textContent = 'רמת פירוט ציר-הזמן:'; wrap.appendChild(lab);
  var saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch (e) { /* storage blocked */ }
  var savedSet = {};
  saved.split(/[,+ ]+/).forEach(function (t) { if (t) savedSet[t] = true; });
  if (!OPTS.some(function (o) { return savedSet[o.value]; })) savedSet = { scene: true };
  var boxes = [];
  OPTS.forEach(function (o) {
    var l = document.createElement('label');
    l.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-inline-start:6px;cursor:pointer';
    l.title = o.hint;
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = o.value; cb.checked = !!savedSet[o.value];
    cb.className = 'film-level-cb';
    l.appendChild(cb); l.appendChild(document.createTextNode(o.label));
    wrap.appendChild(l); boxes.push(cb);
  });
  var hint = document.createElement('span'); hint.className = 'yv-flow-hint';
  function current() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
  function upd(ev) {
    var cur = current();
    if (!cur.length) {            // at least one level — re-check the one just cleared
      if (ev && ev.target) ev.target.checked = true;
      cur = current();
    }
    hint.textContent = cur.length > 1
      ? '— ציר-זמן מדורג: ' + cur.map(function (v) { return OPTS.filter(function (o) { return o.value === v; })[0].label; }).join(' ← ') + ' (שלב-1 רץ פעם לכל רמה)'
      : '— ' + (OPTS.filter(function (o) { return o.value === cur[0]; })[0] || {}).hint;
    try { localStorage.setItem(KEY, cur.join(',')); } catch (e) { /* storage blocked */ }
  }
  boxes.forEach(function (b) { b.addEventListener('change', upd); });
  upd();
  wrap.appendChild(hint); host.appendChild(wrap);
  window.yvFilmLevel = function () { return current().join(','); };
})();
