const $ = id => document.getElementById(id);
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }   // delegates to the ONE canonical escaper (review 21.7 #21); inline fallback covers pre-load calls

/* server base — same convention/localStorage key as names/photos/films/documents */
function computeDefaultServerUrl(){
  if (/^https?:$/.test(location.protocol) && !/\.(pages\.dev|github\.io)$/.test(location.hostname)) return location.origin;
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
  // Canonical resolver (review 21.7 #21) — adds stored/origin fallback.
  return window.yvServerBase ? yvServerBase({ inputEl: serverUrlInput })
       : (serverUrlInput.value || '').trim().replace(/\/$/, '');
}
function outputUrl(name){
  const base = serverBase();
  const path = '/api/output/' + encodeURIComponent(name);
  return base ? base + path : path;
}

/* ---------- state ---------- */
const state = { people: [], places: [], tab: 'people', q: '' };

function normalize(s){ return String(s || '').replace(/[֑-ׇ]/g, '').toLowerCase(); }

/* Group flat names_index records into cross-tik entities.
   Entity key = exact display name — fusing near-duplicates stays the names-DB
   typists' judgment (never-invent), same rule as the CSV and the wiki ingest. */
function buildEntities(records){
  const people = new Map(), places = new Map();
  for (const r of records) {
    const nm = (r.name || r.name_original || '').trim();
    if (nm) {
      const e = people.get(nm) || { name: nm, alt: new Set(), tiks: new Map(), role: new Set(),
                                    birth: new Set(), death: new Set(), place: new Set(), fate: new Set() };
      if (r.name_original && r.name_original !== nm) e.alt.add(r.name_original);
      ['role','birth','death','place','fate'].forEach(f => { if ((r[f]||'').trim()) e[f].add(r[f].trim()); });
      if (r.tik) e.tiks.set(r.tik, { title: r.tik_title || r.tik, output: r.tik_output || '' });
      people.set(nm, e);
    }
    const pl = (r.place || '').trim();
    if (pl) {
      const p = places.get(pl) || { name: pl, tiks: new Map(), persons: new Set() };
      if (r.tik) p.tiks.set(r.tik, { title: r.tik_title || r.tik, output: r.tik_output || '' });
      if (nm) p.persons.add(nm);
      places.set(pl, p);
    }
  }
  // linked = bridges ≥2 tiks
  const linkedPeople = [...people.values()].filter(e => e.tiks.size >= 2)
    .sort((a,b) => b.tiks.size - a.tiks.size || a.name.localeCompare(b.name, 'he'));
  const linkedPlaces = [...places.values()].filter(p => p.tiks.size >= 2)
    .sort((a,b) => b.tiks.size - a.tiks.size || a.name.localeCompare(b.name, 'he'));
  return { linkedPeople, linkedPlaces };
}

/* one distinct value → plain; several → ⚠ joined (conflict surfaced, not merged) */
function joinVals(set){
  const vals = [...set];
  if (!vals.length) return '—';
  if (vals.length === 1) return esc(vals[0]);
  return '<span class="conflict">⚠ ' + vals.map(esc).join(' / ') + '</span>';
}
function tikLinks(tiks){
  return [...tiks.values()].map(t =>
    t.output ? `<a href="${esc(outputUrl(t.output))}" target="_blank" rel="noopener">${esc(t.title)}</a>`
             : esc(t.title)).join('');
}

