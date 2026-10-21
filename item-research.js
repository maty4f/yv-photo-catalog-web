/* Grounded external research for the current catalog item (film, photo or
   document). One shared panel engine; each screen mounts it with an adapter
   that supplies its evidence. Catalog integration requires an explicit click. */
window.yvItemResearch = (() => {
  function mount(cfg) {
    const byId = id => document.getElementById(id);
    const p = cfg.prefix;
    const start = byId(p + '-start'), stop = byId(p + '-stop');
    const status = byId(p + '-status'), results = byId(p + '-results');
    const exportBtn = byId(p + '-export');
    const applyBtn = byId(p + '-apply'), undoBtn = byId(p + '-undo');
    const catalogField = byId(cfg.fieldId);
    const contextEl = () => byId('context-input');
    let reportSubject = null, lastAddition = null;
    // Optional research → catalog-fields proposals (research-fields.js); an
    // adapter without a fieldMap keeps the report-only integration.
    const fieldsUI = cfg.fieldMap && window.yvResearchFields;
    let selectedUpdates = () => [];
    const imported = new Set();
    let active = null, report = null;
    const endpoint = cfg.endpoint || '/api/research';
    const hasEvidence = cfg.hasEvidence || (() => !!cfg.subject());
    // Research runs only on an item that has already been cataloged (decision
    // 21.10.2026): the adapter says whether the form holds THIS item's results.
    const cataloged = cfg.cataloged || (() => true);
    const waitHint = `החיפוש יתאפשר לאחר קטלוג ${cfg.noun}.`;
    const refresh = () => {
      const ready = cataloged();
      start.disabled = !!active || !ready || (!hasEvidence() && !contextEl()?.value.trim());
      if (!active && !ready && !status.textContent) status.textContent = waitHint;
      else if (ready && status.textContent === waitHint) status.textContent = '';
    };
    contextEl()?.addEventListener('input', refresh);

    async function json(url, options = {}) {
      const response = await fetch(url, { credentials: 'same-origin', ...options });
      let data;
      try { data = await response.json(); } catch { throw new Error('לא התקבלה תשובה מהשרת. ייתכן שצריך לרענן את ההתחברות.'); }
      if (!response.ok) throw new Error(data.error || `שגיאת שרת (${response.status})`);
      return data;
    }
    const cancelRemote = task => task.jobId && fetch(`${task.base}${endpoint}/${encodeURIComponent(task.jobId)}`, {
      method: 'DELETE', credentials: 'same-origin', keepalive: true, signal: AbortSignal.timeout(10000),
    }).catch(() => {});
    function cancel(clear = false) {
      const task = active;
      active = null;
      if (task) { task.controller.abort(); cancelRemote(task); }
      stop.hidden = true;
      status.textContent = clear ? '' : 'החיפוש הופסק.';
      if (clear) {
        report = null; reportSubject = null; lastAddition = null; imported.clear(); selectedUpdates = () => [];
        results.replaceChildren(); exportBtn.hidden = true; applyBtn.hidden = true; undoBtn.hidden = true;
        catalogField.value = '';
      }
      refresh();
    }
    stop.addEventListener('click', () => cancel());

    const reportId = data => JSON.stringify([data.input_sha256, data.searched_at, data.text]);
    function catalogText(data, changes = []) {
      const citations = new Map();
      for (const evidence of data.evidence || []) {
        const at = data.text.indexOf(evidence.text);
        if (at < 0 || !evidence.text) continue;
        const end = at + evidence.text.length;
        const ids = evidence.source_ids.filter(id => data.sources.some(s => s.id === id));
        citations.set(end, [...new Set([...(citations.get(end) || []), ...ids])]);
      }
      let text = data.text;
      for (const [end, ids] of [...citations].sort((a, b) => b[0] - a[0])) {
        text = text.slice(0, end) + ids.map(id => ` [${id}]`).join('') + text.slice(end);
      }
      return [
        'מידע משלים מחיפוש חיצוני — ממצאים לבדיקה',
        `מועד החיפוש: ${data.searched_at || 'לא צוין'}`,
        data.warning || `המידע אינו מהווה אימות של זהות ${cfg.noun}.`, '', text,
        ...(fieldsUI ? fieldsUI.describe(changes, cfg.fieldMap) : []),
        '', 'מקורות:', ...data.sources.map(s => `[${s.id}] ${s.title}${s.kb ? ' — ' + s.kb.label_he : ''}\n${s.url}`),
        '', 'מגבלות החיפוש:', cfg.limitsLine,
        ...(data.limitations || []),
        cfg.samplesLine(data),
        `מזהה קלט: ${data.input_sha256 || 'לא צוין'}`,
      ].join('\n');
    }
    applyBtn.addEventListener('click', () => {
      if (active || report?.status !== 'findings' || !report.text || !report.sources?.length || reportSubject !== cfg.subject()) return;
      const id = reportId(report);
      if (imported.has(id)) return;
      const changes = fieldsUI ? fieldsUI.apply(selectedUpdates(), cfg.fieldMap) : [];
      const addition = (catalogField.value ? '\n\n' : '') + catalogText(report, changes);
      catalogField.value += addition;
      lastAddition = { id, addition, changes }; imported.add(id);
      results.querySelectorAll('input[type=checkbox]').forEach(box => { box.disabled = true; });
      catalogField.dispatchEvent(new Event('input', { bubbles: true }));
      byId('results').classList.add('show'); byId('no-results').style.display = 'none';
      byId('download-bar').style.display = 'flex';
      applyBtn.disabled = true; applyBtn.textContent = '✓ המידע שולב בקטלוג'; undoBtn.hidden = false;
      status.textContent = changes.length
        ? `עודכנו בקטלוג: ${changes.map(c => cfg.fieldMap[c.field].label).join(', ')}. הדוח והמקורות נוספו לשדה „מידע משלים ממקורות חיצוניים”.`
        : fieldsUI && report.catalog_updates?.length
          ? 'לא סומנו ממצאים, ולכן שדות הקטלוג לא שונו. הדוח והמקורות נוספו לשדה „מידע משלים ממקורות חיצוניים”.'
          : 'המידע והמקורות נוספו לשדה „מידע משלים ממקורות חיצוניים” ונכללים בדוח הקטלוג. השדות הקיימים נשמרו.';
      const shown = changes.length ? byId(changes[0].id) : catalogField;
      shown.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); shown.focus({ preventScroll: true });
    });
    undoBtn.addEventListener('click', () => {
      if (!lastAddition) return;
      const changes = lastAddition.changes || [];
      const at = catalogField.value.indexOf(lastAddition.addition);
      if (at < 0 && !changes.length) { status.textContent = 'המידע המשולב נערך מאז ההוספה. כדי לשמור על העריכות, יש להסיר את הקטע הרצוי ידנית בשדה המידע המשלים.'; return; }
      // Catalog fields come back unless edited since; an edited research block stays.
      const kept = changes.length ? fieldsUI.undo(changes, cfg.fieldMap) : [];
      if (at >= 0) {
        catalogField.value = catalogField.value.slice(0, at) + catalogField.value.slice(at + lastAddition.addition.length);
        imported.delete(lastAddition.id);
        catalogField.dispatchEvent(new Event('input', { bubbles: true }));
      } else kept.push('מידע משלים ממקורות חיצוניים');
      lastAddition = null; undoBtn.hidden = true;
      applyBtn.disabled = report ? imported.has(reportId(report)) : true;
      applyBtn.textContent = applyBtn.disabled ? '✓ המידע שולב בקטלוג' : 'שלב את המידע בקטלוג';
      if (!applyBtn.disabled) results.querySelectorAll('input[type=checkbox]').forEach(box => { box.disabled = false; });
      status.textContent = kept.length
        ? `השילוב האחרון בוטל. שדות שנערכו מאז השילוב נשארו כפי שהם: ${kept.join(', ')}.`
        : 'השילוב האחרון בוטל והערכים הקודמים הוחזרו. שאר המידע והעריכות נשמרו.';
    });

    function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
    function link(source) {
      const el = node('a', `[${source.id}] ${source.title}`);
      // Server validates HTTPS; repeat before rendering/importing any URL.
      try { if (new URL(source.url).protocol !== 'https:') return el; } catch { return el; }
      el.href = source.url; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.style.color = 'var(--accent)'; return el;
    }
    function render(data) {
      results.replaceChildren();
      results.append(node('p', data.warning));
      selectedUpdates = fieldsUI && data.status === 'findings' ? fieldsUI.render(results, data, cfg.fieldMap, link) : () => [];
      if (data.text) {
        results.append(node('h3', 'דוח המחקר — הצעות לבדיקה'));
        const text = document.createElement('div'); text.style.lineHeight = '1.8';
        const citations = new Map();
        for (const evidence of data.evidence || []) {
          const pos = data.text.indexOf(evidence.text);
          if (pos < 0) continue;
          const end = pos + evidence.text.length;
          citations.set(end, [...new Set([...(citations.get(end) || []), ...evidence.source_ids])]);
        }
        const inline = (parent, raw) => {
          // Small, text-only Markdown subset. Raw HTML and model URLs never execute.
          // \x60 = backtick (keeps the i18n string scanner in sync)
          for (const piece of raw.split(/(\*\*[^*]+\*\*|\x60[^\x60]+\x60|\*[^*]+\*)/g)) {
            if (piece.startsWith('**') && piece.endsWith('**')) parent.append(node('strong', piece.slice(2, -2)));
            else if (piece.startsWith('\x60') && piece.endsWith('\x60')) parent.append(node('code', piece.slice(1, -1)));
            else if (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) parent.append(node('em', piece.slice(1, -1)));
            else parent.append(document.createTextNode(piece));
          }
        };
        let offset = 0;
        for (const line of data.text.split('\n')) {
          const heading = line.match(/^#{1,6}\s+/), bullet = line.match(/^\s*[*-]\s+/);
          const el = document.createElement(heading ? 'h4' : /^-{3,}$/.test(line.trim()) ? 'hr' : 'p');
          el.style.margin = heading ? '16px 0 6px' : '6px 0';
          let cursor = offset + (heading?.[0].length || bullet?.[0].length || 0);
          if (bullet) el.append(document.createTextNode('• '));
          if (el.tagName !== 'HR') {
            for (const [end, ids] of [...citations].sort((a, b) => a[0] - b[0])) {
              if (end <= cursor || end > offset + line.length) continue;
              inline(el, data.text.slice(cursor, end));
              for (const id of ids) {
                const source = data.sources.find(s => s.id === id);
                if (source) { const ref = link(source); ref.textContent = ` [${id}]`; el.append(ref); }
              }
              cursor = end;
            }
            inline(el, data.text.slice(cursor, offset + line.length));
          }
          text.append(el); offset += line.length + 1;
        }
        results.append(text);
      }
      if (data.evidence?.length) {
        const supports = document.createElement('details');
        supports.append(node('summary', 'קטעי הדוח והפניות המקור שהחזיר מנוע החיפוש'));
        for (const evidence of data.evidence) {
          const card = node('blockquote', evidence.text); card.style.borderInlineStart = '3px solid var(--accent)'; card.style.padding = '8px 14px';
          const refs = document.createElement('div');
          evidence.source_ids.forEach(id => { const source = data.sources.find(s => s.id === id); if (source) { refs.append(link(source), document.createTextNode(' · ')); } });
          card.append(refs); supports.append(card);
        }
        results.append(supports);
      }
      const details = document.createElement('details'); details.append(node('summary', 'רמזים, שאילתות ומגבלות החיפוש'));
      details.append(node('p', `מועד: ${new Date(data.searched_at).toLocaleString('he-IL')} · ${cfg.coverage(data)}`));
      for (const clue of data.clues || []) details.append(node('p', `${clue.text} — ${clue.basis}${clue.timecode_seconds == null ? '' : ` (${clue.timecode_seconds.toFixed(1)} שניות)`}`));
      for (const limit of data.limitations || []) details.append(node('p', limit));
      details.append(node('h4', 'שאילתות שהוחזרו מכלי החיפוש'));
      const queries = document.createElement('ul');
      for (const query of data.queries || []) queries.append(node('li', query));
      details.append(queries);
      details.append(node('h4', 'מקורות שהוחזרו'));
      for (const source of data.sources || []) {
        const p = document.createElement('p'); p.append(link(source));
        if (source.kb) p.append(document.createTextNode(' — ' + source.kb.label_he));   // vetted-source tier (server)
        details.append(p);
      }
      results.append(details);
      if (data.search_suggestions) {
        // Google's required Search Suggestions are isolated from this page and
        // cannot execute scripts, submit forms, or read the catalog/session.
        const frame = document.createElement('iframe'); frame.title = 'הצעות חיפוש Google';
        frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        frame.referrerPolicy = 'no-referrer'; frame.style.cssText = 'width:100%;height:160px;border:0;margin-top:16px';
        frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><base target="_blank">' + data.search_suggestions;
        results.append(frame);
      }
    }
    start.addEventListener('click', async () => {
      if (active || !cataloged()) return;
      const task = { controller: new AbortController(), base: cfg.base(), jobId: null };
      active = task; report = null; results.replaceChildren(); exportBtn.hidden = true; stop.hidden = false; refresh();
      applyBtn.hidden = true;
      const subject = cfg.subject();
      const context = contextEl().value.trim();
      // Never attach a previous item's identification when a new file is loaded.
      const catalog = (cfg.catalog() || '').slice(0, 6000);
      try {
        status.textContent = cfg.sampling;
        let frames;
        try { frames = await cfg.sample(subject, task.controller.signal); }
        catch (e) { if (task.controller.signal.aborted || (!context && !catalog)) throw e; frames = []; }
        if (active !== task) return;
        status.textContent = 'מחלץ כותרות, כיתובים ורמזי זיהוי…';
        // Do not abort submission: if cancelled during POST, receive the job ID
        // and cancel that exact server job so no orphan search continues.
        const created = await json(`${task.base}${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(cfg.postTimeout || 30000),
          body: JSON.stringify({ ...(cfg.kind && cfg.kind !== 'film' ? { kind: cfg.kind } : {}),
            name: subject?.name || 'חיפוש לפי מידע מוקדם', context, catalog, frames }),
        });
        task.jobId = created.jobId;
        if (active !== task) { cancelRemote(task); return; }
        const deadline = Date.now() + 450000;   // server task limit 420 s (clues, search, fields)
        while (active === task && Date.now() < deadline) {
          const job = await json(`${task.base}${endpoint}/${encodeURIComponent(task.jobId)}`, {
            signal: AbortSignal.any([task.controller.signal, AbortSignal.timeout(15000)]),
          });
          if (active !== task) return;
          if (job.status === 'done') {
            report = job.result; render(report); exportBtn.hidden = false;
            reportSubject = subject;
            applyBtn.hidden = report.status !== 'findings' || !report.text || !report.sources?.length;
            applyBtn.disabled = imported.has(reportId(report));
            applyBtn.textContent = applyBtn.disabled ? '✓ המידע שולב בקטלוג' : 'שלב את המידע בקטלוג';
            status.textContent = report.status !== 'findings' ? 'החיפוש הסתיים ללא זיהוי מבוסס. פירוט המגבלות מופיע להלן.'
              : report.catalog_updates?.length && fieldsUI ? 'החיפוש הסתיים — הממצאים, המקורות והעדכונים המוצעים לשדות הקטלוג מוכנים לבדיקה.'
              : 'החיפוש הסתיים — הממצאים והמקורות מוכנים לבדיקה.';
            return;
          }
          if (job.status === 'error') throw new Error(job.error);
          if (job.status === 'cancelled') throw new Error('החיפוש הופסק.');
          status.textContent = job.stage === 'fields' ? 'ממפה את הממצאים לשדות הקטלוג…'
            : job.stage === 'search' ? 'מחפש מידע ועותקים במקורות ארכיוניים ומשווה לרמזים…' : 'מחלץ כותרות, כיתובים ורמזי זיהוי…';
          await new Promise(resolve => {
            const done = () => { clearTimeout(timer); task.controller.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, 1500); task.controller.signal.addEventListener('abort', done, { once: true });
          });
        }
        if (active === task) throw new Error('החיפוש עבר את מגבלת הזמן. אפשר לנסות שוב.');
      } catch (e) {
        if (active === task) { status.textContent = e.name === 'AbortError' ? 'החיפוש הופסק.' : (e.message || 'החיפוש נכשל. אפשר לנסות שוב.'); cancelRemote(task); }
      } finally { if (active === task) { active = null; stop.hidden = true; refresh(); } }
    });
    exportBtn.addEventListener('click', () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${cfg.kind || 'film'}-research.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    refresh();
    return { refresh, changed: () => cancel(true) };
  }

  // Decode an image File in the browser and re-encode it as a bounded JPEG
  // (TIFF/HEIC the browser cannot decode → rejects; the caller skips that scan).
  async function imageToJpeg(file, maxSide, quality, signal) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('decode timeout')), 30000);
        const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        img.onload = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); resolve(); };
        img.onerror = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new Error('decode failed')); };
        signal?.addEventListener('abort', aborted, { once: true });
        img.src = url;
      });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality).split(',')[1];
    } finally { URL.revokeObjectURL(url); }
  }
  // Base64 of a whole file (document PDFs go to the model as-is).
  async function fileToB64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  // Selected catalog form fields as a compact JSON clue block ('' when empty).
  // Fields are taken in order until the server's 6,000-character budget is used.
  function formCatalog(fields, perField = 1500) {
    const out = {};
    for (const [key, id] of fields) {
      const v = (document.getElementById(id)?.value || '').trim();
      if (!v) continue;
      out[key] = v.slice(0, perField);
      if (JSON.stringify(out).length > 6000) { delete out[key]; break; }
    }
    return Object.keys(out).length ? JSON.stringify(out) : '';
  }
  return { mount, imageToJpeg, fileToB64, formCatalog };
})();
