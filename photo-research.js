/* Photo research: the front (and reverse, when loaded), the provided context and
   the current catalog form → grounded search. Panel engine: item-research.js. */
(() => {
  const R = yvItemResearch;
  const SIDES = [['front', 'front of the photograph', 'חזית'], ['back', 'reverse of the photograph', 'גב']];
  const heLabel = label => (SIDES.find(s => s[1] === label) || [])[2] || label;
  async function sample(front, signal) {
    const frames = [];
    for (const [side, label] of SIDES) {
      const file = state.photos[side];
      if (!file) continue;
      try { frames.push({ label, mime: 'image/jpeg', b64: await R.imageToJpeg(file, 1600, 0.82, signal) }); }
      catch (e) { if (e.name === 'AbortError') throw e; }   // e.g. TIFF/HEIC the browser cannot decode
    }
    if (front && !frames.length) throw new Error('לא ניתן לקרוא את התצלום בדפדפן (למשל TIFF או HEIC). אפשר להוסיף מידע מוקדם ולנסות שוב.');
    return frames;
  }
  // Only the form of the photo now loaded (set by fillResultsForm) — never a previous photo's.
  const catalog = () => state.researchCatalogFor === state.photos.front ? R.formCatalog([
    ['title_he', 'r-title-he'], ['title_en', 'r-title-en'], ['places_en', 'r-places'],
    ['creation_date', 'r-creation-date'], ['photographer', 'r-photographer'],
    ['inscriptions_he', 'r-inscriptions-he'], ['inscriptions_en', 'r-inscriptions-en'],
    ['studio_he', 'r-studio-he'], ['historical_context_he', 'r-context-he'],
  ]) : '';
  const sent = data => (data.frame_labels || []).map(heLabel).join(', ');
  const panel = R.mount({
    prefix: 'photo-research', fieldId: 'r-external-research', kind: 'photo', noun: 'התצלום',
    base: () => (state.localServerUrl || location.origin).replace(/\/$/, ''),
    subject: () => state.photos.front,
    cataloged: () => !!state.photos.front && state.researchCatalogFor === state.photos.front,
    hasEvidence: () => !!state.photos.front || !!catalog(),
    catalog,
    sampling: 'מכין את החזית והגב לחילוץ רמזים…',
    sample,
    coverage: data => `נבדקו: ${sent(data) || 'ללא סריקה — מידע מוקדם ושדות הקטלוג בלבד'}. אין כאן חיפוש לפי דמיון חזותי או חיפוש בכל ארכיון.`,
    limitsLine: 'החיפוש מבוסס על רמזים שחולצו מהתצלום ומהמידע שסופק; אין בו חיפוש לפי דמיון חזותי, ואינו מכסה את כל הארכיונים.',
    samplesLine: data => `סריקות שנשלחו: ${sent(data) || 'לא נשלחה סריקה'}`,
  });
  window.yvPhotoResearchRefresh = panel.refresh;
  window.yvPhotoResearchChanged = panel.changed;
})();
