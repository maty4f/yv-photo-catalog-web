/* wiki.html — the knowledge-tree browser over the archive wiki.
   Tree: built client-side from the SAME graph JSON graph.html uses (/api/graph):
   collections → tiks → people/places/subjects; subjects → tiks; regions → places → tiks;
   years → tiks; organizations → tiks; bridging people. Page pane: the wiki page
   (markdown, rendered by yv-wikimd.js), "open in graph", "propose synthesis"
   (owner; a model call whose result lands in the review queue), and the queue itself. */
const $ = id => document.getElementById(id);
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function computeDefaultServerUrl(){ return (/^https?:$/.test(location.protocol) && !/\.(pages\.dev|github\.io)$/.test(location.hostname)) ? location.origin : ''; }
const serverUrlInput = $('server-url');
serverUrlInput.value = (window.yvServerBase ? yvServerBase() : (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '') || computeDefaultServerUrl());
serverUrlInput.addEventListener('change', () => { localStorage.setItem('yv_local_server_url', serverUrlInput.value.trim().replace(/\/$/, '')); load(); });
function serverBase(){ return window.yvServerBase ? yvServerBase({ inputEl: serverUrlInput }) : (serverUrlInput.value || '').trim().replace(/\/$/, ''); }
const api = p => (serverBase() ? serverBase() + p : p);
const PARAMS = new URLSearchParams(location.search);
const COLLECTION = (PARAMS.get('collection') || '').replace(/[^a-z0-9_-]/gi, '');
const withCollection = p => COLLECTION ? p + (p.includes('?') ? '&' : '?') + 'collection=' + encodeURIComponent(COLLECTION) : p;
if (COLLECTION) $('graph-link').href = 'graph.html?collection=' + encodeURIComponent(COLLECTION);
// Researcher mode (?mode=researcher): a reading view — the build / synthesis / review tools are hidden.
const RESEARCHER = PARAMS.get('mode') === 'researcher';
if (RESEARCHER) {
  ['hubs', 'proposals'].forEach(id => { const el = $(id); if (el) el.hidden = true; });
  $('mode-link').textContent = '✎ מצב מקטלג'; $('mode-link').href = 'wiki.html' + (COLLECTION ? '?collection=' + encodeURIComponent(COLLECTION) : '');
} else if (COLLECTION) { $('mode-link').href += '&collection=' + encodeURIComponent(COLLECTION); }

const KIND_HE = { collection: 'אוספים', tik: 'תיקים', photo: 'תצלומים', film: 'סרטים', doc: 'מסמכים', item: 'פריטים', person: 'אנשים מגשרים', place: 'מקומות', subject: 'נושאים', year: 'שנים', org: 'ארגונים', region: 'אזורים' };
const DIR_OF = { collection: 'collections', tik: 'tiks', photo: 'photos', film: 'films', doc: 'docs', item: 'items', person: 'people', place: 'places', subject: 'subjects', year: 'events', org: 'organizations' };
const state = { nodes: [], byId: new Map(), adj: new Map(), page: '', pageNode: null };
const kindOf = id => id.split(':')[0];
function slugOf(name){ return String(name || '').replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\s+/g, '-'); }
function neighbors(id, kinds, labels){
  const out = [];
  for (const e of state.adj.get(id) || []) {
    if (labels && !labels.includes(e.label)) continue;
    const o = e.source === id ? e.target : e.source;
    if (!kinds || kinds.includes(kindOf(o))) out.push(o);
  }
  return [...new Set(out)].sort((a, b) => (state.adj.get(b) || []).length - (state.adj.get(a) || []).length);
}
function pageOf(id){
  const n = state.byId.get(id); if (!n) return '';
  const k = kindOf(id);
  if (n.data.wiki_page) return n.data.wiki_page;
  if (['tik', 'photo', 'film', 'doc', 'item'].includes(k)) return `${DIR_OF[k]}/${slugOf(id.slice(id.indexOf(':') + 1))}.md`;
  if (k === 'year') return `events/${id.slice(5)}.md`;
  if (k === 'place') return `places/${slugOf(n.data.name_he || n.label)}.md`;
  return DIR_OF[k] ? `${DIR_OF[k]}/${slugOf(n.label)}.md` : '';
}

