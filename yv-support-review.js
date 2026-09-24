/* Citation support pilot: review and export only; never writes catalog records. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const display = s => esc(s).replace(/\b\d+_\d+\b/g, key => `<bdi dir="ltr">${key}</bdi>`);
  const labels = {supports:'נתמך במטא־נתונים שסופקו', contradicts:'סתירה אפשרית', says_nothing:'אין מספיק מידע', absence:'טענת היעדר מידע — לבדיקה', not_checked:'לא נבדק'};
  const reasons = {source_resolution_failed:'לא ניתן לקשר את ההפניה למקור חד־משמעי', external_processing_not_approved:'המקור זמין לסקירה מקומית; לא נשלח לשירות חיצוני', transcription_requires_review:'התעתיק טרם אושר בידי מקטלג', missing_evidence:'חסרה ראיה מצוטטת', budget_limit:'הבדיקה הגיעה למגבלת ההיקף', service_unavailable:'שירות הבדיקה לא היה זמין', truncated_evidence:'הקטע שנבדק חלקי', low_confidence:'המודל אינו בטוח', absence_requires_review:'היעדר אזכור אינו מוכיח היעדר מידע', claim_requires_review:'נדרשת בדיקה מול המקור'};
  function sourceHtml(s) {
    const page = /^(tiks|photos|films|docs|items)\/[^/\\]{1,200}\.md$/.test(s.page || '') && !s.page.includes('..') ? s.page : '';
    const link = page ? `<a href="wiki.html?page=${encodeURIComponent(page)}" target="_blank" rel="noopener">פתח רשומת קטלוג</a>` : '';
    const sourceUrl = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(s.source_url || '') ? s.source_url : '';
    const original = sourceUrl ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">פתח סריקת מקור בדרייב</a>` : '';
    const sourceNote = s.kind === 'source_transcript' ? `תעתיק קטע מתוך המקור לסקירה · סריקה ${esc(s.scan_page ?? 'לא ידועה')} · מספר מודפס ${esc(s.printed_page ?? 'ללא מספר')}${s.source_lines ? ' · שורות ' + esc(s.source_lines) : ''}. ${s.transcription_status === 'human_verified' ? 'התעתיק סומן כמאושר בידי אדם.' : 'טיוטת תעתיק; נדרש אישור מקטלג.'}` : 'מקור ראשוני לא נבדק. ההפניה לעמוד מופיעה בטענה ואינה מאומתת כאן.';
    return `<details><summary><bdi dir="ltr">${esc(s.key)}</bdi> — ${esc(s.title || 'מטא־נתונים')}${s.truncated ? ' · קטע חלקי' : ''}${s.missing ? ' · חסר' : ''}</summary>
      ${link} ${original}<p>${sourceNote}</p>${s.resolution_error ? `<p>קישור המקור נכשל: ${esc(s.resolution_error)}</p>` : ''}
      <pre dir="auto" class="support-excerpt">${esc(s.excerpt || 'לא סופק טקסט')}</pre>
      <details><summary>פרטי מקור וגרסה</summary><div dir="ltr" class="support-hash">Record: ${esc(s.record_sha256 || 'unavailable')}<br>Scan: ${esc(s.source_sha256 || 'unavailable')}<br>Evidence: ${esc(s.evidence_sha256)}<br>Excerpt: ${esc(s.excerpt_sha256)}<br>Characters: ${esc(s.char_start)}–${esc(s.char_end)} / ${esc(s.total_chars)}</div></details></details>`;
  }
  function render(report, {editable = true} = {}) {
    if (!report) return '<p class="support-status">בדיקת תמיכה בטענות לא בוצעה.</p>';
    if (!Array.isArray(report.lines)) return '<p class="support-status">בדיקת התמיכה לא זמינה לתוצאה זו; אין לראות בה אישור לטענות.</p>';
    return `<section class="support-review" aria-label="סקירת תמיכה בטענות"><h3>בדיקת תמיכה בטענות · הצעות לסקירה</h3>
      <p>נבדקו ${esc(report.checked)} מתוך ${esc(report.total ?? report.lines.length)} טענות בעברית מול ${report.scope === 'source_transcript' ? 'תעתיקי מקור' : 'מטא־נתונים'}. בדיקת המודל אינה מאמתת את הסריקה או את הנוסח באנגלית.</p>
      ${report.status === 'partial' ? '<p class="support-status">הבדיקה חלקית — חלק מהטענות לא נבדקו.</p>' : ''}
      ${report.lines.map((r, i) => `<article class="support-claim"><strong>${esc(r.relation === 'supports' && report.scope === 'source_transcript' ? 'נתמך בתעתיק שסופק' : labels[r.relation] || 'לא נבדק')}</strong>
        <p>${display(r.line)}</p>${r.reason ? `<p class="support-status">${esc(reasons[r.reason] || 'נדרשת סקירה')}</p>` : ''}
        <details><summary>${r.request_attempted === false ? 'הראיות הזמינות לסקירה' : 'הראיות שנמסרו לבודק'}</summary>${(r.sources || []).map(sourceHtml).join('') || '<p>אין פירוט ראיות בתוצאה זו.</p>'}</details>
        <details><summary>פרטי הבדיקה</summary><p>ביטחון המודל: ${Number.isFinite(r.confidence) ? esc(r.confidence.toFixed(3)) : 'לא זמין'} — אינו אחוז ודאות היסטורית. מודל: ${esc(r.model || 'לא זמין')}</p></details>
        ${editable ? `<label>תיוג אנושי עצמאי <select data-support-label="${i}" aria-label="תיוג אנושי לטענה ${i + 1}"><option value="">טרם תויג</option><option value="supports">הקטע תומך בכל הטענה</option><option value="contradicts">הקטע סותר את הטענה</option><option value="says_nothing">אין בקטע מספיק מידע</option><option value="unresolved">לא ניתן להכריע</option></select></label><label>החלטת הסוקר <select data-support-index="${i}" aria-label="החלטת הסוקר לטענה ${i + 1}"><option value="open">להשאיר פתוח</option><option value="agree">מאשר את הערכת הבודק</option><option value="disagree">דוחה את הערכת הבודק</option></select></label><label>הערת הסוקר <input data-support-note="${i}" maxlength="2000" aria-label="הערה לטענה ${i + 1}"></label>` : ''}</article>`).join('')}
      ${editable ? '<label>שם הסוקר <input class="support-reviewer" aria-label="שם הסוקר" maxlength="120"></label><p>ההחלטות נשמרות בסקירה הנוכחית בלבד. הורידו אותן לפני מעבר לדף אחר; הרשומות אינן משתנות.</p><button type="button" class="act support-export">הורד סקירה עם ראיות</button>' : ''}</section>`;
  }
  function reviewData(element, report) {
    return {schema_version:1, kind:'support_human_review', exported_at:new Date().toISOString(), reviewer:element.querySelector('.support-reviewer')?.value || '', report,
      decisions: report.lines.map((r, i) => ({claim_id:r.claim_id, human_label:element.querySelector(`[data-support-label="${i}"]`)?.value || null, decision:element.querySelector(`[data-support-index="${i}"]`)?.value || 'open', note:element.querySelector(`[data-support-note="${i}"]`)?.value || ''}))};
  }
  function bind(element, report) {
    const button = element.querySelector('.support-export');
    if (!button || !report?.lines) return;
    button.onclick = () => {
      const blob = new Blob([JSON.stringify(reviewData(element, report), null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'catalog-support-review-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  root.yvSupportReview = {render, bind, reviewData};
})(globalThis);
