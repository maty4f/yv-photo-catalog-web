/* graph.html — the entity graph inside the catalog (tiks · photos · people · places).
   Data: GET /api/graph (built server-side by `yv doc graph` from the tik records + the
   cross-item wiki). Rendering: force-graph (canvas). No Flowsint, no Neo4j.
   House rules: an edge exists only where a record / wiki page states it; a low
   reading-confidence is drawn grey, a perished person gets a red ring; nothing here
   writes anywhere — the screen is a view. */
const $ = id => document.getElementById(id);
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* server base — same convention/localStorage key as the other screens */
function computeDefaultServerUrl(){
  if (/^https?:$/.test(location.protocol) && !/\.(pages\.dev|github\.io)$/.test(location.hostname)) return location.origin;
  return '';
}
const serverUrlInput = $('server-url');
serverUrlInput.value = (window.yvServerBase ? yvServerBase()
  : (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '') || computeDefaultServerUrl());
serverUrlInput.addEventListener('change', () => {
  localStorage.setItem('yv_local_server_url', serverUrlInput.value.trim().replace(/\/$/, ''));
  load();
});
function serverBase(){
  return window.yvServerBase ? yvServerBase({ inputEl: serverUrlInput })
       : (serverUrlInput.value || '').trim().replace(/\/$/, '');
}
const COLLECTION = (new URLSearchParams(location.search).get('collection') || '').replace(/[^a-z0-9_-]/gi, '');
const withCollection = p => COLLECTION ? p + (p.includes('?') ? '&' : '?') + 'collection=' + encodeURIComponent(COLLECTION) : p;
const api = p => (serverBase() ? serverBase() + p : p);

/* ---------- vocabulary ---------- */
const KINDS = ['collection', 'tik', 'photo', 'film', 'doc', 'item', 'person', 'place', 'subject', 'year', 'org'];
const TYPE_OF = id => { const k = id.split(':')[0]; return KINDS.includes(k) ? k : 'place'; };
const TYPE_HE = { collection: 'אוסף', tik: 'תיק', photo: 'תצלום', film: 'סרט', doc: 'מסמך', item: 'פריט', person: 'אדם', place: 'מקום', subject: 'נושא', year: 'שנה', org: 'ארגון' };
const COLOR = { collection: '#ffffff', tik: '#b083ff', photo: '#f2b13d', film: '#4c90ff', doc: '#35d189', item: '#c9a6ff', person: '#ff8fb1', place: '#35d189', subject: '#4c90ff', year: '#8993a8', org: '#ff6b6b' };
const HUB_KINDS = new Set(['collection', 'tik', 'photo', 'film', 'doc', 'item', 'place', 'subject', 'year', 'org']);   // level "מוקדים": no people, no photos
const WIKI_DIR_OF = { collection: 'collections', tik: 'tiks', photo: 'photos', film: 'films', doc: 'docs', item: 'items', person: 'people', place: 'places', subject: 'subjects', year: 'events', org: 'organizations' };
const CONF_HE = { high: '✓ גבוהה', mid: '~ בינונית', medium: '~ בינונית', low: '? נמוכה' };
/* edge label → how it reads from the SOURCE side / from the TARGET side */
const REL = {
  MENTIONS:          ['מזכיר את', 'מוזכר ב'],
  TESTIMONY_OF:      ['עדות של', 'העיד/ה ב'],
  DEPICTS:           ['מתעד את', 'מופיע/ה בתצלום'],
  MENTIONS_PLACE:    ['מקום מוזכר', 'מוזכר ב'],
  TAKEN_AT:          ['צולם ב', 'תצלומים מהמקום'],
  ASSOCIATED_WITH:   ['קשור/ה למקום', 'אנשים קשורים'],
  IN_COLLECTION:     ['באוסף', 'תיקים באוסף'],
  HAS_SUBJECT:       ['נושא', 'תיקים בנושא'],
  DATED:             ['מתוארך ל', 'תיקים מהשנה'],
  MENTIONS_ORG:      ['מזכיר ארגון', 'מוזכר ב'],
  PASSED_THROUGH:    ['עבר/ה דרך', 'עברו דרכו'],
  PERISHED_AT:       ['נספה/תה ב', 'נספו במקום'],
  REPORTED_DEATH_OF: ['דיווח/ה על מותו/ה של', 'מותו/ה דווח על-ידי'],
};
const PROP_HE = {
  full_name: 'שם', aliases: 'כתיבים נוספים', category: 'סיווג', roles: 'תפקיד', birth_date: 'לידה', death_date: 'פטירה',
  fate: 'גורל', cause_of_death: 'נסיבות', confidence: 'ודאות', title: 'כותר', description: 'כותר (אנגלית)',
  archive_id: 'מס׳ ארכיון', source: 'קובץ מקור', created_date: 'תקופה', language: 'שפות', subject: 'נושאים',
  page_count: 'עמודים', tik_kind: 'סוג תיק', name_he: 'שם עברי', country: 'מדינה', place_type: 'סוג מקום',
  wikidata: 'Wikidata', doc_type: 'סוג פריט', origin: 'מקור הנתון',
};
const CATEGORY_HE = { jew: 'יהודי/ה', perpetrator: 'גרמני/משתף-פעולה', other: 'אחר' };
const HIDE_PROPS = new Set(['catalog_id', 'address', 'city', 'output', 'wiki_page', 'viewer']);

