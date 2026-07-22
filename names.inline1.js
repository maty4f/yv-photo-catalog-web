const $ = id => document.getElementById(id);
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }   // delegates to the ONE canonical escaper (review 21.7 #21); inline fallback covers pre-load calls

/* ---------- server base — same convention as photos/films/documents ----------
   The dashboard is normally served BY the API server (localhost in dev,
   films.mf-sr.com via the tunnel), so same-origin is the default. Off a static
   host (GitHub Pages) there is no backend at all, so the field stays empty and
   the user pastes a tunnel URL. Persisted under the SAME localStorage key the
   other screens use, so a URL typed there already fills in here. */
function computeDefaultServerUrl(){
  if (/^https?:$/.test(location.protocol) && !/\.(pages\.dev|github\.io)$/.test(location.hostname)) {
    return location.origin;
  }
  return '';
}
const serverUrlInput = $('server-url');
serverUrlInput.value = (window.yvServerBase ? yvServerBase()
  : (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '') || computeDefaultServerUrl());
serverUrlInput.addEventListener('input', () => {
  localStorage.setItem('yv_local_server_url', serverUrlInput.value.trim().replace(/\/$/, ''));
  load();
});
function serverBase(){
  // Canonical resolver (review 21.7 #21): adds the stored-URL/origin fallback
  // this screen previously lacked when the field was emptied.
  return window.yvServerBase ? yvServerBase({ inputEl: serverUrlInput })
       : (serverUrlInput.value || '').trim().replace(/\/$/, '');
}

/* ---------- state ---------- */
const state = { all: [], filtered: [], generated: null, tiks: 0, csvName: null };

function fillSelect(sel, values, label){
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(label)} — הכול</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (values.includes(cur)) sel.value = cur;
}

function normalize(s){
  // Case/nikud-insensitive-ish substring match: strip Hebrew niqqud + lowercase.
  return String(s || '').replace(/[֑-ׇ]/g, '').toLowerCase();
}

