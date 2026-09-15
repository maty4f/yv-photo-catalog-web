/* entities.inline1.js — the identity screen: persons/bodies, merge candidates,
   places, subjects. Talks to /api/arc/entities/*. No inline handlers (CSP). */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_HE = { photo: 'תצלום', film: 'סרט', doc: 'מסמך', tik: 'תיק' };
const STATUS_HE = { candidate: 'מועמד', draft: 'טיוטה', approved: 'מאושר', deprecated: 'מוזג', rejected: 'נדחה' };
const STATUS_CLS = { candidate: 'cand', draft: 'cand', approved: 'appr', deprecated: 'rej', rejected: 'rej' };
const TYPE_HE = { person: 'אדם', family: 'משפחה', corporate: 'גוף' };
const ROLE_HE = { creator: 'יוצר', subject: 'נושא', author: 'מחבר', recipient: 'נמען', custodian: 'משמורן', donor: 'תורם', photographer: 'צלם', depicted: 'מצולם' };
const REC_STATUS_HE = { draft: 'טיוטה', draft_invalid: 'טיוטה פסולה', in_review: 'בביקורת', published: 'מפורסמת', withdrawn: 'הוסרה' };
const CONF = { high: '<span class="c-high">✓</span>', mid: '<span class="c-mid">~</span>', low: '<span class="c-low">?</span>' };
const state = { tab: 'agents', sel: null, selKind: null, agent: null, dirty: {}, filters: { q: '', status: '', quality: 'ok', min: 0 } };

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  if (!r.ok) { const e = new Error((j && j.error) || (r.status + ' ' + r.statusText)); e.status = r.status; e.data = j; throw e; }
  return j;
}
let toastT = null;
function toast(msg, cls = 'ok') { const t = $('toast'); t.textContent = msg; t.className = 'show ' + cls; clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, cls === 'err' ? 6000 : 2600); }
const fmtDate = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
const kdots = kinds => (kinds || []).map(k => `<span class="kd ${esc(k)}" title="${esc(KIND_HE[k] || k)}"></span>`).join('');

// ---- header / stats ---------------------------------------------------------
async function loadStats() {
  const s = await api('/api/arc/entities/stats');
  const by = s.agents_by_status || {};
  $('stats').innerHTML =
    `<span class="stat">מועמדים <b>${(by.candidate || 0) + (by.draft || 0)}</b></span>` +
    `<span class="stat good">מאושרים <b>${by.approved || 0}</b></span>` +
    `<span class="stat warn">חשודים כלא-שם <b>${s.suspects}</b></span>` +
    `<span class="stat link">התאמות פתוחות <b>${s.open_matches}</b></span>` +
    `<span class="stat link">אישים בכמה רשומות <b>${s.cross_record_agents}</b></span>` +
    `<span class="stat link">מקומות בכמה רשומות <b>${s.cross_record_places}</b></span>`;
  $('n-matches').textContent = s.open_matches; $('n-places').textContent = s.places; $('n-subjects').textContent = s.subjects;
  $('n-agents').textContent = (by.candidate || 0) + (by.draft || 0) + (by.approved || 0);
}