/* ---------- state ---------- */
const state = { nodes: [], edges: [], byId: new Map(), adj: new Map(), focus: null, selected: null, fg: null, shown: new Set() };

function degreeOf(id){ return (state.adj.get(id) || []).length; }
function levelHubs(){ return $('level').value === 'hubs'; }
function typeOn(t){
  const el = $('t-' + (['film', 'doc', 'item'].includes(t) ? 'tik' : t));
  if (levelHubs() && !state.focus) return HUB_KINDS.has(t) && (!el || el.checked);
  return el ? el.checked : true;
}

/* Which nodes are drawn: type filters ∩ (focus neighbourhood | bridging filter). Capped
   for the canvas — the whole archive is thousands of nodes; focus is the real tool. */
const CAP = 2500;          // focus neighbourhood
const OVERVIEW_CAP = 600;  // no focus: the most-connected entities only — the whole archive is a hairball
function visibleIds(){
  let ids;
  if (state.focus && state.byId.has(state.focus)) {
    const depth = Number($('depth').value) || 1;
    ids = new Set([state.focus]);
    let frontier = [state.focus];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const id of frontier) for (const e of state.adj.get(id) || []) {
        const o = e.source === id ? e.target : e.source;
        if (!ids.has(o)) { ids.add(o); next.push(o); }
      }
      frontier = next;
      if (ids.size > CAP) break;
    }
  } else {
    const bridging = $('bridging').checked;
    ids = new Set(state.nodes.filter(n => !bridging || n.t !== 'person' || n.deg >= 2).map(n => n.id));
  }
  let out = [...ids].filter(id => typeOn(TYPE_OF(id)));
  if (!state.focus) {
    // without a focus, keep items only when they touch a shown entity — a bare tik ring says nothing
    const ent = new Set(out.filter(id => !['tik', 'photo', 'film', 'doc', 'item'].includes(TYPE_OF(id))));
    out = out.filter(id => ent.has(id) || (state.adj.get(id) || []).some(e => ent.has(e.source === id ? e.target : e.source)));
  }
  const cap = state.focus ? CAP : OVERVIEW_CAP;
  if (out.length > cap) out = out.sort((a, b) => degreeOf(b) - degreeOf(a)).slice(0, cap);
  return new Set(out);
}