function applyFilters(){
  const q = normalize($('q').value.trim());
  const role = $('f-role').value, place = $('f-place').value, fate = $('f-fate').value;
  state.filtered = state.all.filter(r => {
    if (role && r.role !== role) return false;
    if (place && r.place !== place) return false;
    if (fate && r.fate !== fate) return false;
    if (q) {
      const hay = normalize([r.name, r.name_original, r.role, r.place, r.tik_title].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  render();
}

function outputUrl(name){
  const base = serverBase();
  const path = '/api/output/' + encodeURIComponent(name);
  return base ? base + path : path;
}

function render(){
  const tbody = $('rows');
  const rows = state.filtered;
  $('count-line').textContent = rows.length === state.all.length
    ? `${rows.length} שמות מ-${state.tiks} תיקים`
    : `${rows.length} מתוך ${state.all.length} שמות (מסונן)`;
  if (!rows.length) {
    $('table-area').innerHTML = '<div class="none">לא נמצאו שמות התואמים את החיפוש/הסינון</div>';
    return;
  }
  const trs = rows.map(r => {
    const nameCell = esc(r.name) + (r.name_original && r.name_original !== r.name
      ? ` <small dir="auto" style="unicode-bidi:isolate">(${esc(r.name_original)})</small>` : '');
    const tikCell = r.tik_output
      ? `<a href="${esc(outputUrl(r.tik_output))}" target="_blank" rel="noopener">${esc(r.tik_title || r.tik || r.tik_output)}</a>`
      : esc(r.tik_title || r.tik || '—');
    return `<tr>
      <td class="nm">${nameCell}</td>
      <td>${esc(r.role) || '—'}</td>
      <td>${esc(r.birth) || '—'}</td>
      <td>${esc(r.death) || '—'}</td>
      <td>${esc(r.place) || '—'}</td>
      <td>${esc(r.fate) || '—'}</td>
      <td>${esc(r.pages) || '—'}</td>
      <td class="tik">${tikCell}</td>
    </tr>`;
  }).join('');
  $('table-area').innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>שם</th><th>תפקיד</th><th>לידה</th><th>פטירה</th><th>מקום</th><th>גורל</th><th>עמודים</th><th>תיק</th></tr></thead>
    <tbody id="rows-body">${trs}</tbody>
  </table></div>`;
}

function uniqSorted(values){
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he'));
}

function renderApp(){
  $('app').innerHTML = `
    <div class="counters">
      <div class="tile"><div class="tn" id="c-names">—</div><div class="tl">שמות</div></div>
      <div class="tile"><div class="tn" id="c-tiks">—</div><div class="tl">תיקים</div></div>
      <div class="tile"><div class="tn" id="c-updated" style="font-size:13px">—</div><div class="tl">עודכן</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="field" style="flex:1"><label for="q">חיפוש (שם, כתיב מקורי, תפקיד, מקום, תיק)</label>
          <input type="text" id="q" placeholder="הקלד לחיפוש מיידי…" autocomplete="off"></div>
        <div class="field"><label for="f-role">תפקיד/קרבה</label><select id="f-role"></select></div>
        <div class="field"><label for="f-place">מקום</label><select id="f-place"></select></div>
        <div class="field"><label for="f-fate">גורל</label><select id="f-fate"></select></div>
        <button type="button" class="clear-btn" id="clear-filters">נקה סינון</button>
        <a class="dl disabled" id="csv-link" href="#" download>⇩ הורדת CSV</a>
      </div>
      <div class="count-line" id="count-line"></div>
      <div id="table-area"></div>
    </div>`;
  $('q').addEventListener('input', applyFilters);
  $('f-role').addEventListener('change', applyFilters);
  $('f-place').addEventListener('change', applyFilters);
  $('f-fate').addEventListener('change', applyFilters);
  $('clear-filters').addEventListener('click', () => {
    $('q').value = ''; $('f-role').value = ''; $('f-place').value = ''; $('f-fate').value = '';
    applyFilters();
  });
}

function renderEmptyState(reason){
  $('app').innerHTML = `<div class="card empty-state">
    <div class="big">⚠ מאגר השמות עדיין לא נבנה${reason ? ' (' + esc(reason) + ')' : ''}</div>
    <div>הרץ את פקודת האיסוף בשרת (קורא את כל תיאורי-התיק וכותב <code style="display:inline">names_index.json</code>):</div>
    <code>python3 cli/yv.py doc names</code>
    <div>לחלופין — דרך לוח הבקרה: קטלג תיקים במסך <a href="documents-tik.html" style="color:var(--accent)">קטלוג תיק</a>, ואז הרץ את הפקודה למעלה כדי לבנות/לרענן את המאגר.</div>
  </div>`;
}

async function load(){
  const base = serverBase();
  const url = (base || '') + '/api/output/names_index.json';
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    renderEmptyState('לא ניתן להגיע לשרת — בדוק כתובת שרת/tunnel');
    return;
  }
  if (res.status === 404) { renderEmptyState('הקובץ לא נמצא'); return; }
  if (!res.ok) { renderEmptyState('שגיאת שרת ' + res.status); return; }
  let data;
  try { data = await res.json(); } catch (e) { renderEmptyState('JSON לא תקין'); return; }
  const names = Array.isArray(data.names) ? data.names : [];
  state.all = names;
  state.filtered = names;
  state.tiks = data.tiks || 0;
  state.generated = data.generated || null;

  renderApp();
  $('c-names').textContent = names.length;
  $('c-tiks').textContent = state.tiks;
  $('c-updated').textContent = state.generated ? new Date(state.generated).toLocaleString('he-IL') : '—';

  fillSelect($('f-role'), uniqSorted(names.map(n => n.role)), 'תפקיד');
  fillSelect($('f-place'), uniqSorted(names.map(n => n.place)), 'מקום');
  fillSelect($('f-fate'), uniqSorted(names.map(n => n.fate)), 'גורל');

  // CSV — the dated filename is stamped the moment `yv doc names` runs, same
  // moment as `generated` in the JSON, so derive it from there rather than
  // guessing today's date (the JSON can be older than "now"). /api/output only
  // lists .html files, so existence is checked with a direct HEAD on the name.
  const csvLink = document.querySelector('#csv-link');
  if (csvLink && state.generated) {
    const d = new Date(state.generated);
    if (!isNaN(d)) {
      const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      const guess = `names_index_${ymd}.csv`;
      try {
        const head = await fetch(outputUrl(guess), { method: 'HEAD', cache: 'no-store' });
        if (head.ok) {
          csvLink.href = outputUrl(guess);
          csvLink.classList.remove('disabled');
        }
      } catch (e) { /* CSV link stays disabled — not fatal */ }
    }
  }

  applyFilters();
}

load();