/* ---------- tree ---------- */
const CAP = 300;
function leaf(id, extra){
  const n = state.byId.get(id);
  return `<a class="leaf" data-id="${esc(id)}" data-page="${esc(pageOf(id))}">${esc(n.label)}${extra ? ` <small>${esc(extra)}</small>` : ''}</a>`;
}
function branch(title, ids, childFn, open){
  if (!ids.length) return '';
  const shown = ids.slice(0, CAP);
  return `<details${open ? ' open' : ''}><summary>${esc(title)} <span class="n">(${ids.length})</span></summary>` +
    shown.map(childFn).join('') + (ids.length > CAP ? `<div class="more">… ועוד ${ids.length - CAP} — השתמשו בחיפוש</div>` : '') + '</details>';
}
function tikBranch(id){
  const n = state.byId.get(id);
  const people = neighbors(id, ['person']), places = neighbors(id, ['place']), subj = neighbors(id, ['subject']);
  return `<details><summary>${leaf(id, n.data.created_date || '')}</summary>` +
    branch('אנשים', people, leaf) + branch('מקומות', places, leaf) + branch('נושאים', subj, leaf) + '</details>';
}
function buildTree(filter){
  const q = (filter || '').trim().toLowerCase();
  const all = state.nodes;
  const match = n => !q || n.label.toLowerCase().includes(q);
  if (q) {
    const hits = all.filter(match).sort((a, b) => (state.adj.get(b.id) || []).length - (state.adj.get(a.id) || []).length).slice(0, 400);
    $('tree').innerHTML = hits.length ? hits.map(n => leaf(n.id, KIND_HE[kindOf(n.id)] || '')).join('') : '<div class="empty">אין תוצאות</div>';
    bindTree(); return;
  }
  const colls = all.filter(n => kindOf(n.id) === 'collection').map(n => n.id);
  const ITEM = ['tik', 'photo', 'film', 'doc', 'item'];
  const tiksIn = new Set(colls.flatMap(c => neighbors(c, ITEM)));
  const looseTiks = all.filter(n => ITEM.includes(kindOf(n.id)) && !tiksIn.has(n.id)).map(n => n.id);
  const subjects = all.filter(n => kindOf(n.id) === 'subject').map(n => n.id);
  const years = all.filter(n => kindOf(n.id) === 'year').map(n => n.id).sort();
  const orgs = all.filter(n => kindOf(n.id) === 'org').map(n => n.id);
  const bridging = all.filter(n => kindOf(n.id) === 'person' && neighbors(n.id, ['tik', 'photo']).length >= 2).map(n => n.id);
  const regions = new Map();
  for (const n of all) if (kindOf(n.id) === 'place') { const c = n.data.country && n.data.country !== 'unknown' ? n.data.country : '— ללא אזור —'; if (!regions.has(c)) regions.set(c, []); regions.get(c).push(n.id); }
  let html = '';
  html += branch('אוספים', colls, c => `<details open><summary>${leaf(c)}</summary>` + neighbors(c, ITEM).slice(0, CAP).map(tikBranch).join('') + '</details>', true);
  html += branch('פריטים (ללא אוסף)', looseTiks, tikBranch);
  html += branch('נושאים', subjects, s => `<details><summary>${leaf(s)}</summary>${neighbors(s, ['tik']).slice(0, CAP).map(t => leaf(t)).join('')}</details>`);
  html += `<details><summary>אזורים ומקומות <span class="n">(${regions.size})</span></summary>` +
    [...regions.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, ids]) =>
      `<details><summary>${esc(c)} <span class="n">(${ids.length})</span></summary>${ids.slice(0, CAP).map(p => leaf(p, `${neighbors(p, ['tik']).length} תיקים`)).join('')}</details>`).join('') + '</details>';
  html += branch('שנים', years, y => `<details><summary>${leaf(y)}</summary>${neighbors(y, ['tik']).slice(0, CAP).map(t => leaf(t)).join('')}</details>`);
  html += branch('ארגונים', orgs, o => `<details><summary>${leaf(o)}</summary>${neighbors(o, ['tik']).slice(0, CAP).map(t => leaf(t)).join('')}</details>`);
  html += branch('אנשים מגשרים (≥2 פריטים)', bridging.sort((a, b) => neighbors(b, ['tik', 'photo']).length - neighbors(a, ['tik', 'photo']).length), p => leaf(p, `${neighbors(p, ['tik', 'photo']).length}`));
  $('tree').innerHTML = html || '<div class="empty">הגרף ריק — בנו מוקדים או קטלגו תיק</div>';
  bindTree();
}
function bindTree(){
  $('tree').querySelectorAll('.leaf').forEach(a => a.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); openPage(a.dataset.page, a.dataset.id); });
}

