const $ = id => document.getElementById(id);
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }   // delegates to the ONE canonical escaper; inline fallback covers pre-load calls

/* server base — same convention/localStorage key as names/photos/films/documents/wiki-entities */
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
  return window.yvServerBase ? yvServerBase({ inputEl: serverUrlInput })
       : (serverUrlInput.value || '').trim().replace(/\/$/, '');
}
function api(p){ return serverBase() + p; }
function outputUrl(name){
  const base = serverBase();
  const path = '/api/output/' + encodeURIComponent(name);
  return base ? base + path : path;
}

/* ---------- state ---------- */
const state = { clusters: [], tab: 'all', cursor: -1, busy: new Set() };

const STATUS_LABEL = { pending: 'ממתין', approved: 'אושר', rejected: 'נדחה' };

function filtered(){
  if (state.tab === 'all') return state.clusters;
  return state.clusters.filter(c => c.status === state.tab);
}

function memberField(label, val){
  return val ? `<div class="row"><b>${esc(label)}:</b> ${esc(val)}</div>` : '';
}

function memberHtml(m){
  const tikBit = m.tikOutput
    ? `<a href="${esc(outputUrl(m.tikOutput))}" target="_blank" rel="noopener">${esc(m.tikTitle || m.tikFile)}</a>`
    : esc(m.tikTitle || m.tikFile || '—');
  return `<div class="member">
    <div class="nm">${esc(m.name || m.nameOriginal)}${m.nameOriginal && m.nameOriginal !== m.name ? ` <small dir="auto" style="unicode-bidi:isolate">(${esc(m.nameOriginal)})</small>` : ''}</div>
    ${memberField('תפקיד', m.role)}
    ${memberField('לידה', m.birth)}
    ${memberField('פטירה', m.death)}
    ${memberField('מקום', m.place)}
    ${memberField('גורל', m.fate)}
    <div class="tik">${tikBit}</div>
  </div>`;
}

function clusterHtml(c, i){
  const isActive = i === state.cursor;
  const busy = state.busy.has(c.id);
  const decidedLine = c.decidedAt
    ? `<span class="decided-by">${esc(c.decidedBy || 'לא ידוע')} · ${new Date(c.decidedAt).toLocaleString('he-IL')}</span>`
    : '';
  return `<div class="cluster-card${isActive ? ' active' : ''}" data-idx="${i}" data-id="${esc(c.id)}">
    <div class="cluster-head">
      <span class="cluster-id">אשכול ${esc(c.id)} · ${c.memberCount} מופעים ב-${c.tikCount} תיקים</span>
      <span class="status-chip ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
    </div>
    <div class="members-grid">${c.members.map(memberHtml).join('')}</div>
    <div class="actions">
      <button type="button" class="btn-approve" data-action="approve" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>מיזוג ✓</button>
      <button type="button" class="btn-reject" data-action="reject" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>לא אותו אדם ✗</button>
      ${decidedLine}
      <span class="kbd-hint">י = מיזוג · ל = לא אותו אדם</span>
    </div>
  </div>`;
}

function render(){
  const area = $('list-area'); if (!area) return;
  const rows = filtered();
  if (state.cursor >= rows.length) state.cursor = rows.length ? rows.length - 1 : -1;
  area.innerHTML = rows.length
    ? rows.map(clusterHtml).join('')
    : '<div class="none">אין אשכולות בסינון הזה</div>';
  const decided = state.clusters.filter(c => c.status !== 'pending').length;
  $('progress-count').textContent = `${decided} מתוך ${state.clusters.length} הוכרעו`;
  $('progress-fill').style.width = state.clusters.length ? `${Math.round(100 * decided / state.clusters.length)}%` : '0%';
}

function setTab(t){
  state.tab = t;
  state.cursor = -1;
  ['all', 'pending', 'approved', 'rejected'].forEach(k => $('tab-' + k).classList.toggle('active', k === t));
  render();
}

