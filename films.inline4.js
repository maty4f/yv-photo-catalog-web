yvFlow.init({ screen: 'films', backend: true, label: 'זרימת עיבוד:', options: [
  { value: 'auto', label: 'אוטומטי (מומלץ)', hint: 'Gemini לפריימים + גיבוי Qwen' },
  { value: 'nofallback', label: 'Gemini בלבד', hint: 'ללא גיבוי Qwen' },
  { value: 'consensus', label: 'אימות דו-מודלי', hint: 'Gemini + Claude קוראים כיתובים ומפייסים (איטי/יקר יותר)' },
] });

// רמת-הקטלוג של ציר-הזמן (20.10.2026): מה כל שורה בציר-הזמן מייצגת. נשלח כ-`level`
// בבקשה (העלאה / פריימים מהדפדפן / סרט מהשרת) → MF_FILM_LEVEL במנוע. ברירת-מחדל: סצנה.
(function () {
  var OPTS = [
    { value: 'scene', label: 'סצנה (ברירת-מחדל)', hint: 'רצף של 2–8 שוטים באותו מקום/פעולה' },
    { value: 'shot', label: 'שוט', hint: 'שורה לכל שוט — ציר-זמן מפורט מאוד' },
    { value: 'sequence', label: 'רצף', hint: 'אירוע או פרק שלם, 5–25 שוטים' },
    { value: 'intertitle', label: 'לפי כותרות-ביניים', hint: 'קטע בין שתי כותרות-ביניים (סרטים אילמים)' },
    { value: 'reel', label: 'סליל (מתומצת)', hint: '3–8 שורות לכל הסרט' },
  ];
  var KEY = 'mf_film_level';
  var host = document.querySelector('.yv-level-mount');
  if (!host) return;
  var wrap = document.createElement('div'); wrap.className = 'yv-flow';
  var lab = document.createElement('b'); lab.textContent = 'רמת-קטלוג:'; wrap.appendChild(lab);
  var sel = document.createElement('select'); sel.id = 'film-level';
  OPTS.forEach(function (o) { var op = document.createElement('option'); op.value = o.value; op.textContent = o.label; sel.appendChild(op); });
  var saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch (e) { /* storage blocked */ }
  sel.value = OPTS.some(function (o) { return o.value === saved; }) ? saved : 'scene';
  var hint = document.createElement('span'); hint.className = 'yv-flow-hint';
  function upd() {
    var o = OPTS.filter(function (x) { return x.value === sel.value; })[0];
    hint.textContent = (o && o.hint) ? ('— ' + o.hint) : '';
    try { localStorage.setItem(KEY, sel.value); } catch (e) { /* storage blocked */ }
  }
  sel.addEventListener('change', upd); upd();
  wrap.appendChild(sel); wrap.appendChild(hint); host.appendChild(wrap);
  window.yvFilmLevel = function () { return sel.value; };
})();