/* ---------- page ---------- */
function crumbs(page){
  const [dir, file] = page.split('/');
  const label = { collections: 'אוספים', tiks: 'תיקים', people: 'אנשים', places: 'מקומות', subjects: 'נושאים', events: 'שנים', organizations: 'ארגונים', regions: 'אזורים' }[dir] || dir;
  let html = `<a data-page="index.md">עץ הידע</a> › ${esc(label)}`;
  if (state.pageNode && ['tik', 'photo', 'film', 'doc', 'item'].includes(kindOf(state.pageNode))) {
    const coll = neighbors(state.pageNode, ['collection'])[0];
    if (coll) html += ` › <a data-page="${esc(pageOf(coll))}">${esc(state.byId.get(coll).label)}</a>`;
  }
  return html + ` › ${esc((file || '').replace(/\.md$/, ''))}`;
}
async function openPage(page, nodeId){
  if (!page) return;
  state.page = page; state.pageNode = nodeId || findNodeForPage(page);
  history.replaceState(null, '', 'wiki.html?page=' + encodeURIComponent(page) + (COLLECTION ? '&collection=' + encodeURIComponent(COLLECTION) : ''));
  $('tree').querySelectorAll('.leaf.on').forEach(a => a.classList.remove('on'));
  $('tree').querySelectorAll(`.leaf[data-page="${CSS.escape(page)}"]`).forEach(a => a.classList.add('on'));
  const el = $('page');
  el.innerHTML = `<div class="crumbs">${crumbs(page)}</div><div class="empty">טוען…</div>`;
  let md = '';
  try {
    const r = await fetch(api('/api/graph/wiki?page=' + encodeURIComponent(page)));
    if (!r.ok) throw new Error(r.status === 404 ? 'הדף עדיין לא נבנה — לחצו «בנה מוקדים»' : 'HTTP ' + r.status);
    md = await r.text();
  } catch (e) {
    el.innerHTML = `<div class="crumbs">${crumbs(page)}</div><div class="empty">${esc(e.message)}</div>` + actionsHtml(page);
    bindPage(); return;
  }
  el.innerHTML = `<div class="crumbs">${crumbs(page)}</div>` + actionsHtml(page) +
    yvWikiMd(md, { outputUrl: f => api('/api/output/' + encodeURIComponent(f)), pageHref: rel => 'wiki.html?page=' + encodeURIComponent(rel + '.md') + (COLLECTION ? '&collection=' + encodeURIComponent(COLLECTION) : '') });
  bindPage();
}
function findNodeForPage(page){
  const m = /^(collections|tiks|photos|films|docs|items|people|places|subjects|events|organizations)\/(.+)\.md$/.exec(page);
  if (!m) return null;
  const [, dir, stem] = m;
  const kind = { collections: 'collection', tiks: 'tik', photos: 'photo', films: 'film', docs: 'doc', items: 'item', people: 'person', places: 'place', subjects: 'subject', events: 'year', organizations: 'org' }[dir];
  const direct = state.byId.get(`${kind}:${stem}`); if (direct) return direct.id;
  const hit = state.nodes.find(n => kindOf(n.id) === kind && (slugOf(n.label) === stem || slugOf(n.data.name_he || '') === stem || n.data.wiki_page === page));
  return hit ? hit.id : null;
}
function actionsHtml(page){
  const node = state.pageNode;
  let html = '<div class="actions">';
  if (node) html += `<a class="act" href="graph.html${COLLECTION ? '?collection=' + encodeURIComponent(COLLECTION) : ''}#${encodeURIComponent(node)}">🕸️ פתח בגרף</a>`;
  if (!RESEARCHER) html += `<button type="button" class="act" id="synth">✍️ הצע סינתזה מצוטטת (מודל → סקירה)</button>`;
  html += `<span class="msg" id="msg"></span></div>`;
  return html;
}
function bindPage(){
  $('page').querySelectorAll('a.wl').forEach(a => a.onclick = ev => { ev.preventDefault(); openPage(a.dataset.page, null); });
  $('page').querySelectorAll('.crumbs a').forEach(a => a.onclick = ev => { ev.preventDefault(); openPage(a.dataset.page, null); });
  const b = $('synth');
  if (b) b.onclick = async () => {
    b.disabled = true; $('msg').textContent = 'המודל כותב… (עד כמה דקות)';
    try {
      const r = await fetch(api('/api/wiki/synthesize'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.page }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      $('msg').textContent = 'נכתבה הצעה לסקירה — פתחו «הצעות לסקירה».';
    } catch (e) { $('msg').textContent = 'נכשל: ' + e.message; }
    b.disabled = false;
  };
}

/* ---------- proposals (review queue) ---------- */
async function showProposals(){
  const el = $('page');
  el.innerHTML = '<div class="crumbs"><a data-page="index.md">עץ הידע</a> › הצעות לסקירה</div><div class="empty">טוען…</div>';
  bindPage();
  try {
    const r = await fetch(api('/api/admin/wiki-proposals'));
    if (!r.ok) throw new Error(r.status === 403 ? 'בעלים בלבד' : 'HTTP ' + r.status);
    const j = await r.json();
    const props = (j.proposals || []);
    if (!props.length) { el.innerHTML += '<div class="empty">אין הצעות ממתינות.</div>'; return; }
    el.innerHTML = '<div class="crumbs"><a data-page="index.md">עץ הידע</a> › הצעות לסקירה</div>' + props.map(p => `
      <div class="prop" data-file="${esc(p.file)}">
        <div class="pt">${esc(p.kind === 'synthesis' ? '✍️ סינתזה' : '🔗 ' + (p.type || ''))} — ${esc(p.name || p.page || p.slug || '')}</div>
        <div class="pm">${esc(p.page || '')}${p.model ? ' · ' + esc(p.model) : ''}${p.citations ? ' · ציטוטים: ' + esc((p.citations || []).join(', ')) : ''}${p.dropped_sentences ? ' · הושמטו ' + p.dropped_sentences + ' משפטים ללא ציטוט' : ''}</div>
        <div class="pb">${p.block ? yvWikiMd(p.block, { pageHref: rel => 'wiki.html?page=' + encodeURIComponent(rel + '.md') }) : esc(JSON.stringify(p.items || []).slice(0, 400))}</div>
        ${p.kind === 'synthesis' ? yvSupportReview.render(p.support, {editable:false}) : ''}
        <button type="button" class="act primary ok">✓ אשר לדף</button> <button type="button" class="act no">✗ דחה</button>
      </div>`).join('');
    bindPage();
    el.querySelectorAll('.prop').forEach(box => {
      const file = box.dataset.file;
      box.querySelector('.ok').onclick = () => decide('approve', file, box);
      box.querySelector('.no').onclick = () => decide('reject', file, box);
    });
  } catch (e) { el.innerHTML += `<div class="empty">${esc(e.message)}</div>`; }
}
async function decide(verb, file, box){
  try {
    const r = await fetch(api('/api/admin/wiki-proposals/' + verb), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    box.innerHTML = `<div class="pm">${verb === 'approve' ? '✓ אושר ונכתב לדף ' + esc(j.page || '') : '✗ נדחה'}</div>`;
  } catch (e) { alert('נכשל: ' + e.message); }
}

/* ---------- ask the archive ---------- */
function citeLinks(text){
  // [key] / [key · עמ׳ N] → link to the item page in this browser
  return esc(text).replace(/\[(?:תיק\s+)?([A-Za-z0-9_.\-]+)([^\]]*)\]/g, (m, key, rest) => {
    const n = state.byId.get('tik:' + key) || state.nodes.find(nn => nn.id.endsWith(':' + key));
    const page = n ? pageOf(n.id) : `tiks/${key}.md`;
    return `<a class="wl" data-page="${esc(page)}" title="${esc(key)}">[${esc(key)}${esc(rest)}]</a>`;
  });
}
async function askArchive(){
  const question = $('ask').value.trim();
  if (question.length < 3) return;
  const el = $('page');
  el.innerHTML = `<div class="crumbs"><a data-page="index.md">עץ הידע</a> › שאל את הארכיון</div><h2>${esc(question)}</h2><div class="empty">מתכנן שאילתה, שולף, מנסח תשובה מצוטטת… (עד כמה דקות)</div>`;
  bindPage();
  $('ask-go').disabled = true;
  try {
    const r = await fetch(api('/api/wiki/ask'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    let html = `<div class="crumbs"><a data-page="index.md">עץ הידע</a> › שאל את הארכיון</div><h2>${esc(question)}</h2>`;
    html += `<div class="prop"><div class="pb" style="font-size:14.5px">${citeLinks(j.answer_he || '')}</div>${j.answer_en ? `<div class="pb" dir="ltr" style="text-align:left;color:var(--muted)">${citeLinks(j.answer_en)}</div>` : ''}` +
      `<div class="pm">${j.dropped_sentences ? 'הושמטו ' + j.dropped_sentences + ' משפטים ללא ציטוט · ' : ''}${(j.citations || []).length} פריטים מצוטטים${j.cannot ? ' · ' + esc(j.cannot) : ''}</div></div>`;
    html += yvSupportReview.render(j.support, {editable:!RESEARCHER});
    if ((j.plan || []).length) html += `<h3>השאילתה שהורצה (דטרמיניסטית)</h3><pre dir="ltr" style="text-align:left;font-size:11.5px;background:var(--tint);padding:8px;border-radius:6px;overflow:auto">${esc(JSON.stringify(j.plan, null, 1))}</pre>`;
    if ((j.results || []).length) {
      html += `<h3>הראיות (${j.results.length})</h3><ul>` + j.results.slice(0, 60).map(r => `<li><a class="wl" data-page="${esc(r.page || '')}">${esc(r.name)}</a> <small>${esc(KIND_HE[r.kind] || r.kind)} · ${r.items} פריטים</small>` +
        (r.evidence || []).slice(0, 4).map(e => `<div style="font-size:12px;color:var(--muted)">· <a class="wl" data-page="${esc(pageForKey(e.item))}">[${esc(e.item)}]</a> ${esc([e.role, e.fate, e.pages ? 'עמ׳ ' + e.pages : '', (e.title || '').slice(0, 70)].filter(Boolean).join(' · '))}</div>`).join('') + '</li>').join('') + '</ul>';
    }
    el.innerHTML = html;
    yvSupportReview.bind(el, j.support);
    bindPage();
  } catch (e) { el.innerHTML += `<div class="empty">נכשל: ${esc(e.message)}</div>`; }
  $('ask-go').disabled = false;
}
function pageForKey(key){ const n = state.byId.get('tik:' + key) || state.nodes.find(nn => nn.id.endsWith(':' + key)); return n ? pageOf(n.id) : `tiks/${key}.md`; }
$('ask-go').onclick = askArchive;
$('ask').addEventListener('keydown', ev => { if (ev.key === 'Enter') askArchive(); });

/* ---------- wiring ---------- */
$('q').addEventListener('input', () => buildTree($('q').value));
$('proposals').onclick = showProposals;
$('hubs').onclick = async () => {
  $('stats').textContent = 'בונה מוקדים…';
  try {
    const r = await fetch(api('/api/wiki/hubs'), { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    $('stats').textContent = (j.summary || '').split('\n').pop();
    await fetch(api(withCollection('/api/graph/rebuild')), { method: 'POST' }).catch(() => {});
    await load();
    if (state.page) openPage(state.page, state.pageNode);
  } catch (e) { $('stats').textContent = 'נכשל: ' + e.message; }
};
async function load(){
  try {
    const r = await fetch(api(withCollection('/api/graph')));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = await r.json();
    state.byId = new Map(); state.adj = new Map();
    state.nodes = (g.nodes || []).map(n => ({ id: n.id, label: n.label, data: n.data || {} }));
    for (const n of state.nodes) { state.byId.set(n.id, n); state.adj.set(n.id, []); }
    for (const e of g.edges || []) if (state.byId.has(e.source) && state.byId.has(e.target)) { state.adj.get(e.source).push(e); state.adj.get(e.target).push(e); }
    $('stats').textContent = `${state.nodes.length.toLocaleString('he')} צמתים${COLLECTION ? ' · אוסף ' + COLLECTION.toUpperCase() : ''}`;
    buildTree('');
    const page = PARAMS.get('page');
    if (page && !state.page) openPage(page, null);
  } catch (e) {
    $('tree').innerHTML = `<div class="empty">העץ לא נטען (${esc(e.message)})</div>`;
  }
}
load();