async function decide(clusterId, decision){
  if (state.busy.has(clusterId)) return;
  state.busy.add(clusterId);
  render();
  try {
    const res = await fetch(api('/api/wiki-merge/decision'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clusterId, decision }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || 'שגיאה בשמירת ההחלטה'); return; }
    const c = state.clusters.find(x => x.id === clusterId);
    if (c) { c.status = data.status; c.decidedAt = data.decidedAt; c.decidedBy = data.decidedBy; }
  } catch (e) {
    alert('לא ניתן להגיע לשרת');
  } finally {
    state.busy.delete(clusterId);
    // advance the cursor to the next pending cluster in the current view
    const rows = filtered();
    const idx = rows.findIndex(x => x.id === clusterId);
    if (idx >= 0) {
      const next = rows.slice(idx + 1).findIndex(x => x.status === 'pending');
      state.cursor = next >= 0 ? idx + 1 + next : Math.min(idx, rows.length - 1);
    }
    render();
  }
}

function renderApp(meta){
  $('app').innerHTML = `
    <div class="counters">
      <div class="tile"><div class="tn" id="c-total">—</div><div class="tl">אשכולות סה"כ</div></div>
      <div class="tile"><div class="tn" id="c-pending">—</div><div class="tl">ממתינים</div></div>
      <div class="tile"><div class="tn" id="c-approved">—</div><div class="tl">אושרו</div></div>
      <div class="tile"><div class="tn" id="c-rejected">—</div><div class="tl">נדחו</div></div>
    </div>
    <div class="progress-line">
      <span id="progress-count">0 מתוך 0 הוכרעו</span>
      <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" id="tab-all">הכול</button>
      <button type="button" class="tab" id="tab-pending">ממתין</button>
      <button type="button" class="tab" id="tab-approved">אושר</button>
      <button type="button" class="tab" id="tab-rejected">נדחה</button>
    </div>
    <div id="list-area"></div>`;
  $('tab-all').addEventListener('click', () => setTab('all'));
  $('tab-pending').addEventListener('click', () => setTab('pending'));
  $('tab-approved').addEventListener('click', () => setTab('approved'));
  $('tab-rejected').addEventListener('click', () => setTab('rejected'));

  $('list-area').addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-action]');
    if (btn) { decide(btn.dataset.id, btn.dataset.action); return; }
    const card = ev.target.closest('.cluster-card');
    if (card) state.cursor = Number(card.dataset.idx);
    render();
  });

  updateCounters();
}

function updateCounters(){
  $('c-total').textContent = state.clusters.length;
  $('c-pending').textContent = state.clusters.filter(c => c.status === 'pending').length;
  $('c-approved').textContent = state.clusters.filter(c => c.status === 'approved').length;
  $('c-rejected').textContent = state.clusters.filter(c => c.status === 'rejected').length;
}

/* keyboard shortcuts — act on the focused (cursor) card: י=approve, ל=reject */
document.addEventListener('keydown', ev => {
  if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
  const rows = filtered();
  if (state.cursor < 0 || state.cursor >= rows.length) return;
  const c = rows[state.cursor];
  if (ev.key === 'י' || ev.key === 'y') decide(c.id, 'approve');
  else if (ev.key === 'ל' || ev.key === 'n') decide(c.id, 'reject');
});

function renderEmptyState(reason){
  $('app').innerHTML = `<div class="cluster-card empty-state">
    <div class="big">⚠ עדיין אין אשכולות מועמדים-למיזוג${reason ? ' (' + esc(reason) + ')' : ''}</div>
    <div>מסך זה נקרא מ-<code style="display:inline">names_index_&lt;תאריך&gt;.csv</code> — הרץ בשרת:</div>
    <code>python3 cli/yv.py doc names</code>
    <div>ואז רענן.</div>
  </div>`;
}

async function load(){
  const base = serverBase();
  let res;
  try { res = await fetch((base || '') + '/api/wiki-merge/clusters', { cache: 'no-store' }); }
  catch (e) { renderEmptyState('לא ניתן להגיע לשרת — בדוק כתובת שרת/tunnel'); return; }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    renderEmptyState(data.error || ('שגיאת שרת ' + res.status));
    return;
  }
  let data;
  try { data = await res.json(); } catch (e) { renderEmptyState('JSON לא תקין'); return; }
  state.clusters = Array.isArray(data.clusters) ? data.clusters : [];
  if (!state.clusters.length) { renderEmptyState('הקובץ לא נמצא או ריק'); return; }
  renderApp(data);
  render();
}

load();