// ---- list pane -------------------------------------------------------------
function renderFilters() {
  const f = $('filters');
  if (state.tab === 'agents') f.innerHTML = `
    <input type="text" id="q" placeholder="חיפוש שם (עברית / לטינית)" value="${esc(state.filters.q)}" autocomplete="off">
    <select id="f-status"><option value="">כל המצבים</option>${Object.entries(STATUS_HE).filter(([k]) => k !== 'deprecated').map(([k, v]) => `<option value="${k}"${state.filters.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select id="f-quality"><option value="ok"${state.filters.quality === 'ok' ? ' selected' : ''}>שמות תקינים</option><option value="suspect"${state.filters.quality === 'suspect' ? ' selected' : ''}>חשודים כלא-שם</option><option value="all"${state.filters.quality === 'all' ? ' selected' : ''}>הכל</option></select>
    <label class="chk" style="font-size:12px;color:var(--muted)"><input type="checkbox" id="f-multi"${state.filters.min > 1 ? ' checked' : ''}> רק בכמה רשומות</label>`;
  else if (state.tab === 'matches') f.innerHTML = `<span style="font-size:12.5px;color:var(--muted)">זוגות שהמכונה מציעה כאותה ישות (Daitch-Mokotoff). מיזוג אינו הרסני: הכתיב השני נשמר כצורה נוספת.</span>
    <select id="f-mstatus"><option value="proposed">ממתינות</option><option value="merged">מוזגו</option><option value="rejected">נדחו</option></select>`;
  else if (state.tab === 'places') f.innerHTML = `<input type="text" id="q" placeholder="חיפוש מקום" value="${esc(state.filters.q)}" autocomplete="off">
    <label class="chk" style="font-size:12px;color:var(--muted)"><input type="checkbox" id="f-multi"${state.filters.min > 1 ? ' checked' : ''}> רק בכמה רשומות</label>`;
  else f.innerHTML = `<input type="text" id="q" placeholder="חיפוש נושא" value="${esc(state.filters.q)}" autocomplete="off">`;
}
async function renderList() {
  const L = $('list'); const foot = $('listfoot');
  try {
    if (state.tab === 'agents') {
      const p = new URLSearchParams({ limit: '300', quality: state.filters.quality });
      if (state.filters.q) p.set('q', state.filters.q); if (state.filters.status) p.set('status', state.filters.status); if (state.filters.min > 1) p.set('min_records', '2');
      const r = await api('/api/arc/entities/agents?' + p);
      L.innerHTML = r.rows.length ? r.rows.map(a => `<div class="row${state.sel === a.id && state.selKind === 'a' ? ' sel' : ''}" data-a="${a.id}">
          <span class="nm" title="${esc(a.authorized_en || '')}">${esc(a.authorized_he)}${a.authorized_en && a.authorized_en !== a.authorized_he ? `<small>${esc(a.authorized_en)}</small>` : ''}</span>
          ${a.open_matches ? `<span class="tag match" title="התאמות פתוחות">≈${a.open_matches}</span>` : ''}
          ${a.name_quality === 'suspect' ? `<span class="tag sus" title="${esc(a.quality_note || '')}">לא-שם?</span>` : ''}
          <span class="tag ${STATUS_CLS[a.status]}">${esc(STATUS_HE[a.status] || a.status)}</span>
          <span class="cnt"><b>${a.records}</b> ${kdots(a.kinds)}</span></div>`).join('') : '<div class="empty" style="margin:20px">אין ישויות.</div>';
      foot.innerHTML = `${r.total} ישויות` + (state.filters.quality === 'suspect' && r.total ? ` <button type="button" class="danger" id="btn-reject-suspects">דחיית כל החשודים</button>` : '');
    } else if (state.tab === 'matches') {
      const st = ($('f-mstatus') || {}).value || 'proposed';
      const r = await api('/api/arc/entities/matches?status=' + st + '&limit=300');
      L.innerHTML = r.rows.length ? r.rows.map(m => `<div class="mrow" data-a="${m.a_id}" data-b="${m.b_id}">
          <div class="pair">
            <div class="side"><b title="${esc(m.a_en || '')}">${esc(m.a_he)}</b><small>${esc(m.a_en || '')} · ${m.a_records} רשומות · ${esc(STATUS_HE[m.a_status])}${m.a_from ? ' · ' + esc(m.a_from) : ''}</small></div>
            <div class="eq">≟</div>
            <div class="side"><b title="${esc(m.b_en || '')}">${esc(m.b_he)}</b><small>${esc(m.b_en || '')} · ${m.b_records} רשומות · ${esc(STATUS_HE[m.b_status])}${m.b_from ? ' · ' + esc(m.b_from) : ''}</small></div>
          </div>
          <div class="why"><span class="score">${Number(m.score).toFixed(2)}</span> keys: ${esc((m.reasons && m.reasons.shared_keys || []).join(' '))}${m.reasons && m.reasons.same_birth ? ' · same birth' : ''}${m.reasons && m.reasons.same_record ? ' · same record' : ''}${m.decided_by ? ` · ${esc(m.decided_by)} ${esc(fmtDate(m.decided_at))}` : ''}</div>
          ${st === 'proposed' ? `<div class="acts">
            <button type="button" class="primary" data-merge="${m.a_id}" data-keep="${m.a_id}" data-other="${m.b_id}">מזג ← שמור "${esc((m.a_he || '').slice(0, 24))}"</button>
            <button type="button" class="primary" data-merge="${m.a_id}" data-keep="${m.b_id}" data-other="${m.b_id}">מזג ← שמור "${esc((m.b_he || '').slice(0, 24))}"</button>
            <button type="button" class="secondary" data-reject-match="${m.a_id}" data-b="${m.b_id}">לא אותה ישות</button>
            <button type="button" class="gear" data-open="${m.a_id}">פתח</button></div>` : ''}
        </div>`).join('') : '<div class="empty" style="margin:20px">אין התאמות במצב זה.</div>';
      foot.innerHTML = `${r.total} זוגות`;
    } else if (state.tab === 'places') {
      const p = new URLSearchParams({ limit: '300' }); if (state.filters.q) p.set('q', state.filters.q); if (state.filters.min > 1) p.set('min_records', '2');
      const r = await api('/api/arc/entities/places?' + p);
      L.innerHTML = r.rows.length ? r.rows.map(x => `<div class="row${state.sel === x.id && state.selKind === 'p' ? ' sel' : ''}" data-p="${x.id}">
          <span class="nm" title="${esc(x.name_en || '')}">${esc(x.name_he)}${x.name_en && x.name_en !== x.name_he ? `<small>${esc(x.name_en)}</small>` : ''}</span>
          ${x.kind ? `<span class="tag">${esc(x.kind)}</span>` : ''}${x.qid ? `<span class="tag" title="Wikidata">${esc(x.qid)}</span>` : ''}
          <span class="cnt"><b>${x.records}</b> ${kdots(x.kinds)}</span></div>`).join('') : '<div class="empty" style="margin:20px">אין מקומות.</div>';
      foot.innerHTML = `${r.total} מקומות`;
    } else {
      const r = await api('/api/arc/entities/subjects?limit=500' + (state.filters.q ? '&q=' + encodeURIComponent(state.filters.q) : ''));
      L.innerHTML = r.rows.length ? r.rows.map(x => `<div class="row"><span class="nm">${esc(x.pref_he)}${x.pref_en ? `<small>${esc(x.pref_en)}</small>` : ''}</span><span class="cnt"><b>${x.records}</b></span></div>`).join('') : '<div class="empty" style="margin:20px">אין נושאים.</div>';
      foot.innerHTML = `${r.total} נושאים (מהתזאורוס המאושר)`;
    }
  } catch (e) { L.innerHTML = `<div class="empty" style="margin:20px">${esc(e.message)}</div>`; }
}
function switchTab(tab) {
  state.tab = tab; state.filters.q = '';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderFilters(); renderList();
}

// ---- agent detail ------------------------------------------------------------
function field(label, name, value, { type = 'text', ltr = false } = {}) {
  const v = value == null ? '' : value;
  return `<div class="frow"><label>${esc(label)}</label>${type === 'textarea' ? `<textarea data-field="${name}">${esc(v)}</textarea>` : `<input type="text" data-field="${name}" value="${esc(v)}"${ltr ? ' style="direction:ltr;text-align:left"' : ''}>`}</div>`;
}
async function openAgent(id) {
  try {
    const d = await api('/api/arc/entities/agents/' + id);
    state.agent = d; state.sel = Number(id); state.selKind = 'a'; state.dirty = {};
    location.hash = 'a=' + id;
    const a = d.agent;
    const forms = [...(a.other_forms || []), ...(a.parallel_forms || [])].filter(Boolean);
    const open = d.matches.filter(m => m.status === 'proposed');
    $('detail').innerHTML = `
      <h2>${esc(a.authorized_he)}</h2>
      ${a.authorized_en && a.authorized_en !== a.authorized_he ? `<div class="en">${esc(a.authorized_en)}</div>` : ''}
      <div class="badges">
        <span class="badge ${STATUS_CLS[a.status]}">${esc(STATUS_HE[a.status] || a.status)}</span>
        <span class="badge">${esc(TYPE_HE[a.entity_type] || a.entity_type)}</span>
        ${a.name_quality === 'suspect' ? `<span class="badge sus" title="${esc(a.quality_note || '')}">חשוד כלא-שם: ${esc(a.quality_note || '')}</span>` : ''}
        ${a.fate ? `<span class="badge">גורל: ${esc(a.fate)}</span>` : ''}
        ${a.dm_codes && a.dm_codes.length ? `<span class="badge" dir="ltr" title="Daitch-Mokotoff">D-M ${esc(a.dm_codes.join(' '))}</span>` : ''}
        ${a.approved_by ? `<span class="badge appr">אושר: ${esc(a.approved_by)} · ${esc(fmtDate(a.approved_at))}</span>` : ''}
        ${a.merged_into ? `<span class="badge rej">מוזג לתוך <a data-open="${a.merged_into}" style="cursor:pointer;text-decoration:underline">#${a.merged_into}</a></span>` : ''}
      </div>
      <div class="actions" style="margin-bottom:14px">
        ${a.status !== 'deprecated' ? `
          ${a.status !== 'approved' ? `<button type="button" class="primary" data-astatus="approved">✓ אישור הישות</button>` : ''}
          ${a.status !== 'rejected' ? `<button type="button" class="danger" data-astatus="rejected">⊘ דחייה (לא ישות)</button>` : ''}
          ${a.status !== 'candidate' ? `<button type="button" class="secondary" data-astatus="candidate">↩ חזרה למועמד</button>` : ''}` : ''}
        <span class="grow"></span>
        <button type="button" class="secondary" id="btn-save" disabled>שמירת שדות</button>
      </div>

      ${open.length ? `<section class="area"><h3>המכונה מציעה: אותה ישות? <small>${open.length}</small></h3>
        ${open.map(m => `<div class="mrow" style="padding:8px 0"><div class="pair">
          <div class="side"><b>${esc(a.authorized_he)}</b><small>${d.appearances.length} רשומות</small></div><div class="eq">≟</div>
          <div class="side"><b><a data-open="${m.other_id}" style="cursor:pointer;color:var(--accent)">${esc(m.other_he)}</a></b><small>${esc(m.other_en || '')} · ${m.other_records} רשומות · ${esc(STATUS_HE[m.other_status])}</small></div></div>
          <div class="why"><span class="score">${Number(m.score).toFixed(2)}</span> keys: ${esc((m.reasons && m.reasons.shared_keys || []).join(' '))}</div>
          <div class="acts">
            <button type="button" class="primary" data-merge="${m.a_id}" data-b="${m.b_id}" data-keep="${a.id}">מזג לכאן (שמור "${esc(a.authorized_he.slice(0, 20))}")</button>
            <button type="button" class="secondary" data-merge="${m.a_id}" data-b="${m.b_id}" data-keep="${m.other_id}">מזג לשם (שמור "${esc(m.other_he.slice(0, 20))}")</button>
            <button type="button" class="gear" data-reject-match="${m.a_id}" data-b="${m.b_id}">לא אותה ישות</button></div></div>`).join('')}</section>` : ''}

      <section class="area"><h3>מופיע/ה ב- <small>${d.appearances.length} רשומות · הקישור בין החומרים</small></h3>
        ${d.appearances.length ? d.appearances.map(r => `<div class="app">
          <span><span class="kd ${esc(r.kind || '')}"></span></span>
          <span class="t" title="${esc(r.title_en || '')}">${esc(r.title_he || r.title_en || r.ref_code)}<small>${esc(r.ref_code)}${r.parent_title ? ' · ' + esc(r.parent_title) : ''}</small></span>
          <span class="role">${CONF[r.confidence] || ''} ${esc(ROLE_HE[r.role] || r.role)}${r.pages ? ` · עמ׳ ${esc(r.pages)}` : ''} · ${esc(REC_STATUS_HE[r.status] || r.status)}</span>
          <span><a href="archive.html#r=${r.id}">פתח רשומה ↗</a> <button type="button" class="x" data-unlink="${r.id}" data-role="${esc(r.role)}" title="ניתוק הקישור">✕</button></span></div>`).join('') : '<div class="empty" style="padding:20px">לא מקושר/ת לאף רשומה.</div>'}
        <div class="linkrow"><input type="text" id="link-q" placeholder="קישור לרשומה: חיפוש כותר / מספר-ייחוס…" autocomplete="off">
          <select id="link-role">${Object.entries(ROLE_HE).map(([k, v]) => `<option value="${k}"${k === 'subject' ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <select id="link-conf"><option value="high">✓ ודאי</option><option value="mid">~ סביר</option><option value="low">? משוער</option></select></div>
        <div id="link-results"></div>
      </section>

      <section class="area"><h3>רשומת הסמכות <small>ISAAR(CPF)</small></h3>
        ${field('שם מוסמך (עברית)', 'authorized_he', a.authorized_he)}
        ${field('שם מוסמך (לטינית)', 'authorized_en', a.authorized_en, { ltr: true })}
        <div class="frow"><label>סוג</label><select data-field="entity_type">${Object.entries(TYPE_HE).map(([k, v]) => `<option value="${k}"${a.entity_type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        ${field('תאריכי קיום — מ', 'exist_from', a.exist_from, { ltr: true })}
        ${field('עד', 'exist_to', a.exist_to, { ltr: true })}
        ${field('גורל', 'fate', a.fate)}
        ${field('היסטוריה (עברית)', 'history_he', a.history_he, { type: 'textarea' })}
        ${field('History (English)', 'history_en', a.history_en, { type: 'textarea' })}
        ${field('הערת מקור', 'source_note', a.source_note, { type: 'textarea' })}
        <div class="frow"><label>צורות נוספות</label><div class="v forms">${forms.length ? forms.map(f => `<span class="chip">${esc(f)}</span>`).join('') : '<span style="color:var(--muted)">—</span>'}</div></div>
        ${d.merged_from.length ? `<div class="frow"><label>מוזגו לכאן</label><div class="v">${d.merged_from.map(m => `<span class="chip">${esc(m.authorized_he)}${m.authorized_en ? ' · ' + esc(m.authorized_en) : ''}</span>`).join(' ')}</div></div>` : ''}
        ${a.places && a.places.length ? `<div class="frow"><label>מקומות (מהמנוע)</label><div class="v">${esc(a.places.join(', '))}</div></div>` : ''}
        <div class="frow"><label>מזהה פנימי</label><div class="v" dir="ltr">#${a.id} · ${esc(a.provenance && a.provenance.source || '')} · ${esc(fmtDate(a.created_at))}</div></div>
      </section>`;
    $('detail').querySelectorAll('[data-field]').forEach(el => { el.dataset.orig = el.value; });
    document.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel'));
    const row = document.querySelector(`.row[data-a="${id}"]`); if (row) row.classList.add('sel');
  } catch (e) { toast(e.message, 'err'); }
}
async function openPlace(id) {
  try {
    const d = await api('/api/arc/entities/places/' + id);
    state.sel = Number(id); state.selKind = 'p'; state.agent = null; location.hash = 'p=' + id;
    const p = d.place;
    $('detail').innerHTML = `
      <h2>${esc(p.name_he)}</h2>${p.name_en && p.name_en !== p.name_he ? `<div class="en">${esc(p.name_en)}</div>` : ''}
      <div class="badges">${p.kind ? `<span class="badge">${esc(p.kind)}</span>` : ''}${p.country_1939 ? `<span class="badge">גבולות 1939: ${esc(p.country_1939)}</span>` : ''}
        ${p.qid ? `<a class="badge" href="https://www.wikidata.org/wiki/${esc(p.qid)}" target="_blank" rel="noopener" style="text-decoration:none;color:var(--accent)">Wikidata ${esc(p.qid)} ↗</a>` : ''}
        ${p.lat != null ? `<span class="badge" dir="ltr">${p.lat}, ${p.lon}</span>` : ''}
        ${(p.historic_names || []).length ? `<span class="badge" title="שמות היסטוריים">${esc(p.historic_names.join(' · '))}</span>` : ''}</div>
      <section class="area"><h3>מופיע ב- <small>${d.appearances.length} רשומות</small></h3>
        ${d.appearances.length ? d.appearances.map(r => `<div class="app"><span><span class="kd ${esc(r.kind || '')}"></span></span>
          <span class="t">${esc(r.title_he || r.title_en || r.ref_code)}<small>${esc(r.ref_code)}</small></span>
          <span class="role">${CONF[r.confidence] || ''} ${esc(r.role || '')} · ${esc(REC_STATUS_HE[r.status] || r.status)}</span>
          <span><a href="archive.html#r=${r.id}">פתח רשומה ↗</a></span></div>`).join('') : '<div class="empty" style="padding:20px">אין רשומות.</div>'}</section>
      ${d.events.length ? `<section class="area"><h3>אירועים מתועדים במקום <small>${d.events.length}</small></h3>${d.events.map(e => `<div class="app"><span></span><span class="t">${esc(e.label_he)}</span><span class="role" dir="ltr">${esc(e.date_display || '')}</span><span></span></div>`).join('')}</section>` : ''}`;
    document.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel'));
    const row = document.querySelector(`.row[data-p="${id}"]`); if (row) row.classList.add('sel');
  } catch (e) { toast(e.message, 'err'); }
}

// ---- actions -----------------------------------------------------------------
async function refreshAll() { await loadStats(); await renderList(); if (state.selKind === 'a' && state.sel) await openAgent(state.sel); }
async function saveAgent() {
  if (!state.agent || !Object.keys(state.dirty).length) return;
  try { const r = await api('/api/arc/entities/agents/' + state.agent.agent.id, { method: 'PATCH', body: { patch: state.dirty } }); toast('נשמר: ' + r.changed.join(', ')); await refreshAll(); }
  catch (e) { toast(e.message, 'err'); }
}
async function mergePair(a, b, keep) {
  if (!confirm('למזג את שתי הישויות? הקישורים עוברים לישות שנשמרת, והכתיב השני נשמר כצורה נוספת. הפעולה נרשמת ביומן.')) return;
  try { const r = await api(`/api/arc/entities/matches/${a}/${b}`, { method: 'POST', body: { decision: 'merge', keep } }); toast(`מוזג — נשמרה #${r.kept}`); if (state.selKind === 'a' && state.sel === Number(r.deprecated)) state.sel = Number(r.kept); await refreshAll(); }
  catch (e) { toast(e.message, 'err'); }
}
async function rejectPair(a, b) {
  try { await api(`/api/arc/entities/matches/${a}/${b}`, { method: 'POST', body: { decision: 'reject' } }); toast('סומן: לא אותה ישות'); await refreshAll(); }
  catch (e) { toast(e.message, 'err'); }
}
let linkT = null;
async function searchRecordsForLink(q) {
  const box = $('link-results'); if (!q) { box.innerHTML = ''; return; }
  const r = await api('/api/arc/records?q=' + encodeURIComponent(q) + '&limit=8');
  box.innerHTML = r.rows.map(x => `<div class="app"><span><span class="kd ${esc(x.kind || '')}"></span></span><span class="t">${esc(x.title_he || x.title_en || x.ref_code)}<small>${esc(x.ref_code)}</small></span><span class="role">${esc(REC_STATUS_HE[x.status] || '')}</span><span><button type="button" class="secondary" data-link="${x.id}" style="padding:3px 10px;font-size:12px">קשר</button></span></div>`).join('') || '<div style="color:var(--muted);font-size:12.5px;padding:6px 0">אין תוצאות</div>';
}

document.addEventListener('click', async ev => {
  const t = ev.target;
  const tab = t.closest('.tab'); if (tab) return switchTab(tab.dataset.tab);
  const rowA = t.closest('.row[data-a]'); if (rowA) return openAgent(Number(rowA.dataset.a));
  const rowP = t.closest('.row[data-p]'); if (rowP) return openPlace(Number(rowP.dataset.p));
  if (t.dataset.open) { switchTab('agents'); return openAgent(Number(t.dataset.open)); }
  if (t.dataset.merge) return mergePair(Number(t.dataset.merge), Number(t.dataset.b || t.dataset.other), Number(t.dataset.keep));
  if (t.dataset.rejectMatch) return rejectPair(Number(t.dataset.rejectMatch), Number(t.dataset.b));
  if (t.dataset.astatus && state.agent) {
    const to = t.dataset.astatus;
    if (to === 'rejected' && !confirm('לדחות? הישות נשארת ביומן אבל יוצאת מתור-האישור ומההתאמות.')) return;
    try { const r = await api('/api/arc/entities/agents/' + state.agent.agent.id + '/status', { method: 'POST', body: { status: to } }); toast(`${STATUS_HE[r.from]} → ${STATUS_HE[r.status]}`); await refreshAll(); }
    catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.id === 'btn-save') return saveAgent();
  if (t.id === 'btn-reject-suspects') {
    if (!confirm('לדחות את כל השמות החשודים (שאינם מקושרים לרשומה מפורסמת)? כל דחייה נרשמת ביומן.')) return;
    try { const r = await api('/api/arc/entities/agents/reject-suspects', { method: 'POST', body: {} }); toast(`נדחו ${r.rejected} ישויות`); await refreshAll(); } catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.dataset.unlink && state.agent) {
    try { await api(`/api/arc/records/${t.dataset.unlink}/agents/${state.agent.agent.id}?role=${encodeURIComponent(t.dataset.role)}`, { method: 'DELETE' }); toast('הקישור נותק'); await refreshAll(); } catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (t.dataset.link && state.agent) {
    try { await api(`/api/arc/records/${t.dataset.link}/agents`, { method: 'POST', body: { agent_id: state.agent.agent.id, role: $('link-role').value, confidence: $('link-conf').value } }); toast('קושר'); await refreshAll(); } catch (e) { toast(e.message, 'err'); }
    return;
  }
});
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'q') { state.filters.q = el.value.trim(); clearTimeout(linkT); linkT = setTimeout(renderList, 220); }
  else if (el.id === 'link-q') { clearTimeout(linkT); linkT = setTimeout(() => searchRecordsForLink(el.value.trim()).catch(e => toast(e.message, 'err')), 250); }
  else if (el.dataset && el.dataset.field) {
    if (el.value !== el.dataset.orig) { state.dirty[el.dataset.field] = el.value; el.classList.add('changed'); } else { delete state.dirty[el.dataset.field]; el.classList.remove('changed'); }
    $('btn-save').disabled = !Object.keys(state.dirty).length;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'f-status') { state.filters.status = el.value; renderList(); }
  else if (el.id === 'f-quality') { state.filters.quality = el.value; renderList(); }
  else if (el.id === 'f-multi') { state.filters.min = el.checked ? 2 : 0; renderList(); }
  else if (el.id === 'f-mstatus') renderList();
  else if (el.dataset && el.dataset.field) { el.dispatchEvent(new Event('input', { bubbles: true })); }
});
document.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); saveAgent(); } });

(async function boot() {
  try {
    const st = await api('/api/arc/status');
    if (!st.enabled) { $('list').innerHTML = ''; $('detail').innerHTML = '<div class="empty"><b>שכבת הישויות צריכה Postgres.</b><br>הפעלה מקומית: <code>bash ops/arc-dev.sh</code> ואחריו <code>bash ops/arc-dev.sh backfill</code>.</div>'; return; }
    await loadStats();
    const m = location.hash.match(/^#(a|p)=(\d+)/);
    if (m && m[1] === 'p') { switchTab('places'); await openPlace(Number(m[2])); }
    else { switchTab('agents'); if (m) await openAgent(Number(m[2])); }
  } catch (e) { toast(e.message, 'err'); }
})();
})();
