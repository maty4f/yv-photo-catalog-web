/* Research cards and a read-only source pane. No source text is sent to a model. */
(function (global) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kinds = {tik:'תיק', photo:'תצלום', film:'סרט', doc:'מסמך', item:'פריט'};
  const errors = {
    source_not_registered:'לרשומה זו עדיין לא קושר עמוד מקור. מוצג מידע קטלוגי בלבד.',
    record_version_mismatch:'הרשומה השתנתה מאז קישור המקור. נדרש לעדכן את הקישור לפני הצגת התמלול.',
    page_locator_required:'בחרו עמוד מתוך המיפוי הקיים. הפניה לתיק או לטווח עמודים אינה בוחרת עמוד אוטומטית.',
    page_missing_or_ambiguous:'העמוד המבוקש חסר או שהמיפוי אינו חד־משמעי. אפשר לבחור עמוד ממופה אחר.',
    source_version_mismatch:'קובץ המקור השתנה. התמלול אינו מוצג עד לבדיקת המיפוי.',
    transcription_version_mismatch:'התמלול השתנה מאז בדיקתו. נדרשת בדיקה מחדש.',
    invalid_citation:'לא ניתן לפתוח את ההפניה כעמוד יחיד.',
  };
  function create({page, panel, api, openPage}) {
    let serial = 0, returnFocus = null, current = [];
    function close() { serial++; panel.hidden = true; document.body.classList.remove('source-open'); }
    function citationLinks(text) {
      return esc(text).replace(/\[(?:תיק\s+)?([A-Za-z0-9_.\-]+)[^\]]*\]/g, (citation, key) =>
        current.some(c => c.key === key) ? `<button class="research-cite" data-source="${esc(key)}" data-citation="${citation}">${citation}</button>` : citation);
    }
    function bind(root) {
      root.querySelectorAll('[data-source]').forEach(b => b.onclick = () => show(b.dataset.source, b.dataset.citation || '', b));
      root.querySelectorAll('[data-record-page]').forEach(b => b.onclick = () => { close(); openPage(b.dataset.recordPage); });
    }
    async function show(key, citation = '', trigger) {
      const token = ++serial;
      if (trigger && !panel.contains(trigger)) returnFocus = trigger;
      panel.hidden = false; document.body.classList.add('source-open');
      panel.innerHTML = '<button class="act" data-close>סגירת המקור</button><p role="status">טוען את המקור…</p>';
      wireClose();
      panel.focus();
      try {
        const r = await fetch(api('/api/wiki/source?key=' + encodeURIComponent(key) + '&citation=' + encodeURIComponent(citation)));
        const c = await r.json();
        if (!r.ok) throw new Error(c.error || r.status);
        if (token !== serial) return;
        const resolved = c.evidence_kind === 'source_transcript' && !c.resolution_error;
        const pages = (c.available_pages || []).filter(p => Number.isInteger(p.scan_page) && p.scan_page > 0);
        const title = c.title || key;
        panel.innerHTML = `<div class="research-pane-top"><span>מקור ותמלול</span><button class="act" data-close>סגירת המקור</button></div>
          <h2>${esc(title)}</h2><p class="research-meta">${esc(c.archive_id || key)} · ${esc(c.period || 'תאריך לא צוין')}</p>
          ${pages.length ? `<label class="research-page-picker">עמוד ממופה <select aria-label="עמוד ממופה"><option value="">בחירת עמוד</option>${pages.map(p => `<option value="${p.scan_page}"${resolved && p.scan_page === c.scan_page ? ' selected' : ''}>סריקה ${p.scan_page}${p.printed_page ? ' · עמוד מודפס ' + esc(p.printed_page) : ''}</option>`).join('')}</select></label>` : ''}
          ${resolved ? `<p class="research-badge">תמלול מקושר למקור · סריקה ${esc(c.scan_page)}${c.printed_page ? ' · עמוד מודפס ' + esc(c.printed_page) : ''}</p>
            <p>${c.transcription_status === 'human_verified' ? 'סטטוס התמלול במיפוי: נבדק בידי אדם.' : 'טיוטת תמלול אוטומטית — טרם נבדקה בידי אדם.'} התאמת הקובץ נבדקה; אין בכך אימות של תוכן העדות.</p>
            <p class="research-meta">${c.text_extent === 'full_page' ? 'תמלול העמוד' : 'קטע נבחר; ייתכן שאינו כולל את כל העמוד'}${c.source_lines ? ' · שורות ' + esc(c.source_lines) : ''}</p>
            <div class="research-original">${/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(c.preview_data || '') ? `<a href="${c.preview_data}" download="scan-${esc(c.scan_page)}.${c.preview_data.startsWith('data:image/png') ? 'png' : 'jpg'}" title="שמירת תמונת העמוד"><img src="${c.preview_data}" alt="עמוד מקור: ${esc(title)} — סריקה ${esc(c.scan_page)}"></a>` : '<p class="research-notice">אין תצוגת תמונה זמינה לעמוד זה.</p>'}
            <div><h3>תמלול</h3><pre class="research-transcript">${esc(c.excerpt)}</pre></div></div>
            ${/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(c.source_url || '') ? `<a class="act" href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">פתיחת קובץ המקור</a>` : ''}
            <details><summary>פרטי התאמת המקור</summary><p class="research-meta" dir="ltr">SHA-256: ${esc(c.source_sha256)}</p></details>` :
            `<p class="research-notice" role="status">${esc(errors[c.resolution_error] || 'לא ניתן לאמת את מיפוי המקור כרגע. מוצג מידע קטלוגי בלבד.')}</p><h3>מידע מהרשומה הקטלוגית</h3><p class="research-transcript">${esc(c.excerpt || 'אין תיאור ברשומה.')}</p>`}
          <div class="research-actions"><button class="act" data-record-page="${esc(c.page)}">דף הידע של הרשומה</button></div>`;
        wireClose(); bind(panel);
        const select = panel.querySelector('select');
        if (select) select.onchange = () => { if (select.value) show(key, `[${key} · סריקה ${select.value}]`); };
      } catch (e) {
        if (token !== serial) return;
        panel.innerHTML = `<button class="act" data-close>סגירת המקור</button><p role="alert">לא ניתן לפתוח את המקור: ${esc(e.message)}</p>`;
        wireClose();
      }
    }
    function wireClose() { panel.querySelector('[data-close]').onclick = () => { close(); if (returnFocus?.isConnected) returnFocus.focus(); }; }
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); if (returnFocus?.isConnected) returnFocus.focus(); } });
    function render(data, question, collection) {
      current = data.sources || [];
      const metadata = data.mode === 'metadata_search';
      page.innerHTML = `<h2>${esc(question)}</h2><p class="research-meta">${collection ? 'אוסף: ' + esc(collection) : 'כל הרשומות הזמינות במופע זה'}${Number.isInteger(data.scanned) ? ' · נבדקו ' + data.scanned + ' רשומות' : ''}</p>
        <section class="research-answer" aria-label="תשובת המחקר"><p class="research-badge">${metadata ? 'חיפוש מילולי במטא־נתונים' : 'תשובה אוטומטית מתוך הרשומות'}</p><div class="research-transcript">${citationLinks(data.answer_he || data.cannot || 'לא התקבלה תשובה. אפשר לבדוק את הרשומות להלן.')}</div>
        ${!metadata ? '<p class="research-meta">ההפניות מצביעות על רשומות. יש לבדוק במקור אם הן תומכות בטענה; היעדר תוצאה אינו מוכיח שהמידע חסר בארכיון.</p>' : ''}</section>
        <div class="research-card-heading"><h3>רשומות ומקורות (${current.length}${data.truncated ? ' מתוך ' + data.total : ''})</h3><label>סוג חומר <select id="research-kind"><option value="">הכול</option>${[...new Set(current.map(c => c.kind))].map(k => `<option value="${esc(k)}">${esc(kinds[k] || k)}</option>`).join('')}</select></label></div>
        <div class="research-cards">${current.map(c => `<article class="research-card" data-kind="${esc(c.kind)}"><div class="research-meta">${esc(kinds[c.kind] || c.kind)} · ${esc(c.archive_id || c.key)}${c.cited ? ' · הופנה בתשובה' : ''}</div><h3>${esc(c.title)}</h3>
          <p class="research-meta">${esc([c.period, c.language, ...(c.collections || [])].filter(Boolean).join(' · '))}</p>
          <p class="research-excerpt">${esc(c.excerpt || 'אין תיאור ברשומה.')}</p><span class="research-badge">תיאור קטלוגי</span>
          <div class="research-actions"><button class="act primary" data-source="${esc(c.key)}" data-citation="${esc((c.references || [])[0] || '')}">בדיקת מקור ותמלול</button><button class="act" data-record-page="${esc(c.page)}">דף ידע</button></div></article>`).join('') || '<p class="empty">לא נמצאו רשומות להצגה בתחום שנבדק.</p>'}</div>
        ${data.plan?.length ? `<details class="research-query"><summary>פרטי החיפוש שהורץ</summary><pre dir="ltr">${esc(JSON.stringify(data.plan, null, 2))}</pre></details>` : ''}`;
      page.querySelector('#research-kind').onchange = e => page.querySelectorAll('.research-card').forEach(c => { c.hidden = !!e.target.value && c.dataset.kind !== e.target.value; });
      bind(page);
    }
    return {render, close, show};
  }
  global.yvResearch = {create};
})(window);