function render(){
  const q = normalize(state.q);
  const area = $('table-area'); if (!area) return;
  if (state.tab === 'people') {
    const rows = state.people.filter(e => !q ||
      normalize([e.name, ...e.alt, ...e.place, ...e.role].join(' ')).includes(q));
    $('count-line').textContent = `${rows.length} אנשים מקושרים (מופיעים ב-2+ תיקים)`;
    area.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>שם</th><th>תיקים</th><th>תפקיד</th><th>לידה</th><th>פטירה</th><th>מקום</th><th>גורל</th><th>התיקים המקושרים</th></tr></thead>
      <tbody>` + rows.map(e => `<tr>
        <td class="nm">${esc(e.name)}${e.alt.size ? ` <small dir="auto" style="unicode-bidi:isolate">(${[...e.alt].map(esc).join(' · ')})</small>` : ''}</td>
        <td><span class="ntiks">${e.tiks.size}</span></td>
        <td>${joinVals(e.role)}</td><td>${joinVals(e.birth)}</td><td>${joinVals(e.death)}</td>
        <td>${joinVals(e.place)}</td><td>${joinVals(e.fate)}</td>
        <td class="tik">${tikLinks(e.tiks)}</td>
      </tr>`).join('') + `</tbody></table></div>`
      : '<div class="none">אין עדיין אנשים המופיעים ביותר מתיק אחד' + (q ? ' התואמים את החיפוש' : '') + '</div>';
  } else {
    const rows = state.places.filter(p => !q || normalize(p.name).includes(q));
    $('count-line').textContent = `${rows.length} מקומות מקושרים (מופיעים ב-2+ תיקים)`;
    area.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>מקום</th><th>תיקים</th><th>אנשים קשורים</th><th>התיקים המקושרים</th></tr></thead>
      <tbody>` + rows.map(p => `<tr>
        <td class="nm">${esc(p.name)}</td>
        <td><span class="ntiks">${p.tiks.size}</span></td>
        <td>${[...p.persons].slice(0,8).map(esc).join(', ')}${p.persons.size > 8 ? ` (+${p.persons.size - 8})` : ''}</td>
        <td class="tik">${tikLinks(p.tiks)}</td>
      </tr>`).join('') + `</tbody></table></div>`
      : '<div class="none">אין עדיין מקומות המופיעים ביותר מתיק אחד' + (q ? ' התואמים את החיפוש' : '') + '</div>';
  }
}

function renderApp(meta){
  $('app').innerHTML = `
    <div class="counters">
      <div class="tile"><div class="tn" id="c-people">—</div><div class="tl">אנשים מקושרים</div></div>
      <div class="tile"><div class="tn" id="c-places">—</div><div class="tl">מקומות מקושרים</div></div>
      <div class="tile"><div class="tn" id="c-tiks">—</div><div class="tl">תיקים במאגר</div></div>
      <div class="tile"><div class="tn" id="c-updated" style="font-size:13px">—</div><div class="tl">עודכן</div></div>
    </div>
    <div class="card">
      <div class="tabs">
        <button type="button" class="tab active" id="tab-people">👤 אנשים</button>
        <button type="button" class="tab" id="tab-places">📍 מקומות</button>
      </div>
      <div class="toolbar">
        <input type="text" id="q" placeholder="חיפוש שם / מקום…" autocomplete="off">
      </div>
      <div class="count-line" id="count-line"></div>
      <div id="table-area"></div>
    </div>`;
  $('q').addEventListener('input', () => { state.q = $('q').value; render(); });
  $('tab-people').addEventListener('click', () => setTab('people'));
  $('tab-places').addEventListener('click', () => setTab('places'));
  $('c-people').textContent = state.people.length;
  $('c-places').textContent = state.places.length;
  $('c-tiks').textContent = meta.tiks || 0;
  $('c-updated').textContent = meta.generated ? new Date(meta.generated).toLocaleString('he-IL') : '—';
}
function setTab(t){
  state.tab = t;
  $('tab-people').classList.toggle('active', t === 'people');
  $('tab-places').classList.toggle('active', t === 'places');
  render();
}

function renderEmptyState(reason){
  $('app').innerHTML = `<div class="card empty-state">
    <div class="big">⚠ מאגר השמות עדיין לא נבנה${reason ? ' (' + esc(reason) + ')' : ''}</div>
    <div>מסך זה נבנה מ-<code style="display:inline">names_index.json</code> — הרץ בשרת:</div>
    <code>python3 cli/yv.py doc names</code>
    <div>ואז רענן. הישויות המקושרות נגזרות אוטומטית — כל אדם/מקום שמופיע ביותר מתיק אחד.</div>
  </div>`;
}

async function load(){
  const base = serverBase();
  let res;
  try { res = await fetch((base || '') + '/api/output/names_index.json', { cache: 'no-store' }); }
  catch (e) { renderEmptyState('לא ניתן להגיע לשרת — בדוק כתובת שרת/tunnel'); return; }
  if (res.status === 404) { renderEmptyState('הקובץ לא נמצא'); return; }
  if (!res.ok) { renderEmptyState('שגיאת שרת ' + res.status); return; }
  let data;
  try { data = await res.json(); } catch (e) { renderEmptyState('JSON לא תקין'); return; }
  const { linkedPeople, linkedPlaces } = buildEntities(Array.isArray(data.names) ? data.names : []);
  state.people = linkedPeople;
  state.places = linkedPlaces;
  renderApp({ tiks: data.tiks, generated: data.generated });
  render();
}

load();
