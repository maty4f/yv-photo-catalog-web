function esc(x){ return window.yvEsc ? yvEsc(x) : String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }   // canonical delegate; upgraded from 4-char variant
function pill(s){ const m={ok:['ok','תקין'],limited:['warn','מוגבל'],error:['bad','שגיאה'],'no-key':['bad','אין מפתח'],unknown:['unk','בבדיקה…']}; const [c,l]=m[s]||['unk',s||'—']; return `<span class="pill ${c}">${l}</span>`; }
function dot(b){ return `<span class="dot ${b?'ok':'bad'}"></span>`; }
function up(s){ s=s||0; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return (h?h+' ש׳ ':'')+m+' דק׳'; }
function t(ms){ return ms ? new Date(ms).toLocaleTimeString('he-IL') : '—'; }
function fmtDur(s){ if(s==null||isNaN(s)) return '—'; if(s<60) return s+' שנ׳'; const m=Math.floor(s/60); if(m<60) return m+' דק׳'+(s%60?' '+(s%60)+' שנ׳':''); const h=Math.floor(m/60); return h+' שע׳ '+(m%60)+' דק׳'; }
function kicon(k){ return ({film:'🎬',photo:'📷',doc:'📄'})[k]||'•'; }
function sbadge(st){ const m={done:['ok','✓ הושלם'],error:['bad','✗ שגיאה'],running:['ok','⏳ רץ'],queued:['warn','בתור']}; const [c,l]=m[st]||['unk',st||'—']; return `<span class="pill ${c}" style="font-size:11px;padding:1px 8px">${l}</span>`; }
function kindCard(d){
  if(!d) return '';
  let cls,label;
  if(d.running>0){ cls='ok'; label='⏳ מקטלג כעת'; }
  else if(d.last && d.last.status==='done'){ cls='ok'; label='✓ תקין'; }
  else if(d.last && d.last.status==='error'){ cls='bad'; label='✗ שגיאה אחרונה'; }
  else if(d.last){ cls='warn'; label=d.last.status; }
  else { cls='unk'; label='— אין ריצות'; }
  return `<div class="card kind"><h3>${esc(d.label)}</h3><div class="big"><span class="pill ${cls}">${label}</span></div>
    <div class="row"><span>✓ הושלמו</span><b>${d.done||0}</b></div>
    <div class="row"><span>✗ שגיאות</span><b>${d.error||0}</b></div>
    <div class="row"><span>⏳ פעילות</span><b>${d.running||0}</b></div>
    <div class="row"><span>שיעור הצלחה</span><b>${d.successRatePct==null?'—':d.successRatePct+'%'}</b></div>
    <div class="row"><span>משך ממוצע</span><b>${fmtDur(d.avgDurationSec)}</b></div>
    ${d.last?`<div class="muted">אחרון: ${esc(d.last.name||'')}</div>`:''}</div>`;
}
function logCard(active){
  const a=(active||[])[0];
  if(!a) return `<div class="card" style="grid-column:1/-1"><h3>📋 לוג קטלוג</h3><div class="muted">אין קטלוג פעיל כרגע — הלוג יופיע כאן אוטומטית כשמתחיל קטלוג.</div></div>`;
  const lines=(a.log||[]).map(e=>`<div class="ll ${e.type==='error'?'le':e.type==='stderr'?'lw':''}">${esc(e.text)}</div>`).join('') || '<div class="ll muted">ממתין לפלט הראשון…</div>';
  const more=(active.length>1)?` · +${active.length-1} בתור`:'';
  return `<div class="card" style="grid-column:1/-1"><h3 class="livehead"><span class="blink"></span> לוג קטלוג פעיל — ${kicon(a.kind)} ${esc(a.name)} <span class="muted">${a.id}${more}</span></h3>
    <div class="row" style="margin:0 0 6px"><b>⏱ ${fmtDur(a.elapsedSec)}</b><span>${esc(a.stage||'')}</span></div>
    <div class="log" id="logbox">${lines}</div></div>`;
}
function historyTable(rows){
  if(!rows||!rows.length) return '<div class="muted">אין עבודות עדיין</div>';
  const trs=rows.map(r=>`<tr>
    <td>${kicon(r.kind)}</td>
    <td class="nm">${esc(r.name)}</td>
    <td>${sbadge(r.status)}</td>
    <td>${r.startedAt?new Date(r.startedAt).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</td>
    <td>${fmtDur(r.durationSec)}</td>
    <td class="of">${r.output?esc(r.output):'—'}</td>
  </tr>`).join('');
  return `<table class="tbl"><thead><tr><th></th><th>פריט</th><th>סטטוס</th><th>התחיל</th><th>משך</th><th>קובץ פלט</th></tr></thead><tbody>${trs}</tbody></table>`;
}
async function load(){
  let s;
  try{ s=await (await fetch('/api/status',{cache:'no-store'})).json(); }
  catch(e){ document.getElementById('grid').innerHTML='<div class="card"><div class="big">'+dot(false)+' השרת לא מגיב</div></div>'; return schedule(false); }
  document.getElementById('upd').textContent='עודכן '+t(s.ts);
  const g=s.gemini||{}, j=s.jobs||{}, r=s.resources||{}, pk=s.perKind||{}, sm=s.summary||{}, sy=s.system||{};
  document.getElementById('bar').innerHTML = `
    <div class="tile"><div class="tn">${sm.jobsToday??0}</div><div class="tl">עבודות היום</div></div>
    <div class="tile"><div class="tn">${sm.successRatePct==null?'—':sm.successRatePct+'%'}</div><div class="tl">שיעור הצלחה</div></div>
    <div class="tile"><div class="tn">${fmtDur(sm.avgDurationSec)}</div><div class="tl">משך ממוצע</div></div>
    <div class="tile"><div class="tn">${sm.active??0} / ${sm.queued??0}</div><div class="tl">פעיל / בתור</div></div>
    <div class="tile"><div class="tn">$${(s.spend?.todayUsd ?? s.estSpendUsd ?? 0)}</div><div class="tl">${s.spend ? 'עלות Gemini היום (אמיתית)' : 'עלות מוערכת'}</div></div>`;
  const errs=(j.recentErrors||[]).map(e=>`<div>✗ ${esc(e.id)} ${esc(e.name||'')} — ${esc(e.err||'')}</div>`).join('') || '<div class="muted">אין שגיאות אחרונות</div>';
  document.getElementById('grid').innerHTML = `
   <div class="card"><h3>שרת קטלוג</h3><div class="big">${dot(s.server?.up)} פעיל</div><div class="row"><span>זמן ריצה</span><b>${up(s.server?.uptimeSec)}</b></div></div>
   <div class="card"><h3>Tunnel · films.mf-sr.com</h3><div class="big">${dot(s.tunnel?.up)} ${s.tunnel?.up?'מחובר':'מנותק'}</div><div class="muted">הגישה מהמחשב בעבודה</div></div>
   <div class="card"><h3>Gemini API · חיוב</h3><div class="big">${pill(g.status)}</div><div class="row"><span>סוג מפתח</span><b>${esc(g.keyType||'—')}</b></div><div class="row"><span>פרטים</span><b>${esc(g.detail||'')}</b></div><div class="muted">נבדק: ${t(g.checkedAt)}</div></div>
   ${kindCard(pk.film)}
   ${kindCard(pk.photo)}
   ${kindCard(pk.doc)}
   <div class="card"><h3>משאבי מחשב</h3><div class="row"><span>זיכרון פנוי</span><b>${r.memFreePct ?? '—'}%</b></div><div class="row"><span>סה״כ RAM</span><b>${r.memTotalGB ?? '—'} GB</b></div><div class="row"><span>עומס (1 דק׳)</span><b>${r.load1 ?? '—'}</b></div></div>
   <div class="card"><h3>מערכת ואחסון</h3><div class="row"><span>דיסק פנוי</span><b>${sy.diskFreeGB ?? '—'} GB${sy.diskUsedPct!=null?' ('+sy.diskUsedPct+'%)':''}</b></div><div class="row"><span>קבצי פלט</span><b>${sy.outputCount ?? '—'}</b></div><div class="row"><span>העלאות זמניות</span><b>${sy.uploadsMB ?? 0} MB</b></div><div class="row"><span>PID · זיכרון שרת</span><b>${sy.pid ?? '—'} · ${sy.rssMB ?? '—'} MB</b></div></div>
   ${logCard(s.active)}
   <div class="card" style="grid-column:1/-1"><h3>היסטוריית פעולות (30 אחרונות)</h3>${historyTable(s.jobHistory)}</div>
   <div class="card" style="grid-column:1/-1"><h3>שגיאות אחרונות</h3><div class="errlist">${errs}</div></div>`;
  const lb=document.getElementById('logbox'); if(lb) lb.scrollTop=lb.scrollHeight;
  schedule((s.active||[]).length>0);
}
function schedule(fast){ clearTimeout(window._t); window._t=setTimeout(load, fast?5000:15000); }
load();
