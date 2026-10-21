/* Research → catalog fields (client half). The server proposes values for the
   item's own catalog fields, each tied to cited sources; this module lays the
   findings out separately, one row per finding (a list proposal is split into
   its items), each with an UNCHECKED box — the cataloger marks what is
   relevant, and only the marked findings are written into their fields on the
   explicit "integrate" click (decision 21.10.2026). Undo restores a field only
   if the archivist has not edited it since. Used by
   item-research.js when the screen's adapter supplies a fieldMap
   ({ key: { id: 'r-…', label, lang: 'he'|'en' } }). */
window.yvResearchFields = (() => {
  const normLine = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  // "list" (the comma-separated Sapir lists) adds only the items the field does
  // not already hold; "append" does the same per line; anything else replaces.
  function nextValue(update, before) {
    if (update.mode === 'list') {
      const have = new Set(before.split(LIST_SPLIT).map(normLine).filter(Boolean));
      const add = update.value.split(LIST_SPLIT).map(s => s.trim()).filter(s => s && !have.has(normLine(s)));
      return add.length ? [before.trim().replace(/[,\s]+$/, ''), ...add].filter(Boolean).join(', ') : before;
    }
    if (update.mode !== 'append') return update.value;
    const have = normLine(before);
    const add = update.value.split('\n').map(s => s.trim()).filter(s => s && !have.includes(normLine(s)));
    return add.length ? (before.trim() ? before.replace(/\s+$/, '') + '\n' : '') + add.join('\n') : before;
  }
  const LIST_SPLIT = /[,،\n]/;
  // One reviewable finding per row: list proposals become one row per new item
  // (an item the field already holds is not offered again).
  function findings(data, fieldMap) {
    return (data.catalog_updates || []).filter(u => fieldMap[u.field] && document.getElementById(fieldMap[u.field].id))
      .flatMap(u => {
        if (u.mode !== 'list') return [u];
        const have = new Set(document.getElementById(fieldMap[u.field].id).value.split(LIST_SPLIT).map(normLine).filter(Boolean));
        return u.value.split(LIST_SPLIT).map(s => s.trim()).filter(s => s && !have.has(normLine(s)))
          .map(value => ({ ...u, value }));
      });
  }
  // Marked findings → one update per field (list items rejoined).
  function merge(picked) {
    const byField = new Map();
    for (const u of picked) {
      const prior = byField.get(u.field);
      if (prior && u.mode === 'list') byField.set(u.field, { ...prior, value: prior.value + ', ' + u.value, source_ids: [...new Set([...prior.source_ids, ...u.source_ids])] });
      else if (!prior) byField.set(u.field, u);
    }
    return [...byField.values()];
  }

  function cell(tag, text, lang) {
    const el = document.createElement(tag);
    el.textContent = text;
    el.dir = lang === 'en' ? 'ltr' : lang === 'auto' ? 'auto' : 'rtl';   // auto: an original title in any script
    el.style.cssText = `text-align:${lang === 'en' ? 'left' : lang === 'auto' ? 'start' : 'right'};unicode-bidi:isolate;white-space:pre-wrap;vertical-align:top;padding:6px 8px;border:1px solid var(--line, #d8d4cc)`;
    return el;
  }
  // Renders the proposals table into `container`; returns the selection reader.
  function render(container, data, fieldMap, link) {
    if (!Array.isArray(data.catalog_updates)) return () => [];   // server without the fields stage
    const updates = findings(data, fieldMap);
    const choices = new Map();
    const box = document.createElement('section');
    box.dir = 'rtl'; box.style.cssText = 'direction:rtl;text-align:right;margin:12px 0';
    const h = document.createElement('h3'); h.textContent = 'ממצאים לשילוב בשדות הקטלוג'; box.append(h);
    const note = document.createElement('p'); note.style.cssText = 'font-size:13px;color:var(--muted)';
    if (!updates.length) {
      note.textContent = data.fields_error || (data.film_identified === false
        ? 'הדוח אינו מזהה סרט מסוים בוודאות מספקת, ולכן לא הוצעו שינויים בשדות הקטלוג. השילוב יוסיף את הדוח והמקורות לשדה המידע המשלים בלבד.'
        : 'לא נמצא בדוח מידע מבוסס-מקור לשדות הקטלוג. השילוב יוסיף את הדוח והמקורות לשדה המידע המשלים בלבד.');
      box.append(note); container.append(box); return () => [];
    }
    const dropped = Object.values(data.fields_audit?.dropped || {}).reduce((a, b) => a + b, 0);
    note.textContent = (data.production_type === 'unproduced' ? 'הסרט זוהה כצילומים שלא נועדו להפקה — הכותר נשאר תיאורי. ' : '')
      + 'סמנו את הממצאים הרלוונטיים ולחצו „שלב את המידע בקטלוג” — רק הממצאים המסומנים ייכנסו לשדות. „בטל שילוב אחרון” מחזיר את הערכים הקודמים.';
    if (dropped) note.textContent += ` ${dropped} ערכים נוספים שהוצעו לא נכללו, כי אין להם מקור מצוטט בדוח או זיהוי ודאי של הסרט.`;
    box.append(note);
    const table = document.createElement('table');
    table.dir = 'rtl'; table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;direction:rtl';
    const head = document.createElement('tr');
    for (const t of ['רלוונטי', 'שדה', 'ערך נוכחי', 'ממצא', 'מקורות']) head.append(cell('th', t, 'he'));
    table.append(head);
    for (const u of updates) {
      const spec = fieldMap[u.field];
      const before = document.getElementById(spec.id).value;
      const row = document.createElement('tr');
      const pick = cell('td', '', 'he');
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = false; check.setAttribute('aria-label', `שלב בשדה ${spec.label}`);
      pick.append(check); choices.set(check, u);
      const sources = cell('td', '', 'he');
      for (const id of u.source_ids) {
        const source = (data.sources || []).find(s => s.id === id);
        if (source) { const a = link(source); a.textContent = `[${id}]`; sources.append(a, document.createTextNode(' ')); }
      }
      const adds = u.mode === 'append' || u.mode === 'list';
      row.append(pick, cell('td', adds ? `${spec.label} — הוספה` : spec.label, 'he'),
        cell('td', before || '—', spec.lang), cell('td', adds ? '+ ' + u.value : u.value, spec.lang), sources);
      table.append(row);
    }
    box.append(table); container.append(box);
    return () => merge([...choices].filter(([check]) => check.checked).map(([, u]) => u));
  }

  function apply(updates, fieldMap) {
    const changes = [];
    for (const u of updates) {
      const el = document.getElementById(fieldMap[u.field]?.id || '');
      if (!el) continue;
      const before = el.value, after = nextValue(u, before);
      if (after === before) continue;
      el.value = after;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      changes.push({ field: u.field, id: el.id, before, after, value: u.value, source_ids: u.source_ids });
    }
    return changes;
  }
  // Restores each field only while it still holds the integrated value; returns
  // the labels of fields the archivist edited since (left as they are).
  function undo(changes, fieldMap) {
    const kept = [];
    for (const c of changes) {
      const el = document.getElementById(c.id);
      if (!el) continue;
      if (el.value !== c.after) { kept.push(fieldMap[c.field]?.label || c.field); continue; }
      el.value = c.before;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return kept;
  }
  // Provenance lines for the supplementary-research field.
  const describe = (changes, fieldMap) => changes.length
    ? ['', 'שדות שעודכנו בקטלוג מהחיפוש:', ...changes.map(c => `${fieldMap[c.field]?.label || c.field}: ${c.value.length > 200 ? c.value.slice(0, 200) + '…' : c.value} ${c.source_ids.map(id => `[${id}]`).join('')}`)]
    : [];
  return { render, apply, undo, describe, nextValue };
})();
