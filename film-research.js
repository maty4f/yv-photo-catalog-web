/* Autonomous film research; catalog integration requires an explicit button click.
   The panel engine is shared with photos/documents (yv-research.js). */
(() => {
  async function sample(file, signal) {
    if (!file) return [];
    const video = document.createElement('video');
    video.preload = 'auto'; video.muted = true;
    const url = URL.createObjectURL(file);
    const wait = event => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', error); signal.removeEventListener('abort', aborted); };
      const ok = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(new Error('לא ניתן לקרוא פריימים מהסרט. אפשר להוסיף מידע מוקדם ולנסות שוב.')); };
      const aborted = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(error, 30000);
      video.addEventListener(event, ok, { once: true }); video.addEventListener('error', error, { once: true });
      signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted();
    });
    try {
      const ready = wait('loadeddata'); video.src = url; await ready;
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('משך הסרט אינו זמין לדפדפן. אפשר לחפש על סמך מידע מוקדם.');
      const times = [...new Set([0.1, 2, 7, 20, duration * 0.25, duration * 0.5, duration * 0.75, duration - 1]
        .map(t => Math.max(0.01, Math.min(duration * 0.99, t))))].sort((a, b) => a - b);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d'), frames = [];
      for (const t of times) {
        signal.throwIfAborted();
        const seek = wait('seeked'); video.currentTime = t; await seek;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({ t, b64: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] });
      }
      return frames;
    } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
  }
  // Catalog fields the research may propose values for (server: FIELDS.film in
  // research-fields.js). Order also sets the request's catalog packing priority.
  const FIELD_MAP = Object.fromEntries([
    ['title_he', 'r-title-he', 'כותר (עברית)', 'he'], ['title_en', 'r-title-en', 'כותר (אנגלית)', 'en'],
    ['original_title', 'r-original-title', 'כותר מקורי', 'auto'],
    ['summary_he', 'r-summary-he', 'תקציר (עברית)', 'he'], ['summary_en', 'r-summary-en', 'תקציר (אנגלית)', 'en'],
    ['director_he', 'r-director-he', 'במאי (עברית)', 'he'], ['director_en', 'r-director-en', 'במאי (אנגלית)', 'en'],
    ['producer_he', 'r-producer-he', 'מפיק (עברית)', 'he'], ['producer_en', 'r-producer-en', 'מפיק (אנגלית)', 'en'],
    ['production_company_he', 'r-production-company-he', 'חברת הפקה (עברית)', 'he'],
    ['production_company_en', 'r-production-company-en', 'חברת הפקה (אנגלית)', 'en'],
    ['cinematographer_he', 'r-cinematographer-he', 'צלם (עברית)', 'he'], ['cinematographer_en', 'r-cinematographer-en', 'צלם (אנגלית)', 'en'],
    ['production_country_he', 'r-production-country-he', 'ארץ הפקה (עברית)', 'he'],
    ['production_country_en', 'r-production-country-en', 'ארץ הפקה (אנגלית)', 'en'],
    ['production_year', 'r-production-year', 'שנת הפקה', 'he'], ['creation_date', 'r-creation-date', 'תאריך יצירה', 'he'],
    ['genre', 'r-genre', 'זאנר', 'he'], ['rights', 'r-rights', 'בעל זכויות', 'he'],
    ['places_he', 'r-places-he', 'מקומות (עברית)', 'he'], ['places_en', 'r-places-en', 'מקומות (אנגלית)', 'en'],
    ['events_he', 'r-events-he', 'אירועים (עברית)', 'he'], ['events_en', 'r-events-en', 'אירועים (אנגלית)', 'en'],
    ['persons_he', 'r-persons-he', 'אישים (עברית)', 'he'], ['persons_en', 'r-persons-en', 'אישים (אנגלית)', 'en'],
    ['orgs_he', 'r-orgs-he', 'ארגונים (עברית)', 'he'], ['orgs_en', 'r-orgs-en', 'ארגונים (אנגלית)', 'en'],
    ['dates_he', 'r-dates-he', 'תאריכים (עברית)', 'he'], ['dates_en', 'r-dates-en', 'תאריכים (אנגלית)', 'en'],
  ].map(([key, id, label, lang]) => [key, { id, label, lang }]));
  const panel = yvItemResearch.mount({
    prefix: 'film-research', fieldId: 'r-external-research', endpoint: '/api/film-research', kind: 'film', noun: 'הסרט',
    base: () => (state.localServerUrl || location.origin).replace(/\/$/, ''),
    subject: () => state.film,
    cataloged: () => !!state.film && state.researchCatalogFilm === state.film,
    fieldMap: FIELD_MAP,
    // The live (archivist-edited) fields of THIS film only — never a previous
    // film's. A field is sent whole or not at all (no truncated summary to rewrite).
    catalog: () => state.film && state.researchCatalogFilm === state.film
      ? yvItemResearch.formCatalog(Object.entries(FIELD_MAP).map(([key, f]) => [key, f.id]), 6000) : '',
    sampling: 'דוגם פריימים מתחילת הסרט, מאמצעו ומסופו…',
    sample,
    coverage: data => [`דגימה של ${data.frame_times?.length || 0} פריימים. אין כאן צפייה מלאה בסרט או חיפוש בכל ארכיון.`,
      data.knowledge_base?.summary_he].filter(Boolean).join(' '),
    limitsLine: 'החיפוש מבוסס על דגימת פריימים ומידע שסופק; אינו מכסה את כל הסרט או את כל הארכיונים.',
    samplesLine: data => `זמני הפריימים שנדגמו (שניות): ${(data.frame_times || []).join(', ') || 'לא נדגמו פריימים'}`,
  });
  window.yvFilmResearchRefresh = panel.refresh;
  window.yvFilmResearchChanged = panel.changed;
})();
