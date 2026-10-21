/* Document research: the scan (PDF as-is, or a page image), the provided context
   and the current catalog form → grounded search. Panel engine: item-research.js. */
(() => {
  const R = yvItemResearch;
  const PDF_MAX = 10 * 1024 * 1024;   // larger PDFs: search on the catalog fields and context only
  async function sample(file, signal) {
    if (!file) return [];
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
      if (file.size > PDF_MAX) throw new Error('קובץ ה-PDF גדול מ-10MB ואינו נשלח לחיפוש. אפשר לחפש על סמך שדות הקטלוג והמידע המוקדם.');
      return [{ label: 'document scan (PDF)', mime: 'application/pdf', b64: await R.fileToB64(file) }];
    }
    try { return [{ label: 'document scan (page image)', mime: 'image/jpeg', b64: await R.imageToJpeg(file, 2000, 0.85, signal) }]; }
    catch (e) { if (e.name === 'AbortError') throw e; throw new Error('לא ניתן לקרוא את הסריקה בדפדפן (למשל TIFF). אפשר לחפש על סמך שדות הקטלוג והמידע המוקדם.'); }
  }
  // Only the form of the document now loaded (set by fillResults) — never a previous one's.
  const catalog = () => state.researchCatalogFor === state.document ? R.formCatalog([
    ['title_he', 'r-title-he'], ['title_en', 'r-title-en'], ['doc_type', 'r-doc-type'],
    ['doc_date', 'r-doc-date'], ['languages', 'r-languages'],
    ['sender_he', 'r-sender-he'], ['sender_en', 'r-sender-en'],
    ['recipient_he', 'r-recipient-he'], ['recipient_en', 'r-recipient-en'],
    ['place_he', 'r-place-he'], ['place_en', 'r-place-en'], ['creator_org', 'r-creator-org'],
    ['persons_en', 'r-persons-en'], ['summary_he', 'r-summary-he'], ['original_text_excerpt', 'r-original-text'],
  ]) : '';
  const sent = data => (data.frame_labels || []).length ? (data.frame_labels[0].includes('PDF') ? 'קובץ ה-PDF' : 'תמונת העמוד') : '';
  const panel = R.mount({
    prefix: 'doc-research', fieldId: 'r-external-research', kind: 'doc', noun: 'המסמך',
    base: () => (state.localServerUrl || location.origin).replace(/\/$/, ''),
    subject: () => state.document,
    cataloged: () => !!state.document && state.researchCatalogFor === state.document,
    hasEvidence: () => !!state.document || !!catalog(),
    catalog,
    sampling: 'מכין את סריקת המסמך לחילוץ רמזים…',
    sample,
    postTimeout: 120000,   // a whole PDF may take a while to upload
    coverage: data => [`נבדקו: ${sent(data) || 'ללא סריקה — מידע מוקדם ושדות הקטלוג בלבד'}. אין כאן חיפוש בכל ארכיון או בכל מאגר שמות.`,
      data.knowledge_base?.summary_he].filter(Boolean).join(' '),
    limitsLine: 'החיפוש מבוסס על רמזים שחולצו מהמסמך ומהמידע שסופק; שם זהה במאגר אינו מוכיח שמדובר באותו אדם, והחיפוש אינו מכסה את כל הארכיונים.',
    samplesLine: data => `סריקה שנשלחה: ${sent(data) || 'לא נשלחה סריקה'}`,
  });
  window.yvDocResearchRefresh = panel.refresh;
  window.yvDocResearchChanged = panel.changed;
})();