function render(){
  const ids = visibleIds();
  state.shown = ids;
  const nodes = state.nodes.filter(n => ids.has(n.id));
  const links = state.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ source: e.source, target: e.target, label: e.label }));
  $('stats').textContent = `${levelHubs() && !state.focus ? 'רמת מוקדים · ' : ''}מוצגים ${nodes.length.toLocaleString('he')} מתוך ${state.nodes.length.toLocaleString('he')} צמתים · ${links.length.toLocaleString('he')} קשרים` + (state.focus ? ` · ${crumbs(state.focus)}` : '');
  $('hint').style.display = nodes.length ? 'none' : 'flex';
  if (!nodes.length) $('hint').textContent = 'אין מה להציג עם המסננים הנוכחיים.';
  if (!state.focus && ids.size >= OVERVIEW_CAP) $('stats').textContent += ' · סקירה: המקושרים ביותר — חפשו ישות כדי להתמקד';
  state.fg.graphData({ nodes, links });
  if (state.focus) setTimeout(() => state.fg.zoomToFit(400, 40), 500);
}

function crumbs(id){
  // collection › hub (place/subject/year) › entity — read from the focused node's edges
  const n = state.byId.get(id); const parts = [];
  const coll = COLLECTION ? COLLECTION.toUpperCase() : (state.nodes.find(x => x.t === 'collection') || {}).label;
  if (coll) parts.push(coll);
  if (n.t === 'person' || n.t === 'tik') {
    const hub = (state.adj.get(id) || []).map(e => state.byId.get(e.source === id ? e.target : e.source)).find(o => o && (o.t === 'place' || o.t === 'subject'));
    if (hub) parts.push(hub.label);
  }
  parts.push(n.label);
  return parts.join(' › ');
}
/* ---------- drawing ---------- */
function initGraph(){
  const box = $('graph'), el = $('canvas');   // the library owns #canvas; hint + legend stay siblings
  const fg = ForceGraph()(el)
    .width(box.clientWidth).height(box.clientHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .nodeId('id')
    .nodeLabel(n => `${esc(n.label)} · ${TYPE_HE[n.t]}${n.data.confidence ? ' · ' + CONF_HE[n.data.confidence] : ''}`)
    .nodeVal(n => ['tik', 'photo', 'film', 'doc', 'item'].includes(n.t) ? 3 : 2 + Math.min(14, n.deg))
    .nodeCanvasObject((n, ctx, scale) => {
      const r = Math.sqrt(Math.max(1, ['tik', 'photo', 'film', 'doc', 'item'].includes(n.t) ? 3 : 2 + Math.min(14, n.deg))) * 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      const low = n.data.confidence === 'low';
      ctx.fillStyle = low ? '#6b7280' : COLOR[n.t];
      ctx.fill();
      if (n.data.is_deceased) { ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = '#ff6b6b'; ctx.stroke(); }
      if (n.id === state.selected || n.id === state.focus) { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      if (scale > 1.6 || n.id === state.selected || n.id === state.focus) {
        const fs = Math.max(3, 11 / scale);
        ctx.font = `${fs}px Heebo, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#eef1f7';
        ctx.fillText(n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label, n.x, n.y + r + 1);
      }
    })
    .nodePointerAreaPaint((n, color, ctx) => { ctx.beginPath(); ctx.arc(n.x, n.y, 6, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); })
    .linkColor(() => 'rgba(137,147,168,.35)')
    .linkWidth(l => (state.selected && (l.source.id === state.selected || l.target.id === state.selected)) ? 2 : 0.6)
    .linkDirectionalArrowLength(3).linkDirectionalArrowRelPos(1)
    .linkLabel(l => esc((REL[l.label] || [l.label])[0]))
    .onNodeRightClick(n => focus(n.id))
    .onBackgroundClick(() => { state.selected = null; $('panel').innerHTML = '<div class="empty">לחיצה על צומת מציגה פרטים, קשרים ודף-ויקי.<br>לחיצה כפולה ממקדת את הגרף סביבו.</div>'; });
  let lastClick = { id: null, t: 0 };
  fg.onNodeClick(n => {
    const now = Date.now();
    if (lastClick.id === n.id && now - lastClick.t < 400) focus(n.id); else select(n.id);
    lastClick = { id: n.id, t: now };
  });
  fg.d3Force('charge').strength(-40);
  window.addEventListener('resize', () => fg.width(box.clientWidth).height(box.clientHeight));
  state.fg = fg;
}

/* ---------- side panel ---------- */
function focus(id){ state.focus = id; state.selected = id; render(); showPanel(id); }
function select(id){ state.selected = id; showPanel(id); }   /* the canvas re-reads state.selected every frame */

function outputLink(n){
  const out = n.data.output;
  if (out) return `<a class="ext" href="${esc(api('/api/output/' + encodeURIComponent(out)))}" target="_blank" rel="noopener">פתח את רשומת התיק ↗</a>`;
  if (n.data.viewer) return `<a class="ext" href="${esc(n.data.viewer)}" target="_blank" rel="noopener">פתח בקטלוג האוסף ↗</a>`;
  return '';
}

function showPanel(id){
  const n = state.byId.get(id); if (!n) return;
  const d = n.data || {};
  let html = `<h2>${esc(n.label)}</h2><span class="badge" style="background:${COLOR[n.t]}">${TYPE_HE[n.t]}</span>`;
  if (d.confidence) html += `<span class="conf-${esc(d.confidence)}">ודאות: ${CONF_HE[d.confidence] || esc(d.confidence)}</span>`;
  if (d.is_deceased) html += ` <span style="color:#ff6b6b">✝ נספה/תה</span>`;
  html += '<dl>';
  for (const [k, v] of Object.entries(d)) {
    if (HIDE_PROPS.has(k) || k === 'confidence' || k === 'is_deceased' || v == null || v === '') continue;
    let val = Array.isArray(v) ? v.map(esc).join(' · ') : esc(v);
    if (k === 'category') val = esc(CATEGORY_HE[v] || v);
    if (k === 'wikidata') val = `<a class="ext" href="https://www.wikidata.org/wiki/${esc(v)}" target="_blank" rel="noopener">${esc(v)} ↗</a>`;
    html += `<dt>${esc(PROP_HE[k] || k)}</dt><dd>${val}</dd>`;
  }
  html += '</dl>';
  html += outputLink(n);
  /* neighbours grouped by relation, read from this node's side */
  const groups = new Map();
  for (const e of state.adj.get(id) || []) {
    const out = e.source === id;
    const other = out ? e.target : e.source;
    const key = (REL[e.label] || [e.label, e.label])[out ? 0 : 1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(other);
  }
  for (const [key, others] of groups) {
    html += `<h3>${esc(key)} (${others.length})</h3>`;
    others.sort((a, b) => degreeOf(b) - degreeOf(a));
    for (const o of others.slice(0, 60)) {
      const on = state.byId.get(o);
      html += `<a class="nb" data-id="${esc(o)}"><span style="color:${COLOR[on.t]}">●</span> ${esc(on.label)}${on.data.confidence === 'low' ? ' <small>(?)</small>' : ''}${on.data.is_deceased ? ' <small style="color:#ff6b6b">✝</small>' : ''}</a>`;
    }
    if (others.length > 60) html += `<div class="empty" style="padding:4px">… ועוד ${others.length - 60}</div>`;
  }
  html += `<div style="margin-top:12px"><button type="button" class="act primary" id="focus-btn">מקד סביב הצומת</button></div>`;
  const wikiPage = d.wiki_page || (WIKI_DIR_OF[n.t] ? WIKI_DIR_OF[n.t] + '/' + (['tik', 'photo', 'film', 'doc', 'item'].includes(n.t) ? slugOf(id.slice(id.indexOf(':') + 1)) : n.t === 'year' ? id.slice(5) : slugOf(n.label)) + '.md' : '');
  if (wikiPage) html += `<div style="margin-top:8px"><a class="ext" href="wiki.html?page=${encodeURIComponent(wikiPage)}${COLLECTION ? '&collection=' + encodeURIComponent(COLLECTION) : ''}">פתח בדפדפן-הוויקי ↗</a></div><h3>דף ויקי — ${esc(wikiPage)}</h3><div class="wiki" id="wiki">טוען…</div>`;
  $('panel').innerHTML = html;
  $('focus-btn').onclick = () => focus(id);
  $('panel').querySelectorAll('.nb').forEach(a => a.onclick = () => { const t = a.dataset.id; if (state.shown.has(t)) select(t); else focus(t); });
  if (wikiPage) loadWiki(wikiPage);
}
function slugOf(name){ return String(name || '').replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\s+/g, '-'); }

/* markdown → HTML: the shared safe renderer (yv-wikimd.js); [[links]] open wiki.html */
function mdToHtml(md){ return window.yvWikiMd ? yvWikiMd(md, { outputUrl: f => api('/api/output/' + encodeURIComponent(f)), pageHref: rel => 'wiki.html?page=' + encodeURIComponent(rel + '.md') + (COLLECTION ? '&collection=' + encodeURIComponent(COLLECTION) : '') }) : esc(md); }
async function loadWiki(page){
  try {
    const r = await fetch(api('/api/graph/wiki?page=' + encodeURIComponent(page)));
    if (!r.ok) throw new Error(r.status);
    const el = $('wiki'); if (el) el.innerHTML = mdToHtml(await r.text());
  } catch (e) { const el = $('wiki'); if (el) el.textContent = 'דף הוויקי לא נטען (' + e.message + ')'; }
}

/* ---------- import any archival source: analyze → mapping editor → import ---------- */
const ROLE_HE = { item_id: 'מזהה פריט', person: 'אדם', person_original: 'כתיב מקורי', role: 'תפקיד', birth: 'לידה', death: 'פטירה', place: 'מקום', fate: 'גורל', date: 'תאריך', subject: 'נושא', org: 'ארגון', title: 'כותר', pages: 'עמודים', text: 'טקסט', ignore: 'התעלם' };
let pendingImport = null;
$('import-file').addEventListener('change', async () => {
  const f = $('import-file').files[0]; if (!f) return;
  $('stats').textContent = 'מנתח את הקובץ…';
  const fd = new FormData(); fd.append('file', f);
  try {
    const r = await fetch(api('/api/graph/analyze'), { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    pendingImport = { file: f, analysis: j };
    showImportPanel(j, f.name);
    $('stats').textContent = 'ניתוח הושלם — בדקו את המיפוי ולחצו «צור אוסף»';
  } catch (e) { $('stats').textContent = 'הניתוח נכשל: ' + e.message; }
  $('import-file').value = '';
});
function showImportPanel(j, fname){
  const src = (j.sources || [])[0] || {};
  let html = `<h2>📥 ייבוא: ${esc(fname)}</h2><div style="color:var(--muted);font-size:12.5px;white-space:pre-wrap">${esc(j.summary_he || '')}</div>`;
  html += `<dl><dt>סוג</dt><dd>${esc(src.kind || '')}</dd>${src.rows != null ? `<dt>שורות</dt><dd>${src.rows}</dd>` : ''}</dl>`;
  if (src.columns) {
    html += '<h3>עמודה → תפקיד (ניתן לשנות)</h3><table style="width:100%;font-size:12.5px;border-collapse:collapse">';
    for (const c of src.columns) {
      html += `<tr><td style="padding:3px 4px;border-bottom:1px solid var(--line)"><b>${esc(c.name)}</b><br><small style="color:var(--muted)">${esc((c.samples || []).join(' · '))}</small></td><td style="padding:3px 4px;border-bottom:1px solid var(--line)"><select class="act map-role" data-col="${esc(c.name)}">` +
        Object.entries(ROLE_HE).map(([k, l]) => `<option value="${k}"${k === c.role ? ' selected' : ''}>${l}</option>`).join('') +
        `</select><br><small class="${c.confidence === 'high' ? 'conf-high' : c.confidence === 'mid' ? 'conf-mid' : 'conf-low'}">${esc(c.why || '')}</small></td></tr>`;
    }
    html += '</table>';
  }
  html += `<div style="margin-top:10px"><label>שם האוסף <input id="import-name" class="act" style="width:180px;direction:ltr" placeholder="latin-name" value="${esc(fname.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'))}"></label></div>`;
  html += `<div style="margin-top:8px"><button type="button" class="act primary" id="import-go">צור אוסף וגרף</button> <span class="msg" id="import-msg"></span></div>`;
  $('panel').innerHTML = html;
  $('import-go').onclick = doImport;
}
async function doImport(){
  if (!pendingImport) return;
  const name = $('import-name').value.trim();
  const mapping = {}; $('panel').querySelectorAll('.map-role').forEach(s => { mapping[s.dataset.col] = s.value; });
  const fd = new FormData(); fd.append('file', pendingImport.file); fd.append('name', name); fd.append('mapping', JSON.stringify({ [pendingImport.file.name]: mapping }));
  $('import-msg').textContent = 'מייבא ובונה…';
  try {
    const r = await fetch(api('/api/graph/import'), { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    location.href = 'graph.html?collection=' + encodeURIComponent(j.collection);
  } catch (e) { $('import-msg').textContent = 'נכשל: ' + e.message; }
}

/* ---------- search ---------- */
$('q').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const q = $('q').value.trim().toLowerCase();
  if (!q) return;
  // rank: exact label › label starts with › contains; at the hubs level a place/subject/
  // collection beats a person of the same rank (searching "טרבלינקה" should land on the camp)
  const rank = n => { const l = n.label.toLowerCase(); return l === q ? 3 : l.startsWith(q) ? 2 : l.includes(q) ? 1 : 0; };
  const hubBoost = n => (levelHubs() && HUB_KINDS.has(n.t)) ? 0.5 : 0;
  const hit = state.nodes.filter(n => rank(n) > 0).sort((a, b) => (rank(b) + hubBoost(b)) - (rank(a) + hubBoost(a)) || b.deg - a.deg)[0];
  if (hit) focus(hit.id); else $('stats').textContent = 'לא נמצא: ' + q;
});
['t-collection', 't-tik', 't-photo', 't-person', 't-place', 't-subject', 't-year', 't-org', 'bridging', 'depth', 'level'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', render); });
$('clear').onclick = () => { state.focus = null; $('q').value = ''; render(); };
$('rebuild').onclick = async () => {
  $('stats').textContent = 'בונה מחדש (רשומות + ויקי)…';
  try { const r = await fetch(api(withCollection('/api/graph/rebuild')), { method: 'POST' }); if (!r.ok) throw new Error(r.status); await load(); }
  catch (e) { $('stats').textContent = 'הבנייה נכשלה (' + e.message + ')'; }
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { state.selected = null; } });

/* ---------- load ---------- */
async function load(){
  $('hint').style.display = 'flex'; $('hint').textContent = 'טוען את הגרף…';
  try {
    const r = await fetch(api(withCollection('/api/graph')));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = await r.json();
    state.byId = new Map(); state.adj = new Map();
    state.nodes = (g.nodes || []).map(n => ({ id: n.id, label: n.label, t: TYPE_OF(n.id), data: n.data || {}, deg: 0 }));
    for (const n of state.nodes) { state.byId.set(n.id, n); state.adj.set(n.id, []); }
    state.edges = (g.edges || []).filter(e => state.byId.has(e.source) && state.byId.has(e.target));
    for (const e of state.edges) { state.adj.get(e.source).push(e); state.adj.get(e.target).push(e); }
    for (const n of state.nodes) n.deg = state.adj.get(n.id).length;
    if (!state.fg) initGraph();
    const st = g.stats || {};
    document.title = `גרף הישויות${COLLECTION ? ' — ' + COLLECTION.toUpperCase() : ''} — ${(st.nodes || state.nodes.length).toLocaleString('he')} צמתים`;
    if (COLLECTION) { const h = document.querySelector('h1'); if (h && !h.dataset.coll) { h.dataset.coll = '1'; h.textContent += ' — אוסף ' + COLLECTION.toUpperCase(); } }
    render();
    const fromHash = decodeURIComponent((location.hash || '').slice(1));
    if (fromHash && state.byId.has(fromHash)) focus(fromHash);
  } catch (e) {
    $('hint').style.display = 'flex';
    $('hint').innerHTML = `<div class="empty">הגרף לא נטען (${esc(e.message)}).<br>בנייה ידנית:<code>python3 cli/yv.py doc graph</code></div>`;
  }
}
load();
