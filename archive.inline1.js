/* archive.inline1.js — the archive-management screen (tree · record card · rail).
   Talks only to /api/arc/* (same origin). No inline handlers: the server CSP has
   no 'unsafe-inline' for scripts, so everything is delegated from here. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LEVEL_HE = { fonds: 'חטיבה', subfonds: 'תת-חטיבה', series: 'סדרה', subseries: 'תת-סדרה', file: 'תיק', item: 'פריט', part: 'חלק' };
const LEVELS = Object.keys(LEVEL_HE);
const STATUS_HE = { draft: 'טיוטה', draft_invalid: 'טיוטה פסולה', in_review: 'בביקורת', published: 'מפורסמת', withdrawn: 'הוסרה' };
const KIND_HE = { photo: 'תצלום', film: 'סרט', doc: 'מסמך', tik: 'תיק', book: 'ספר', admin: 'תיק מנהלי' };
const BLOCKER_HE = { no_title: 'אין כותר', no_date: 'אין תאריך (אפשר משוער — "בערך")', unapproved_agent: 'מקושרת ישות שטרם אושרה', engine_validation_failed: 'נכשלה בוולידציית המנוע' };
const TRANSITIONS = {
  draft: ['in_review', 'published', 'withdrawn'], draft_invalid: ['draft'],
  in_review: ['draft', 'published', 'withdrawn'], published: ['withdrawn', 'in_review'], withdrawn: ['draft'],
};
const TRANS_LABEL = { in_review: '⇢ לביקורת', published: '✓ פרסום', withdrawn: '⊘ הסרה', draft: '↩ חזרה לטיוטה' };
const NOTE_KIND_HE = { general: 'כללי', archival_history: 'היסטוריה ארכיונית', custodial: 'משמורת', acquisition: 'רכישה', publication: 'פרסום', originals: 'מקור', copies: 'עותקים', archivist: 'הערת ארכיונאי', conservation: 'שימור', language: 'שפה', review_flag: 'דגל ביקורת' };
const DATE_KIND_HE = { creation: 'יצירה', accumulation: 'הצטברות', authentic: 'מאומת', reconstructed: 'משוחזר', coverage: 'כיסוי', other: 'אחר' };
const CONF = { high: '<span class="c-high">✓</span>', mid: '<span class="c-mid">~</span>', low: '<span class="c-low">?</span>' };
const AGENT_ROLE_HE = { creator: 'יוצר', subject: 'נושא', author: 'מחבר', recipient: 'נמען', custodian: 'משמורן', donor: 'תורם', photographer: 'צלם', depicted: 'מצולם' };

// cat = /api/arc/catalogs: the five Sapir catalogs (order, field templates, home fonds); catFilter = active chip
const state = { rec: null, dirty: {}, moving: null, expanded: new Set(), sel: null, newParent: undefined, cat: null, catFilter: '' };
const catDef = c => (state.cat && state.cat.catalogs && state.cat.catalogs[c]) || null;
const catName = c => (catDef(c) || {}).title_he || c || '';
const catColor = c => `var(--${(catDef(c) || {}).color || 'muted'})`;

// ---- transport ------------------------------------------------------------
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  if (!r.ok) { const e = new Error((j && j.error) || (r.status + ' ' + r.statusText)); e.status = r.status; e.data = j; throw e; }
  return j;
}
let toastT = null;
function toast(msg, cls = 'ok') {
  const t = $('toast'); t.textContent = msg; t.className = 'show ' + cls;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, cls === 'err' ? 6000 : 2600);
}
const fmtDate = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
const fmtBytes = n => n == null ? '' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';

// ---- header ---------------------------------------------------------------
async function loadHeader() {
  const st = await api('/api/arc/status');
  if (!st.enabled) {
    $('tenant').textContent = '';
    $('tree-body').innerHTML = '<div class="tree-empty">בסיס הנתונים של הארכיון אינו מחובר.</div>';
    $('card').innerHTML = '<div class="empty"><b>שכבת הניהול צריכה Postgres.</b><br>השרת רץ על קבצים (<code>MF_DB_URL</code> ריק). להפעלה מקומית: <code>bash ops/arc-dev.sh</code>, ואחריו <code>bash ops/arc-dev.sh backfill</code> לטעינת הרשומות הקיימות.</div>';
    $('stats').innerHTML = '<span class="stat">backend: <b>' + esc(st.backend) + '</b></span>';
    return false;
  }
  $('tenant').textContent = '· ' + (st.tenant && st.tenant.slug ? st.tenant.slug : '');
  await loadStats();
  return true;
}
async function loadCatalogs() {
  state.cat = await api('/api/arc/catalogs');
  const homes = new Map(state.cat.homes.map(h => [h.catalog, h]));
  const missing = state.cat.order.filter(c => !homes.has(c)).length;
  $('cat-strip').innerHTML = state.cat.order.map(c => {
    const h = homes.get(c);
    return `<button type="button" class="cchip${state.catFilter === c ? ' on' : ''}" data-catalog="${c}" title="${esc(catName(c))} — סינון לפי קטלוג"><span class="kdot" style="background:${catColor(c)}"></span>${esc(catName(c))}${h ? `<b>${h.records}</b>` : ''}</button>`;
  }).join('') + (missing || state.cat.orphans
    ? `<button type="button" class="gear" id="btn-cat-init" title="יוצר את חמש חטיבות-הבית של ספיר (פעם אחת) ומכניס אליהן רשומות-שורש של המנוע">🗂 ${missing ? 'צור את קטלוגי ספיר' : `סדר ${state.cat.orphans} רשומות ללא בית`}</button>` : '');
}
async function loadStats() {
  const s = await api('/api/arc/stats');
  const by = s.by_status || {};
  $('stats').innerHTML =
    `<span class="stat">רשומות <b>${s.records}</b></span>` +
    `<span class="stat">טיוטות <b>${(by.draft || 0) + (by.draft_invalid || 0)}</b></span>` +
    `<span class="stat rev">בביקורת <b>${by.in_review || 0}</b></span>` +
    `<span class="stat pub">מפורסמות <b>${by.published || 0}</b></span>` +
    `<span class="stat cand">ישויות לאישור <b>${s.agents_candidate}</b></span>` +
    `<span class="stat">מקומות <b>${s.places}</b></span>`;
}

// ---- tree -----------------------------------------------------------------
function nodeHtml(n) {
  const leaf = !n.child_count;
  const tw = leaf ? '<span class="tw leaf">·</span>' : `<span class="tw">${state.expanded.has(n.id) ? '▾' : '◂'}</span>`;
  const kind = n.home ? `<span class="kdot" style="background:${catColor(n.catalog)}" title="${esc(catName(n.catalog))}"></span>`
    : n.kind ? `<span class="kdot ${esc(n.kind)}" title="${esc(KIND_HE[n.kind] || n.kind)}"></span>` : '';
  const title = n.title_he || n.title_en || '(ללא כותר)';
  return `<li data-id="${n.id}"><div class="node${state.sel === n.id ? ' sel' : ''}${n.home ? ' home' : ''}" data-id="${n.id}" data-level="${esc(n.level)}" data-leaf="${leaf ? 1 : 0}">
    ${tw}<span class="st ${esc(n.status)}" title="${esc(STATUS_HE[n.status] || n.status)}"></span>${kind}
    <span class="lvl">${esc(LEVEL_HE[n.level] || n.level)}</span>
    <span class="ttl" title="${esc(title)}">${esc(title)}<small>${esc(n.ref_code)}</small></span>
    ${n.child_count ? `<span class="tw" style="width:auto">${n.child_count}</span>` : ''}
  </div><ul class="kids" data-parent="${n.id}"></ul></li>`;
}
async function loadChildren(ul, parentId) {
  const rows = await api('/api/arc/tree' + (parentId ? '?parent=' + parentId : ''));
  ul.innerHTML = rows.length ? rows.map(nodeHtml).join('') : (parentId ? '' : '<div class="tree-empty">העץ ריק. צרי חטיבה ראשונה (＋ חטיבה) או טעני רשומות (backfill).</div>');
  for (const id of state.expanded) { const k = ul.querySelector(`ul.kids[data-parent="${id}"]`); if (k && !k.children.length) await loadChildren(k, id); }
}
async function renderTree() {
  const body = $('tree-body');
  body.innerHTML = '<ul class="tree" id="tree-root"></ul>';
  await loadChildren($('tree-root'), null);
}
async function renderSearch(q, level, status, catalog) {
  const p = new URLSearchParams(); if (q) p.set('q', q); if (level) p.set('level', level); if (status) p.set('status', status); if (catalog) p.set('catalog', catalog); p.set('limit', '100');
  const r = await api('/api/arc/records?' + p);
  const body = $('tree-body');
  if (!r.total) { body.innerHTML = '<div class="tree-empty">אין תוצאות.</div>'; return; }
  body.innerHTML = `<div class="tree-empty" style="padding:8px 12px">${r.total} תוצאות</div><ul class="results">` + r.rows.map(x => `
    <li data-id="${x.id}"><div><span class="st ${esc(x.status)}" style="display:inline-block;margin-inline-end:6px"></span>
      <span class="lvl" style="font-size:10.5px;color:var(--muted)">${esc(LEVEL_HE[x.level] || x.level)}</span>
      <b style="unicode-bidi:isolate">${esc(x.title_he || x.title_en || '(ללא כותר)')}</b></div>
      <div class="path">${esc(x.ref_code)}${x.kind ? ' · ' + esc(KIND_HE[x.kind] || x.kind) : ''}${x.catalog ? ` · <span style="color:${catColor(x.catalog)}">${esc(catName(x.catalog))}</span>` : ''}</div>
      ${x.snippet ? `<div class="snip">${esc(x.snippet)}</div>` : ''}</li>`).join('') + '</ul>';
}
let searchT = null;
function refreshTree() {
  const q = $('q').value.trim(), level = $('f-level').value, status = $('f-status').value, cat = state.catFilter;
  if (q || level || status || cat) renderSearch(q, level, status, cat).catch(e => toast(e.message, 'err'));
  else renderTree().catch(e => toast(e.message, 'err'));
}
function markSelected(id) {
  state.sel = id;
  document.querySelectorAll('.node.sel').forEach(n => n.classList.remove('sel'));
  const n = document.querySelector(`.node[data-id="${id}"]`); if (n) n.classList.add('sel');
}
async function expandPathTo(ids) {
  for (const id of ids) state.expanded.add(id);
  await renderTree();
}

// ---- record card ----------------------------------------------------------
function field(label, name, value, { type = 'text', mono = false, readonly = false, sub = '' } = {}) {
  const v = value == null ? '' : value;
  const inp = readonly
    ? `<div class="v${mono ? ' mono' : ''}">${esc(v) || '<span style="color:var(--muted)">—</span>'}</div>`
    : type === 'textarea'
      ? `<textarea data-field="${name}">${esc(v)}</textarea>`
      : `<input type="text" data-field="${name}" value="${esc(v)}"${mono ? ' style="direction:ltr;text-align:left;font-family:ui-monospace,Menlo,monospace"' : ''}>`;
  return `<div class="frow"><label>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</label>${inp}</div>`;
}
function bilingual(label, heName, heVal, enName, enVal, { tall = false, sub = '' } = {}) {
  return `<div class="frow"><label>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</label>
    <div class="bi">
      <div class="he"><div class="cap">עברית</div><textarea class="${tall ? 'tall' : ''}" data-field="${heName}">${esc(heVal || '')}</textarea></div>
      <div class="en"><div class="cap">English</div><textarea class="${tall ? 'tall' : ''}" data-field="${enName}">${esc(enVal || '')}</textarea></div>
    </div></div>`;
}
// The catalog is chosen on a root unit; below a home fonds it is inherited from the
// tree (the DB trigger sets it on insert/move), so the card shows it locked and
// points to ⇄ move for changing it.
function catalogField(r, d) {
  const order = (state.cat && state.cat.order) || [];
  const isHome = !!(r.extra && r.extra.catalog_home);
  if (isHome) return `<div class="v locked"><span style="color:${catColor(r.catalog)}">●</span> ${esc(catName(r.catalog))} <small>· חטיבת-הבית של הקטלוג</small></div>`;
  const inherited = d.ancestors.some(a => a.catalog) || (d.ancestors.length > 0 && r.catalog);
  if (inherited) return `<div class="v locked"><span style="color:${catColor(r.catalog)}">●</span> ${esc(catName(r.catalog))} <small>· נקבע לפי מקומה בעץ; להעברה לקטלוג אחר: ⇄ העברה</small></div>`;
  return `<select data-field="catalog"><option value="">— ללא —</option>${order.map(c => `<option value="${c}"${c === r.catalog ? ' selected' : ''}>${esc(catName(c))}</option>`).join('')}</select>`;
}
// Per-catalog field template (arc/catalogs.json) over record.extra.sapir — the
// Sapir card the cataloger copies from; the engine fills it at ingest.
function sapirSection(r) {
  const t = catDef(r.catalog); if (!t || (r.extra && r.extra.catalog_home)) return '';   // a home fonds is a container, not a Sapir item
  const vals = (r.extra && r.extra.sapir) || {};
  const rows = t.fields.map(f => {
    const v = vals[f.key] == null ? '' : String(vals[f.key]); const name = 'sapir:' + f.key;
    const ltr = f.ltr ? ' style="direction:ltr;text-align:left"' : '';
    const inp = f.type === 'select'
      ? `<select data-field="${name}"><option value="">—</option>${(v && !f.options.includes(v) ? [v] : []).concat(f.options).map(o => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : f.type === 'textarea' ? `<textarea data-field="${name}">${esc(v)}</textarea>`
      : `<input type="text" data-field="${name}" value="${esc(v)}"${ltr}>`;
    return `<div class="frow"><label>${esc(f.label_he)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>${inp}</div>`;
  }).join('');
  return `<section class="area cat"><h3><span style="color:${catColor(r.catalog)}">●</span> כרטיס ${esc(t.title_he)} <small>${esc(t.source || '')}</small>${t.pending_sapir ? '<span class="pend">תבנית לפי תקן — ממתינה לרשימת השדות של ספיר</span>' : ''}</h3>${rows}</section>`;
}
function levelSelect(cur, parentLevel) {
  const minIdx = parentLevel ? LEVELS.indexOf(parentLevel) + 1 : 0;
  return `<select data-field="level">${LEVELS.map((l, i) => `<option value="${l}"${l === cur ? ' selected' : ''}${i < minIdx ? ' disabled' : ''}>${LEVEL_HE[l]}</option>`).join('')}</select>`;
}

function renderCard(d) {
  const r = d.record;
  const crumbs = d.ancestors.map(a => `<a data-goto="${a.id}">${esc(a.title_he || a.title_en || a.ref_code)}</a>`).join('<span>›</span>');
  const parentLevel = d.ancestors.length ? d.ancestors[d.ancestors.length - 1].level : null;
  $('card').innerHTML = `
    <div class="crumbs"><a data-goto="">הארכיון</a>${crumbs ? '<span>›</span>' + crumbs : ''}</div>
    <div class="rec-head">
      <div style="flex:1;min-width:0">
        <h2 id="h-title">${esc(r.title_he || r.title_en || '(ללא כותר)')}</h2>
        ${r.title_en && r.title_he ? `<div class="en">${esc(r.title_en)}</div>` : ''}
        <div class="badges">
          <span class="badge">${esc(LEVEL_HE[r.level] || r.level)}</span>
          ${r.catalog ? `<span class="badge" style="color:${catColor(r.catalog)};border-color:color-mix(in srgb, ${catColor(r.catalog)} 50%, transparent)">${esc(catName(r.catalog))}</span>` : ''}
          ${r.kind ? `<span class="badge kind ${esc(r.kind)}">${esc(KIND_HE[r.kind] || r.kind)}</span>` : ''}
          <span class="badge status ${esc(r.status)}">${esc(STATUS_HE[r.status] || r.status)}</span>
          <span class="badge ref">${esc(r.ref_code)}</span>
          ${d.child_count ? `<span class="badge">${d.child_count} רשומות-בת</span>` : ''}
        </div>
      </div>
    </div>
    <div class="savebar" id="savebar">
      <span class="dirty">● שינויים שלא נשמרו</span>
      <input type="text" id="reason" placeholder="סיבת השינוי (רשות) — נרשמת בהיסטוריה">
      <button type="button" class="primary" id="btn-save" disabled>שמירה</button>
      <button type="button" class="secondary" id="btn-revert" disabled>ביטול</button>
    </div>

    <section class="area"><h3>אזור הזיהוי <small>ISAD(G) 3.1</small></h3>
      ${field('מספר ייחוס', 'ref_code', r.ref_code, { mono: true, sub: '3.1.1' })}
      ${field('מזהה קודם', 'legacy_id', r.legacy_id, { mono: true, sub: 'ספיר / מערכת קודמת' })}
      <div class="frow"><label>רמת התיאור<small>3.1.4</small></label>${levelSelect(r.level, parentLevel)}</div>
      <div class="frow"><label>קטלוג<small>ספיר</small></label>${catalogField(r, d)}</div>
      ${bilingual('כותר', 'title_he', r.title_he, 'title_en', r.title_en, { sub: '3.1.2' })}
      <div class="frow"><label>תאריכים<small>3.1.3</small></label><div>
        <div class="list" id="dates">${d.dates.length ? d.dates.map(dt => `
          <div class="li"><span class="src">${esc(DATE_KIND_HE[dt.kind] || dt.kind)}</span>
            <div class="body">${esc(dt.display)}${dt.iso ? ` <span class="meta" dir="ltr">${esc(dt.iso)}</span>` : ''}${dt.certain ? '' : ' <span class="meta">(משוער)</span>'}</div>
            <button type="button" class="x" data-del-date="${dt.id}" title="מחיקת תאריך">✕</button></div>`).join('')
          : '<div class="meta" style="color:var(--warn);font-size:12.5px">אין תאריך — נדרש לפרסום (גם משוער).</div>'}</div>
        <div class="addrow"><div class="fields">
          <input type="text" id="dt-display" placeholder="תאריך כפי שנרשם, למשל: בערך 1941">
          <input type="text" id="dt-iso" placeholder="ISO: 1941 / 1939/1945" style="direction:ltr;text-align:left">
          <select id="dt-kind">${Object.entries(DATE_KIND_HE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" id="dt-approx"> משוער</label>
        </div><button type="button" class="secondary" id="dt-add">＋ תאריך</button></div>
      </div></div>
      ${field('היקף ומדיום', 'extent', r.extent, { sub: '3.1.5' })}
    </section>

    ${sapirSection(r)}

    <section class="area"><h3>תוכן ומבנה <small>ISAD(G) 3.3</small></h3>
      ${bilingual('היקף ותוכן', 'scope_he', r.scope_he, 'scope_en', r.scope_en, { tall: true, sub: '3.3.1' })}
      ${field('שיטת הסידור', 'arrangement', r.arrangement, { type: 'textarea', sub: '3.3.4' })}
      ${field('הערכה, ביעור', 'appraisal', r.appraisal, { type: 'textarea', sub: '3.3.2' })}
      ${field('הצטברויות', 'accruals', r.accruals, { type: 'textarea', sub: '3.3.3' })}
    </section>

    <section class="area"><h3>תנאי גישה ושימוש <small>ISAD(G) 3.4</small></h3>
      ${field('שפות', 'languages', (r.languages || []).join(', '), { mono: true, sub: '3.4.3 · ISO-639-2, מופרד בפסיק' })}
      ${field('מאפיינים פיזיים', 'phys_char', r.phys_char, { type: 'textarea', sub: '3.4.4' })}
      ${field('עזרי חיפוש', 'finding_aids', r.finding_aids, { type: 'textarea', sub: '3.4.5' })}
    </section>

    <section class="area"><h3>הערות <small>ISAD(G) 3.6–3.7 · ${d.notes.length}</small></h3>
      <div class="list" id="notes">${d.notes.map(n => `
        <div class="li"><span class="src ${n.source === 'human' ? 'human' : ''}" title="${esc(n.source || '')}">${esc(NOTE_KIND_HE[n.kind] || n.kind)}${n.source && n.source !== 'human' ? ' · ' + esc(n.source) : ''}</span>
          <div class="body${n.lang === 'en' ? ' en' : ''}">${esc(n.body)}${n.ref ? `\n<span class="meta">${esc(n.ref)}</span>` : ''}</div>
          ${n.source === 'human' ? `<button type="button" class="x" data-del-note="${n.id}" title="מחיקת הערה">✕</button>` : `<span class="meta" title="הערת-מנוע: נשמרת כתיעוד">🔒</span>`}</div>`).join('') || '<div class="meta" style="font-size:12.5px">אין הערות.</div>'}</div>
      <div class="addrow"><div class="fields note">
        <select id="nt-kind">${Object.entries(NOTE_KIND_HE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="nt-lang"><option value="he">עברית</option><option value="en">English</option></select>
        <input type="text" id="nt-body" placeholder="הערה חדשה של המקטלגת">
      </div><button type="button" class="secondary" id="nt-add">＋ הערה</button></div>
    </section>

    <section class="area"><h3>ניהול הרשומה <small>ISAD(G) 3.7</small></h3>
      ${field('תאריך התיאור', 'described_at', r.described_at ? String(r.described_at).slice(0, 10) : '', { mono: true, sub: '3.7.3 · YYYY-MM-DD' })}
      <div class="frow"><label>נוצר / עודכן</label><div class="v" style="font-size:12.5px;color:var(--muted)">
        ${esc(fmtDate(r.created_at))} · ${esc(r.created_by || '')}<br>${esc(fmtDate(r.updated_at))} · ${esc(r.updated_by || '')}</div></div>
    </section>`;
  state.dirty = {};
  $('card').querySelectorAll('[data-field]').forEach(el => { el.dataset.orig = el.value; });
  renderRail(d);
}

function setDirty() {
  const bar = $('savebar'); const dirty = Object.keys(state.dirty).length > 0;
  bar.classList.toggle('is-dirty', dirty);
  $('btn-save').disabled = !dirty; $('btn-revert').disabled = !dirty;
}
function onFieldInput(el) {
  const name = el.dataset.field;
  if (el.value !== el.dataset.orig) { state.dirty[name] = el.value; el.classList.add('changed'); }
  else { delete state.dirty[name]; el.classList.remove('changed'); }
  setDirty();
}
async function save() {
  if (!state.rec || !Object.keys(state.dirty).length) return;
  const patch = {}; const sapir = {}; let hasSapir = false;
  for (const [k, v] of Object.entries(state.dirty)) {
    if (k.startsWith('sapir:')) { sapir[k.slice(6)] = v; hasSapir = true; }
    else if (k === 'languages') patch[k] = v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    else if (k === 'described_at') patch[k] = v.trim() || null;
    else if (k === 'catalog') patch[k] = v || null;
    else patch[k] = v;
  }
  if (hasSapir) {          // extra is replaced whole → merge the template values into the current extra
    const cur = (state.rec.record.extra && typeof state.rec.record.extra === 'object') ? state.rec.record.extra : {};
    const merged = { ...(cur.sapir || {}) };
    for (const [k, v] of Object.entries(sapir)) { if (String(v).trim() === '') delete merged[k]; else merged[k] = v; }
    patch.extra = { ...cur, sapir: merged };
  }
  try {
    const r = await api('/api/arc/records/' + state.rec.record.id, { method: 'PATCH', body: { patch, reason: $('reason').value.trim() || 'edit' } });
    toast(`נשמר · גרסה ${r.version} · שדות: ${r.changed.join(', ') || '—'}`);
    if ('catalog' in patch) await loadCatalogs();
    await openRecord(state.rec.record.id, { keepTree: !('level' in patch || 'ref_code' in patch || 'title_he' in patch || 'title_en' in patch || 'catalog' in patch) });
  } catch (e) { toast('השמירה נכשלה: ' + e.message, 'err'); }
}

// ---- rail -----------------------------------------------------------------
function renderRail(d) {
  const r = d.record;
  const flow = (TRANSITIONS[r.status] || []).map(to => {
    const blocked = to === 'published' && d.blockers.length;
    const cls = to === 'published' ? 'primary' : to === 'withdrawn' ? 'danger' : 'secondary';
    return `<button type="button" class="${cls}" data-status="${to}"${blocked ? ' disabled title="חסום — ראי למטה"' : ''}>${TRANS_LABEL[to]}</button>`;
  }).join('');
  const ents = (arr, fn, max = 12) => arr.length ? arr.slice(0, max).map(fn).join('') + (arr.length > max ? `<div class="more">+${arr.length - max} נוספים</div>` : '') : '<div class="more">—</div>';
  $('rail').innerHTML = `
    <h4>סטטוס ופעולות</h4>
    <div class="box">
      <div style="margin-bottom:8px">מצב: <b class="badge status ${esc(r.status)}">${esc(STATUS_HE[r.status] || r.status)}</b></div>
      <div class="flow">${flow || '<span class="more">אין מעברים זמינים</span>'}</div>
      ${d.blockers.length && r.status !== 'published' ? `<ul class="blockers">${d.blockers.map(b => `<li>⚠ ${esc(BLOCKER_HE[b] || b)}</li>`).join('')}</ul>` : ''}
      <div class="flow" style="margin-top:10px">
        <button type="button" class="gear" id="btn-move">⇄ העברה ליחידת-אב אחרת…</button>
        ${LEVELS.indexOf(r.level) < LEVELS.length - 1 ? `<button type="button" class="gear" id="btn-new-child">＋ רשומת-בת</button>` : ''}
      </div>
    </div>

    <h4>אישים וגופים <span style="font-weight:400">· ${d.agents.length}</span></h4>
    <div class="box">${ents(d.agents, a => `<div class="ent">${CONF[a.confidence] || ''}<a class="n" href="entities.html#a=${a.id}" title="${esc(a.authorized_en || '')} — פתיחה בישויות" style="color:inherit;text-decoration:none">${esc(a.authorized_he)}${a.authorized_en ? `<small>${esc(a.authorized_en)}</small>` : ''}</a>
      <span class="role">${esc(AGENT_ROLE_HE[a.role] || a.role)}</span><span class="${a.status === 'approved' ? 'appr' : 'cand'}">${a.status === 'approved' ? 'מאושר' : 'מועמד'}</span></div>`)}</div>

    <h4>מקומות <span style="font-weight:400">· ${d.places.length}</span></h4>
    <div class="box">${ents(d.places, p => `<div class="ent">${CONF[p.confidence] || ''}<a class="n" href="entities.html#p=${p.id}" style="color:inherit;text-decoration:none">${esc(p.name_he)}${p.name_en ? `<small>${esc(p.name_en)}</small>` : ''}</a>
      ${p.kind ? `<span class="role">${esc(p.kind)}</span>` : ''}${p.qid ? `<a href="https://www.wikidata.org/wiki/${esc(p.qid)}" target="_blank" rel="noopener">${esc(p.qid)}</a>` : ''}</div>`)}</div>

    <h4>נושאים <span style="font-weight:400">· ${d.subjects.length}</span></h4>
    <div class="box">${ents(d.subjects, s => `<div class="ent"><span class="n">${esc(s.pref_he)}${s.pref_en ? `<small>${esc(s.pref_en)}</small>` : ''}</span></div>`)}</div>

    ${d.events.length ? `<h4>אירועים מתועדים <span style="font-weight:400">· ${d.events.length}</span></h4>
    <div class="box">${ents(d.events, e => `<div class="ent">${CONF[{ '✓': 'high', '~': 'mid', '?': 'low' }[e.confidence] || e.confidence] || ''}<span class="n" title="${esc(e.label_he)}">${esc(e.label_he)}${e.date_display ? `<small>${esc(e.date_display)}</small>` : ''}</span>${e.pages ? `<span class="role">עמ׳ ${esc(e.pages)}</span>` : ''}</div>`, 8)}</div>` : ''}

    <h4>קבצים דיגיטליים <span style="font-weight:400">· ${d.objects.length}</span></h4>
    <div class="box">${d.objects.length ? d.objects.map(o => `<div class="file"><b>${esc(o.role)}</b> <span class="meta" style="color:var(--muted);font-size:11px">${esc(o.mime || '')} ${esc(fmtBytes(o.bytes))}${o.pages ? ' · ' + o.pages + ' עמ׳' : ''}${o.width ? ` · ${o.width}×${o.height}` : ''}</span>${sheetLink(o)}<div class="p">${esc(o.rel_path)}</div></div>`).join('') : '<div class="more">אין קבצים מקושרים</div>'}</div>

    <h4>היסטוריה <span style="font-weight:400">· ${d.versions.length} גרסאות</span></h4>
    <div class="box" id="history">${d.versions.length ? d.versions.map(v => `<div class="ver" data-ver="${v.version}"><b>גרסה ${v.version}</b> <span class="w">· ${esc(v.author)} · ${esc(fmtDate(v.created_at))}</span>${v.reason ? `<div class="w">${esc(v.reason)}</div>` : ''}</div>`).join('') : '<div class="more">אין שינויים עדיין — הרשומה כפי שנקלטה.</div>'}
      <div class="diff" id="diff"></div></div>

    <h4>מקור וודאות</h4>
    <div class="box kv">
      <span>מזהה פנימי</span><b dir="ltr">#${r.id}</b>
      <span>קטלוג</span><b>${esc(catName(r.catalog) || '—')}</b>
      <span>מסלול הפקה</span><b>${esc(KIND_HE[r.kind] || r.kind || '—')}</b>
      <span>ודאות שדות</span><b dir="ltr">${esc(Object.entries(r.confidence || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? Object.entries(v).map(([a, b]) => a + '=' + b).join('/') : v}`).join('; ') || '—')}</b>
    </div>`;
}

// A sidecar the server produced (…/output/<kind>_<stem>_<date>.json) has the
// engine's HTML sheet next to it — the page the cataloger copies from.
function sheetLink(o) {
  if (o.role !== 'sidecar' || !/\/output\/[^/]+\.json$/.test(o.rel_path || '')) return '';
  const html = o.rel_path.split('/').pop().replace(/\.json$/, '.html');
  return ` <a href="/api/output/${encodeURIComponent(html)}" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--accent)">↗ דף-ההזנה של המנוע</a>`;
}
async function showDiff(version) {
  try {
    const vs = await api('/api/arc/records/' + state.rec.record.id + '/versions');
    const v = vs.find(x => x.version === version); if (!v) return;
    const next = vs.find(x => x.version === version + 1);         // the snapshot AFTER this change, if any
    const after = next ? next.snapshot : state.rec.record;
    const keys = ['title_he', 'title_en', 'scope_he', 'scope_en', 'ref_code', 'level', 'status', 'extent', 'arrangement', 'appraisal', 'accruals', 'phys_char', 'finding_aids', 'legacy_id', 'parent_id', 'described_at', 'catalog', 'extra'];
    const rows = keys.filter(k => JSON.stringify(v.snapshot[k] ?? null) !== JSON.stringify(after[k] ?? null))
      .map(k => { const show = x => x == null ? '—' : typeof x === 'object' ? JSON.stringify(x.sapir || x) : x; return `<div class="f">${esc(k)}</div><div class="old">${esc(show(v.snapshot[k]))}</div><div class="new">${esc(show(after[k]))}</div>`; }).join('');
    const box = $('diff'); box.innerHTML = `<b>גרסה ${version} → ${next ? 'גרסה ' + next.version : 'המצב הנוכחי'}</b>${rows || '<div class="more">אין הבדל בשדות התיאוריים (למשל: שינוי סטטוס בלבד)</div>'}`;
    box.classList.add('show');
  } catch (e) { toast(e.message, 'err'); }
}

// ---- open / navigate ------------------------------------------------------
async function openRecord(id, { keepTree = false } = {}) {
  if (!id) { state.rec = null; state.sel = null; $('card').innerHTML = '<div class="empty">בחרי רשומה בעץ.</div>'; $('rail').innerHTML = ''; markSelected(null); return; }
  try {
    const d = await api('/api/arc/records/' + id);
    state.rec = d;
    location.hash = 'r=' + id;
    renderCard(d);
    if (!keepTree) {
      const q = $('q').value.trim();
      if (!q && !$('f-level').value && !$('f-status').value) await expandPathTo(d.ancestors.map(a => a.id));
    }
    markSelected(Number(id));
    const n = document.querySelector(`.node[data-id="${id}"]`); if (n) n.scrollIntoView({ block: 'nearest' });
  } catch (e) { toast(e.message, 'err'); }
}

// ---- the switch: catalog system ↔ repository (archive.html#integration) ------
// Off by default. An owner flips it here; MF_ARC_AUTO_INGEST pins it from the
// environment. The panel shows what the button needs (DB, catalog homes,
// python+psycopg, output dir), the recent ingests, and a dry "בדיקת חיבור".
async function loadIntegrationDot() {
  try { const r = await api('/api/arc/integration'); $('integ-dot').className = r.auto_ingest ? 'on' : ''; $('btn-integration').title = r.auto_ingest ? 'קליטה אוטומטית פעילה — כל עבודה שמסתיימת נקלטת למאגר' : 'קליטה אוטומטית כבויה — המנוע כותב לדיסק בלבד'; }
  catch { /* the panel explains */ }
}
async function openIntegration() {
  location.hash = 'integration'; state.rec = null; markSelected(null); $('rail').innerHTML = '';
  $('card').innerHTML = '<div class="empty">בודק מוכנות…</div>';
  let r;
  try { r = await api('/api/arc/integration'); } catch (e) { $('card').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const chk = (ok, label, detail, sub) => `<div class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</div><div><b>${esc(label)}</b> — ${esc(detail || '')}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const c = r.checks;
  const pinned = r.source === 'env';
  $('card').innerHTML = `
    <div class="crumbs"><a data-goto="">הארכיון</a><span>›</span><span>חיבור למערכת הקטלוג</span></div>
    <div class="rec-head"><div style="flex:1;min-width:0"><h2>חיבור מערכת הקטלוג למאגר</h2>
      <div class="en" style="font-family:inherit;direction:rtl;text-align:right;color:var(--muted);font-size:13.5px">כשהמתג פעיל, כל עבודת קטלוג שמסתיימת (תצלום · מסמך · סרט · תיק) נקלטת מיד למאגר כרשומה, תחת חטיבת-הבית של הקטלוג שלה. המנוע והפלט לדיסק אינם תלויים במתג; כישלון קליטה לעולם לא מפיל עבודה.</div></div></div>

    <section class="area"><h3>המתג</h3>
      <div class="integ-state">
        <span class="big ${r.auto_ingest ? 'on' : 'off'}">${r.auto_ingest ? '🟢 קליטה אוטומטית פעילה' : '⚪ קליטה אוטומטית כבויה'}</span>
        <span class="src">${pinned ? `נקבע בסביבה (${esc(r.env_var)}) — לא ניתן לשנות מכאן` : r.source === 'settings' ? `הוגדר מהמסך${r.changed_by ? ' · ' + esc(r.changed_by) : ''}${r.changed_at ? ' · ' + esc(fmtDate(r.changed_at)) : ''}` : 'ברירת-מחדל'}</span>
        <span style="flex:1"></span>
        <button type="button" class="${r.auto_ingest ? 'danger' : 'primary'}" id="integ-toggle" data-on="${r.auto_ingest ? 0 : 1}"${(!r.can_toggle || pinned || (!r.auto_ingest && !r.ready)) ? ' disabled' : ''} title="${!r.can_toggle ? 'רק בעלי המערכת' : pinned ? 'נעול על-ידי משתנה הסביבה' : (!r.auto_ingest && !r.ready) ? 'לא כל התנאים מתקיימים — ראי למטה' : ''}">${r.auto_ingest ? '⏻ כיבוי הקליטה האוטומטית' : '⏻ הפעלת הקליטה האוטומטית'}</button>
        <button type="button" class="secondary" id="integ-probe"${r.can_toggle ? '' : ' disabled'} title="מריץ את הקליטה האמיתית במצב-יבש: python, psycopg, בסיס הנתונים, הדייר — בלי לכתוב דבר">🔎 בדיקת חיבור</button>
      </div>
      <div id="integ-probe-out" class="meta" style="margin-top:8px;font-size:12.5px"></div>
    </section>

    <section class="area"><h3>מוכנות <small>מה הכפתור צריך</small></h3><div class="checks">
      ${chk(c.db.ok, 'בסיס הנתונים', c.db.ok ? `Postgres · דייר ${c.db.tenant ? esc(c.db.tenant.slug) : ''} · מיגרציה ${esc(c.db.migrated || '')}` : c.db.error)}
      ${chk(c.catalogs.ok, 'חטיבות-הבית של ספיר', c.catalogs.ok ? `${c.catalogs.homes} מתוך ${c.catalogs.expected}` : `${c.catalogs.homes || 0} קיימות — ליצירה: כפתור "צור את קטלוגי ספיר" בעץ`, c.catalogs.error)}
      ${chk(c.python.ok, 'python + psycopg', c.python.ok ? c.python.version : c.python.error, c.python.path + (c.python.hint ? ' · ' + c.python.hint : ''))}
      ${chk(c.output_dir.ok, 'תיקיית הפלט של המנוע', c.output_dir.ok ? 'ניתנת לכתיבה' : c.output_dir.error, c.output_dir.path)}
    </div></section>

    <section class="area"><h3>עבודות אחרונות <small>${r.recent.length ? r.recent.length : 'אין עדיין'}</small></h3>
      ${r.recent.length ? `<table class="recent"><tr><th>עבודה</th><th>פלט</th><th>סטטוס</th><th>במאגר</th><th>מתי</th></tr>${r.recent.map(j => `<tr>
        <td class="ltr">${esc(j.id)}</td><td class="ltr">${esc(j.outputName || '')}</td><td>${esc(j.status)}</td>
        <td>${j.arc ? `<a data-goto="${j.arc.record_id}" style="cursor:pointer;color:var(--accent)">${esc(j.arc.ref_code || ('#' + j.arc.record_id))}</a> <small style="color:var(--muted)">${esc(j.arc.action)}</small>` : '<span style="color:var(--muted)">לא נקלטה</span>'}</td>
        <td>${esc(fmtDate(j.updatedAt))}</td></tr>`).join('')}</table>`
      : '<div class="more">עבודות קטלוג שיסתיימו כשהמתג פעיל יופיעו כאן, עם קישור לרשומה.</div>'}
    </section>`;
}
async function toggleIntegration(on) {
  if (on && !confirm('להפעיל קליטה אוטומטית? מעכשיו כל עבודת קטלוג שמסתיימת תיכנס למאגר כרשומה (טיוטה). אפשר לכבות בכל רגע.')) return;
  try { const r = await api('/api/arc/integration', { method: 'POST', body: { auto_ingest: !!on } }); toast(r.auto_ingest ? 'הקליטה האוטומטית הופעלה' : 'הקליטה האוטומטית כובתה'); await loadIntegrationDot(); await openIntegration(); }
  catch (e) { toast(e.message, 'err'); }
}
async function probeIntegration() {
  const out = $('integ-probe-out'); out.textContent = 'מריץ…';
  try { const r = await api('/api/arc/integration/probe', { method: 'POST' }); out.innerHTML = `<span style="color:var(--good)">✓ החיבור תקין</span> · ${esc(r.python)} · דייר #${esc(r.repo)} · ${r.ms} ms · הקליטה הגיעה עד בסיס הנתונים בלי לכתוב דבר.`; }
  catch (e) { out.innerHTML = `<span style="color:var(--error)">✗ ${esc(e.message)}</span>`; }
}

// ---- from the cataloging screens: archive.html#job=<id> ---------------------
// The ingest runs right after the job finishes; the route answers 202 until the
// record exists, so we wait a little instead of failing the click.
async function openJob(jobId) {
  await renderTree();
  for (let i = 0; i < 12; i++) {
    const r = await fetch('/api/arc/jobs/' + encodeURIComponent(jobId), { headers: { 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.record_id) { await openRecord(j.record_id); return; }
    if (r.status === 202) {
      $('card').innerHTML = `<div class="empty">הרשומה של העבודה <code>${esc(jobId)}</code> נקלטת למאגר…<br><small>${j.pending ? 'הקטלוג הסתיים; הקליטה רצה ברקע (שניות אחדות).' : 'העבודה עדיין ' + esc(STATUS_JOB_HE[j.status] || j.status || '') + '.'}</small></div>`;
      await new Promise(res => setTimeout(res, j.pending ? 2000 : 5000));
      continue;
    }
    toast(j.error || ('העבודה לא נמצאה: ' + r.status), 'err');
    $('card').innerHTML = `<div class="empty">${esc(j.error || 'העבודה לא נמצאה')}<br><small>ייתכן שהשרת הופעל מחדש; חפשי את הרשומה לפי הכותר בעץ.</small></div>`;
    return;
  }
  $('card').innerHTML = '<div class="empty">הקליטה למאגר טרם הסתיימה. רענני את הדף בעוד רגע, או חפשי את הרשומה לפי הכותר.</div>';
}
const STATUS_JOB_HE = { queued: 'בתור', running: 'רצה', error: 'נכשלה', cancelled: 'בוטלה' };

// ---- new node -------------------------------------------------------------
function showNewNode(parent) {   // parent: null (root) or {id, level, title}
  state.newParent = parent ? parent.id : null;
  const minIdx = parent ? LEVELS.indexOf(parent.level) + 1 : 0;
  $('nn-level').innerHTML = LEVELS.map((l, i) => `<option value="${l}"${i < minIdx ? ' disabled' : ''}${i === minIdx ? ' selected' : ''}>${LEVEL_HE[l]}</option>`).join('');
  $('newnode-title').textContent = parent ? `רשומת-בת חדשה תחת: ${parent.title}` : 'יחידת-תיאור חדשה ברמת השורש';
  $('nn-ref').value = ''; $('nn-he').value = ''; $('nn-en').value = '';
  $('nn-catalog-row').style.display = parent ? 'none' : '';
  $('nn-catalog').innerHTML = '<option value="">קטלוג: — ללא —</option>' + ((state.cat && state.cat.order) || []).map(c => `<option value="${c}">קטלוג: ${esc(catName(c))}</option>`).join('');
  $('newnode').classList.add('show'); $('nn-he').focus();
}
async function createNode() {
  const body = { parentId: state.newParent, level: $('nn-level').value, ref_code: $('nn-ref').value.trim(), title_he: $('nn-he').value.trim() || null, title_en: $('nn-en').value.trim() || null, catalog: state.newParent ? null : ($('nn-catalog').value || null) };
  if (!body.ref_code) return toast('נדרש מספר-ייחוס', 'err');
  if (!body.title_he && !body.title_en) return toast('נדרש כותר (עברית או אנגלית)', 'err');
  try {
    const r = await api('/api/arc/records', { method: 'POST', body });
    $('newnode').classList.remove('show');
    if (state.newParent) state.expanded.add(state.newParent);
    toast(`נוצרה ${LEVEL_HE[r.level]} ${r.ref_code}`);
    await loadStats(); await loadCatalogs(); await openRecord(r.id);
  } catch (e) { toast(e.message, 'err'); }
}

// ---- move mode ------------------------------------------------------------
function startMove() {
  if (!state.rec) return;
  state.moving = state.rec.record.id;
  const b = $('move-banner'); b.innerHTML = `מעבירים את <b>${esc(state.rec.record.title_he || state.rec.record.ref_code)}</b> — לחצי על יחידת-האב החדשה בעץ, או <a data-move-root style="cursor:pointer;text-decoration:underline">לשורש</a> · Esc לביטול`; b.classList.add('show');
}
function endMove() { state.moving = null; $('move-banner').classList.remove('show'); }
async function doMove(parentId) {
  const id = state.moving; if (!id) return;
  try {
    await api('/api/arc/records/' + id + '/move', { method: 'POST', body: { parent_id: parentId } });
    endMove(); toast('הרשומה הועברה');
    if (parentId) state.expanded.add(parentId);
    await loadCatalogs(); await openRecord(id);
  } catch (e) { toast(e.message, 'err'); }
}

// ---- events (delegated) ---------------------------------------------------
document.addEventListener('click', async ev => {
  const t = ev.target;
  const node = t.closest('.node');
  if (node) {
    const id = Number(node.dataset.id);
    if (state.moving) { if (id !== state.moving) await doMove(id); return; }
    if (t.classList.contains('tw') && node.dataset.leaf !== '1') {
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      const kids = node.parentElement.querySelector('ul.kids');
      node.querySelector('.tw').textContent = state.expanded.has(id) ? '▾' : '◂';
      if (state.expanded.has(id)) { if (!kids.children.length) await loadChildren(kids, id).catch(e => toast(e.message, 'err')); kids.style.display = ''; }
      else kids.style.display = 'none';
      return;
    }
    if (!state.expanded.has(id) && node.dataset.leaf !== '1') { state.expanded.add(id); const kids = node.parentElement.querySelector('ul.kids'); node.querySelector('.tw').textContent = '▾'; if (!kids.children.length) await loadChildren(kids, id).catch(() => {}); kids.style.display = ''; }
    await openRecord(id, { keepTree: true }); return;
  }
  const res = t.closest('.results li'); if (res) { await openRecord(Number(res.dataset.id), { keepTree: true }); return; }
  if (t.dataset.goto !== undefined) { $('q').value = ''; $('f-level').value = ''; $('f-status').value = ''; await openRecord(t.dataset.goto ? Number(t.dataset.goto) : null); if (!t.dataset.goto) refreshTree(); return; }
  if (t.dataset.moveRoot !== undefined) { await doMove(null); return; }
  const chip = t.closest('.cchip'); if (chip) { state.catFilter = state.catFilter === chip.dataset.catalog ? '' : chip.dataset.catalog; await loadCatalogs(); refreshTree(); return; }
  if (t.id === 'btn-cat-init') {
    try {
      const r = await api('/api/arc/catalogs/init', { method: 'POST' });
      toast(`קטלוגי ספיר: ${r.created} חטיבות נוצרו · ${r.adopted} רשומות סודרו`);
      await loadStats(); await loadCatalogs(); refreshTree(); if (state.rec) await openRecord(state.rec.record.id, { keepTree: true });
    } catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.id === 'btn-save') return save();
  if (t.id === 'btn-revert') { $('card').querySelectorAll('[data-field]').forEach(el => { el.value = el.dataset.orig; el.classList.remove('changed'); }); state.dirty = {}; setDirty(); return; }
  if (t.dataset.status) {
    const to = t.dataset.status;
    if (to === 'withdrawn' && !confirm('להסיר את הרשומה? היא לא נמחקת — נשארת בהיסטוריה ואפשר להחזירה לטיוטה.')) return;
    try {
      const r = await api('/api/arc/records/' + state.rec.record.id + '/status', { method: 'POST', body: { status: to, reason: $('reason').value.trim() || null } });
      toast(`סטטוס: ${STATUS_HE[r.from]} → ${STATUS_HE[r.status]}`); await loadStats(); await openRecord(state.rec.record.id, { keepTree: true });
    } catch (e) { toast(e.message + (e.data && e.data.blockers ? ' — ' + e.data.blockers.map(b => BLOCKER_HE[b] || b).join('; ') : ''), 'err'); }
    return;
  }
  if (t.id === 'btn-move') return startMove();
  if (t.id === 'btn-integration') return openIntegration();
  if (t.id === 'integ-toggle') return toggleIntegration(t.dataset.on === '1');
  if (t.id === 'integ-probe') return probeIntegration();
  if (t.id === 'btn-new-child') return showNewNode({ id: state.rec.record.id, level: state.rec.record.level, title: state.rec.record.title_he || state.rec.record.ref_code });
  if (t.id === 'btn-new-root') return showNewNode(null);
  if (t.id === 'nn-save') return createNode();
  if (t.id === 'nn-cancel') { $('newnode').classList.remove('show'); return; }
  if (t.id === 'dt-add') {
    const display = $('dt-display').value.trim(); if (!display) return toast('נדרש טקסט תאריך', 'err');
    const iso = $('dt-iso').value.trim() || null;
    let start_d = null, end_d = null;
    const m = iso && iso.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:\/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?)?$/);
    if (m) { start_d = `${m[1]}-${m[2] || '01'}-${m[3] || '01'}`; const y2 = m[4] || m[1]; end_d = `${y2}-${m[5] || m[2] || '12'}-${m[6] || m[3] || (m[5] || m[2] ? '28' : '31')}`; }
    try { await api('/api/arc/records/' + state.rec.record.id + '/dates', { method: 'POST', body: { display, iso, start_d, end_d, kind: $('dt-kind').value, certain: !$('dt-approx').checked } }); toast('תאריך נוסף'); await openRecord(state.rec.record.id, { keepTree: true }); }
    catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.dataset.delDate) { try { await api(`/api/arc/records/${state.rec.record.id}/dates/${t.dataset.delDate}`, { method: 'DELETE' }); toast('תאריך נמחק'); await openRecord(state.rec.record.id, { keepTree: true }); } catch (e) { toast(e.message, 'err'); } return; }
  if (t.id === 'nt-add') {
    const body = $('nt-body').value.trim(); if (!body) return toast('נדרש טקסט', 'err');
    try { await api('/api/arc/records/' + state.rec.record.id + '/notes', { method: 'POST', body: { body, kind: $('nt-kind').value, lang: $('nt-lang').value } }); toast('הערה נוספה'); await openRecord(state.rec.record.id, { keepTree: true }); }
    catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.dataset.delNote) { try { await api(`/api/arc/records/${state.rec.record.id}/notes/${t.dataset.delNote}`, { method: 'DELETE' }); toast('הערה נמחקה'); await openRecord(state.rec.record.id, { keepTree: true }); } catch (e) { toast(e.message, 'err'); } return; }
  const ver = t.closest('.ver'); if (ver) return showDiff(Number(ver.dataset.ver));
});
document.addEventListener('input', ev => { if (ev.target.dataset && ev.target.dataset.field) onFieldInput(ev.target); });
document.addEventListener('change', ev => {
  if (ev.target.dataset && ev.target.dataset.field) onFieldInput(ev.target);
  if (ev.target.id === 'f-level' || ev.target.id === 'f-status') refreshTree();
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); save(); }
  if (ev.key === 'Escape') { endMove(); $('newnode').classList.remove('show'); }
  if (ev.key === 'Enter' && ev.target.id === 'nt-body') $('nt-add').click();
  if (ev.key === 'Enter' && (ev.target.id === 'dt-display' || ev.target.id === 'dt-iso')) $('dt-add').click();
  if (ev.key === 'Enter' && ev.target.closest('#newnode')) createNode();
});
$('q').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(refreshTree, 220); });
window.addEventListener('beforeunload', ev => { if (Object.keys(state.dirty).length) { ev.preventDefault(); ev.returnValue = ''; } });

// ---- boot -----------------------------------------------------------------
(async function boot() {
  $('f-level').innerHTML += LEVELS.map(l => `<option value="${l}">${LEVEL_HE[l]}</option>`).join('');
  $('f-status').innerHTML += Object.entries(STATUS_HE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  try {
    if (!(await loadHeader())) return;
    await loadCatalogs(); await loadIntegrationDot();
    const m = location.hash.match(/r=(\d+)/);
    const jm = location.hash.match(/job=([\w-]+)/);
    if (m) await openRecord(Number(m[1]));
    else if (jm) await openJob(jm[1]);
    else if (/#integration/.test(location.hash)) { await renderTree(); await openIntegration(); }
    else await renderTree();
  } catch (e) { toast(e.message, 'err'); $('tree-body').innerHTML = `<div class="tree-empty">${esc(e.message)}</div>`; }
})();
})();
