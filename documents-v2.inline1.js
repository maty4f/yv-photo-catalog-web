// =====================================================================
//  State
// =====================================================================
const VALID_MODES = ['unified-server', 'claude-cli', 'gemini-only'];
const state = {
  mode: VALID_MODES.includes(localStorage.getItem('yv_v2_mode')) ? localStorage.getItem('yv_v2_mode') : 'unified-server',
  apiKey: localStorage.getItem('yv_v2_api_key') || '',
  // review #2: no Anthropic key in the browser — the server proxy injects its own
  model: localStorage.getItem('yv_v2_model') || 'gemini-3.5-flash',
  claudeModel: localStorage.getItem('yv_v2_claude_model') || 'claude-sonnet-4-6',
  localServerUrl: (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, ''),
  pdf: null,
  result: null,
};

// Auto-config: the dashboard is normally served BY the API server (localhost in
// dev, films.mf-sr.com via the tunnel) — using this same origin keeps the
// Cloudflare Access cookie attached. Adopt the origin unless we're on a static
// GitHub Pages host (*.pages.dev / *.github.io), where the API lives elsewhere.
// Also drop a stale saved trycloudflare URL — those rotate every run.
if (/^https?:$/.test(location.protocol) && !/\.(pages\.dev|github\.io)$/.test(location.hostname)) {
  state.localServerUrl = location.origin;
} else if (/trycloudflare\.com/.test(state.localServerUrl)) {
  state.localServerUrl = '';
}

// =====================================================================
//  DOM refs
// =====================================================================
const $ = id => document.getElementById(id);
const modeSel = $('mode');
const apiKeyInput = $('api-key');
const modelSel = $('model');
const claudeModelSel = $('claude-model');
const drop = $('drop');
const fileInput = $('file-input');
const filenameEl = $('filename');
const filemetaEl = $('filemeta');
const fileInfoEl = drop.querySelector('.file-info');
const placeholderEl = drop.querySelector('.placeholder');
const contextEl = $('context');
const analyzeBtn = $('analyze-btn');
const statusEl = $('status');
const resultsEl = $('results');
const rowClaudeModel = $('row-claude-model');

modeSel.value = state.mode;
apiKeyInput.value = state.apiKey;
modelSel.value = state.model;
claudeModelSel.value = state.claudeModel;

function syncModeUI() {
  // The Claude model row was only for the removed hybrid mode — always hidden.
  rowClaudeModel.style.display = 'none';
}
syncModeUI();

modeSel.addEventListener('change', () => {
  state.mode = modeSel.value;
  localStorage.setItem('yv_v2_mode', state.mode);
  syncModeUI();
  refresh();
});
apiKeyInput.addEventListener('input', () => {
  state.apiKey = apiKeyInput.value.trim();
  localStorage.setItem('yv_v2_api_key', state.apiKey);
  refresh();
});
try { localStorage.removeItem('yv_v2_api_key_anthropic'); } catch {}   // review #1: purge any persisted Claude key
modelSel.addEventListener('change', () => {
  state.model = modelSel.value;
  localStorage.setItem('yv_v2_model', state.model);
});
claudeModelSel.addEventListener('change', () => {
  state.claudeModel = claudeModelSel.value;
  localStorage.setItem('yv_v2_claude_model', state.claudeModel);
});

const localServerUrlInput = $('local-server-url');
localServerUrlInput.value = state.localServerUrl;
localServerUrlInput.addEventListener('input', () => {
  state.localServerUrl = localServerUrlInput.value.trim().replace(/\/$/, '');
  localStorage.setItem('yv_local_server_url', state.localServerUrl);
});

// =====================================================================
//  Combined PDF of uploaded image scans (self-contained, no libs)
//  v2 only understands PDF — so a folder of image scans is merged into one
//  PDF in-browser, downloaded, and then fed into the normal analysis flow.
// =====================================================================
async function pdfPageFor(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('טעינת תמונה נכשלה')); im.src = url; });
    const edge = 2000;
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, width: w, height: h };
  } finally { URL.revokeObjectURL(url); }
}
function buildImagesPdf(pages) {
  const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const parts = []; let offset = 0; const offsets = [];
  const push = chunk => { const u = typeof chunk === 'string' ? enc(chunk) : chunk; parts.push(u); offset += u.length; };
  const mark = n => { offsets[n] = offset; };
  const N = pages.length;
  const kids = []; for (let i = 0; i < N; i++) kids.push((3 + i * 3) + ' 0 R');
  push('%PDF-1.3\n%\xff\xff\xff\xff\n');
  mark(1); push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  mark(2); push('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + N + ' >>\nendobj\n');
  for (let i = 0; i < N; i++) {
    const p = pages[i], pageN = 3 + i * 3, contentN = pageN + 1, imgN = pageN + 2, W = p.width, H = p.height;
    mark(pageN);
    push(pageN + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + ']' +
      ' /Resources << /XObject << /Im0 ' + imgN + ' 0 R >> >> /Contents ' + contentN + ' 0 R >>\nendobj\n');
    const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    mark(contentN);
    push(contentN + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
    mark(imgN);
    push(imgN + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>\nstream\n');
    push(p.bytes); push('\nendstream\nendobj\n');
  }
  const xrefStart = offset, total = 2 + N * 3;
  push('xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n');
  for (let n = 1; n <= total; n++) push(String(offsets[n] || 0).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');
  let len = 0; parts.forEach(p => len += p.length);
  const out = new Uint8Array(len); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
function triggerDownload(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Merge a folder/drop of image scans into one PDF, download it, and load it as
// the document to be cataloged (v2's whole flow is PDF-based).
async function loadImagesAsMergedPdf(fileList) {
  const imgs = [...fileList]
    .filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|tiff?|webp)$/i.test(f.name))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
  if (!imgs.length) { alert('לא נמצאו תמונות בתיקייה.'); return; }
  try {
    const pages = [];
    for (let i = 0; i < imgs.length; i++) {
      showStatus(`מאחד ${imgs.length} תמונות ל-PDF… ${i + 1}/${imgs.length}`, 'info');
      pages.push(await pdfPageFor(imgs[i]));
    }
    const tikName = ((imgs[0].webkitRelativePath || '').split('/')[0] || 'תיק').replace(/[\\/:*?"<>|]+/g, '_');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fname = tikName + '_' + today + '.pdf';
    const blob = new Blob([buildImagesPdf(pages)], { type: 'application/pdf' });
    triggerDownload(blob, fname);
    loadPdf(new File([blob], fname, { type: 'application/pdf' }));
    showStatus(`✓ אוחדו ${imgs.length} תמונות ל-PDF (${fname.replace(/[<>&]/g, '')}) — מוכן לרישום.`, 'ok');
  } catch (e) {
    showStatus('⚠ איחוד ה-PDF נכשל: ' + e.message, 'err');
  }
}

// =====================================================================
//  File upload
// =====================================================================
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('dragover'); }));
drop.addEventListener('drop', ev => {
  const files = [...(ev.dataTransfer.files || [])];
  if (!files.length) return;
  const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const imgs = files.filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|tiff?|webp)$/i.test(f.name));
  // Images (and no PDF) → merge them into one PDF; otherwise treat as a single PDF.
  if (imgs.length && !files.some(isPdf)) loadImagesAsMergedPdf(files);
  else loadPdf(files[0]);
});
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; fileInput.value = ''; if (f) loadPdf(f); });
$('folder-input').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) loadImagesAsMergedPdf(files);
});

function loadPdf(file) {
  if (file.type && file.type !== 'application/pdf') {
    alert('רק קובצי PDF נתמכים בזרימה הזו. לקבצים אחרים — השתמש בזרימה הישנה.');
    return;
  }
  state.pdf = file;
  filenameEl.textContent = file.name;
  filemetaEl.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  fileInfoEl.style.display = 'block';
  placeholderEl.style.display = 'none';
  drop.classList.add('has-file');
  refresh();
}

function refresh() {
  let hasKey;
  if (state.mode === 'unified-server') {
    // Server-side engine — no browser keys needed. From pages.dev the local-server
    // URL (same field as Docling/CLI) must be set; on the server's own origin
    // relative URLs work, so an empty URL is fine there.
    hasKey = !!state.localServerUrl || !location.hostname.endsWith('pages.dev');
  } else if (state.mode === 'claude-cli') {
    // Claude reads the PDF directly via the local server — only the server URL is needed.
    hasKey = !!state.localServerUrl;
  } else {
    hasKey = !!state.apiKey;
  }
  analyzeBtn.disabled = !(state.pdf && hasKey);
  let missing = '';
  if (!state.pdf) missing = 'יש להעלות PDF';
  else if (state.mode === 'unified-server' && !hasKey) missing = 'מצב מנוע מאוחד דורש URL של השרת המקומי (שדה "שרת Docling" למעלה)';
  else if (state.mode === 'claude-cli' && !state.localServerUrl) missing = 'מצב Claude CLI דורש URL של שרת מקומי (בהרצה מ-localhost מוגדר אוטומטית)';
  else if (state.mode !== 'claude-cli' && !state.apiKey) missing = 'יש להזין מפתח Gemini';
  analyzeBtn.title = missing;
  analyzeBtn.textContent = state.mode === 'unified-server'
    ? '🔍 הפק רישום (מנוע מאוחד בשרת)'
    : state.mode === 'claude-cli'
    ? '🔍 הפק רישום (Claude קורא ישירות)'
    : '🔍 הפק רישום ארכיוני';
}
refresh();

// =====================================================================
//  Gemini Files API helpers
// =====================================================================
async function uploadToFiles(file, onProgress) {
  const startRes = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': file.size.toString(),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'Content-Type': 'application/json',
      'x-goog-api-key': state.apiKey,
    },
    body: JSON.stringify({ file: { display_name: file.name } }),
  });
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`Files API start failed: ${startRes.status} — ${t.slice(0, 200)}`);
  }
  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Files API לא החזיר X-Goog-Upload-URL');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Content-Length', file.size.toString());
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).file); }
        catch (e) { reject(new Error('Files API responded with invalid JSON: ' + e.message)); }
      } else {
        reject(new Error(`Files API upload failed: HTTP ${xhr.status} — ${xhr.responseText.slice(0, 200)}`));
      }
    };
    xhr.onerror = () => reject(new Error('Files API: network error during upload'));
    xhr.send(file);
  });
}

async function waitForFileActive(fileName, maxAttempts = 90) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      headers: { 'x-goog-api-key': state.apiKey },
    });
    if (!res.ok) throw new Error(`File status check failed: HTTP ${res.status}`);
    const data = await res.json();
    if (data.state === 'ACTIVE') return data;
    if (data.state === 'FAILED') throw new Error('Gemini failed to process the file: ' + (data.error?.message || 'unknown'));
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout — Gemini took too long to process the file');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

// =====================================================================
//  Claude CLI direct read — POST a job to /api/ask-async and poll until done.
//  Async so a long Claude run survives the Cloudflare quick-tunnel ~100s limit.
//  `images` is [{mime, data(base64)}]; the server writes each to a temp file
//  and tells Claude to Read it — a real visual pass over the scans.
// =====================================================================
async function runClaudeJobV2(prompt, images) {
  const base = state.localServerUrl;
  if (!base) throw new Error('מצב Claude CLI דורש URL של שרת מקומי.');
  const model = (state.claudeModel || '').includes('opus') ? 'opus' : 'sonnet';
  let res;
  try {
    res = await fetch(base + '/api/ask-async', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model, images: images || [] }),
    });
  } catch (e) {
    throw new Error(`לא ניתן להגיע לשרת המקומי (${e.message}). ודא ששרת הבית רץ (node server.js), ובגישה מרחוק שגם ה-tunnel פעיל וה-URL מעודכן.`);
  }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error('שרת HTTP ' + res.status + ': ' + (e.error || '').slice(0, 400)); }
  const { jobId } = await res.json();
  if (!jobId) throw new Error('השרת לא החזיר jobId. ודא שגרסת השרת תומכת ב-/api/ask-async.');
  // Shared poll mechanics (yvPollAsk in yv-client-log.js — review 21.7 #21):
  // the per-screen copy kept only its own status line, cap and timeout wording.
  if (!window.yvPollAsk) throw new Error('רכיב משותף (yv-client-log) לא נטען — רענן את הדף');
  const r = await yvPollAsk(base, jobId, { maxMs: 15 * 60 * 1000,
    onTick: (j, sec) => showStatus('Claude קורא את המסמך ומפיק את הרישום… (' + sec + ' שׄ)') });
  if (r.status === 'auth') return;
  if (r.status === 'done') return r.text;
  if (r.status === 'error') throw new Error('Claude נכשל: ' + r.error);
  throw new Error('הריצה נמשכה מעל 15 דקות ולא הסתיימה. נסה מסמך קצר יותר.');
}

// =====================================================================
//  PDF page sampling — for huge PDFs (>50MB) that Gemini won't accept
// =====================================================================
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
  window.pdfjsLib = mod;
  return mod;
}

// Pick representative page numbers: first 3 + middle 4 + last 3
function pickSamplePages(totalPages, want = 10) {
  if (totalPages <= want) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const head = [1, 2, 3];
  const tail = [totalPages - 2, totalPages - 1, totalPages];
  const mid = [];
  const midStart = Math.floor(totalPages * 0.35);
  const midEnd = Math.floor(totalPages * 0.65);
  const midCount = want - head.length - tail.length;
  for (let i = 0; i < midCount; i++) {
    const p = Math.round(midStart + (midEnd - midStart) * (i / Math.max(1, midCount - 1)));
    mid.push(p);
  }
  return [...new Set([...head, ...mid, ...tail])].sort((a, b) => a - b);
}

async function renderPageToJpegBase64(pdf, pageNum, maxWidth = 2200) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  // 2200px long-edge keeps dense handwriting legible (only ~10 pages are sampled,
  // so the larger payload is affordable). Cap the up-scale at 3× for tiny sources.
  const scale = Math.min(maxWidth / viewport.width, 3);
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  // Quality 0.85 = good handwriting/OCR readability while keeping size down
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.split(',')[1];
}

async function samplePdfAsImages(file, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const sampleNums = pickSamplePages(totalPages, 10);
  if (onProgress) onProgress(0, sampleNums.length, totalPages);
  const parts = [];
  for (let i = 0; i < sampleNums.length; i++) {
    const pn = sampleNums[i];
    const b64 = await renderPageToJpegBase64(pdf, pn);
    parts.push({ pageNum: pn, b64 });
    if (onProgress) onProgress(i + 1, sampleNums.length, totalPages);
  }
  return { totalPages, sampled: parts };
}

// =====================================================================
//  The prompt — single-stage archival record
// =====================================================================
function buildPrompt(ctx, totalPages, sampleInfo) {
  const inputDesc = sampleInfo
    ? `המסמך גדול מדי לשליחה במלואו. מצורפות **${sampleInfo.sampled} דגימות עמודים מתוך ${sampleInfo.total} עמודים** (פתיחה + אמצע + סיום). תפיק רישום ארכיוני על-בסיס הדגימות, וציין ב-notes אם נראה שיש תכנים חשובים בעמודים שלא נדגמו.`
    : 'המסמך מצורף כקובץ PDF במלואו.';

  return `אתה מקטלג בכיר במדור המסמכים של הארכיון, מומחה לפיענוח מסמכים היסטוריים מהתקופה 1900–1948.

${inputDesc} **אל תיצור תעתיק מלא של הטקסט** — תפקידך להפיק רישום ארכיוני קצר ומדויק שיכניס את המסמך לקטלוג ספיר.

═══ הקשר מהמוסר ═══
${ctx || '(לא ניתן הקשר מוקדם)'}

═══ חוקי ודאות ═══
- אם פרט קריא בבירור → כתוב אותו ישירות
- אם פרט חלקית קריא → כתוב + "[?]" אחריו
- אם פרט לא קריא או לא במסמך → השאר ריק (אסור לנחש)
- שמות מקומות → שם בשפת המקור + תרגום מקובל בסוגריים (לדוגמה "Łódź / לודז'")

═══ דרישת פלט ═══
החזר **JSON אחד בלבד** ללא code-fence ובלי טקסט הקדמה, לפי הסכימה:

{
  "doc_type": "מכתב / גלויה / תעודה / רשימה / יומן / פרוטוקול / הצהרה / מנשר / מסמך אחר",
  "languages": "גרמנית, יידיש, …",
  "writing_type": "מודפס / כתב יד / מעורב / מכונת כתיבה",
  "pages_count": "${totalPages || ''}",
  "doc_date": "DD/MM/YYYY או חלקי (לדוגמה: 'מאי 1942', '1939–1941')",
  "title_he": "כותר תיאורי בעברית (10-15 מילים)",
  "title_en": "Title in English (10-15 words)",
  "sender_he": "שם השולח/יוצר בעברית",
  "sender_en": "Sender/Creator in English",
  "recipient_he": "שם הנמען בעברית",
  "recipient_en": "Recipient in English",
  "place_he": "מקום היצירה — עברית",
  "place_en": "Place of creation — English",
  "summary_he": "סיכום מובנה של 15-25 שורות. מכסה: על מה המסמך, נושאים מרכזיים, אישים, אירועים, מועדים, שמות מקומות. עברית אקדמית-ארכיונית. ללא תרגום מילולי, רק תיאור התוכן.",
  "summary_en": "Same structured summary in English (15-25 lines).",
  "persons_he": "רשימת אישים מוזכרים (שמות, מי הם, מה תפקידם במסמך). מופרדים בנקודות-פסיק.",
  "persons_en": "Same list in English.",
  "places_mentioned_he": "מקומות גיאוגרפיים שמוזכרים במסמך (לא מקום היצירה). מופרדים בפסיקים.",
  "places_mentioned_en": "Same in English.",
  "orgs_he": "מוסדות, ארגונים, גופים שמוזכרים. מופרדים בפסיקים.",
  "orgs_en": "Same in English.",
  "subjects": "3-5 נושאים מרכזיים בעברית, מופרדים בפסיקים. לדוגמה: גירוש, גטו, יהדות לודז', יודנראט",
  "quotes": "2-4 ציטוטים מרכזיים מהמסמך בשפת המקור (כל ציטוט עד 2 משפטים). מופרדים בשורה ריקה.",
  "notes": "הערות לארכיונאי: מה לא ברור, מה דורש בירור, תקלות בקובץ, חוסר התאמה לקונטקסט שניתן."
}

חוקים נוספים:
- אם השפה היא לא לטינית (עברית/יידיש/רוסית) — בציטוטים שמור על המקור
- אם המסמך הוא תיק של מספר מסמכים שונים — תאר את התיק בכללותו ב-summary, וציין זאת ב-notes
- אם אינך מצליח לקרוא משהו חשוב — אל תמציא, רשום ב-notes`;
}

// =====================================================================
//  Stage 2 — Claude refines the Gemini draft (Hybrid mode)
//  Claude does NOT see the PDF — only the JSON Gemini produced + context.
//  Its job: historical validation, terminology, archival conventions.
// =====================================================================
async function claudeRefine(geminiDraft, ctx, sampleInfo) {
  const samplingNote = sampleInfo
    ? (sampleInfo.sampled === 'docling-markdown'
        ? `הטיוטה הוכנה לאחר חילוץ Markdown מלא ע"י Docling מ-${sampleInfo.total} עמודים.`
        : `הטיוטה הוכנה מ-${sampleInfo.sampled} דגימות עמודים מתוך ${sampleInfo.total} עמודים סה"כ — חלק מהתוכן לא נראה ע"י Gemini.`)
    : 'הטיוטה הוכנה ע"י Gemini שראה את ה-PDF במלואו.';

  const prompt = `אתה היסטוריון בכיר במדור המסמכים של הארכיון, מומחה לתקופה 1900–1948 (שואה, אנטישמיות, מלחמת העולם השנייה, יהדות מזרח אירופה).

תקבל **טיוטת רישום ארכיוני** שהכין Gemini על מסמך היסטורי. תפקידך: **לאמת היסטורית, לחדד טרמינולוגיה, לתקן שגיאות**, ולוודא שהרישום עומד בסטנדרטים ארכיוניים.

${samplingNote}

⚠ אתה לא ראית את המסמך עצמו — רק את הטיוטה והקונטקסט. אסור לך להוסיף עובדות שלא בטיוטה. אם פרט תלוי בראיה חזותית שאתה לא רואה — שמור על מה ש-Gemini כתב.

═══ מטלות שלך ═══
1. **טרמינולוגיה ארכיונית**: וודא שימוש בטרמינולוגיה ארכיונית (גטו, אקציה, גירוש, מחנה ריכוז, מחנה השמדה, יודנראט, פרטיזנים, וכו'). תקן אם Gemini השתמש במונח חופשי.
2. **שמות מקומות**: וודא שמות מקומות בגבולות 1939, עם תעתיק מקובל (Łódź/לודז', Wilno/וילנה, וכו').
3. **תאריכים**: וודא פורמט תקין (DD/MM/YYYY או חלקי), והגיוניות היסטורית (לדוגמה: אם הטיוטה אומרת "מכתב יודנראט 1948" — זה אנכרוניזם, סמן ב-notes).
4. **אישים מוזכרים**: אם מוזכרים שמות של דמויות היסטוריות מוכרות — וודא איות, וציין תפקיד/הקשר אם רלוונטי.
5. **עברית אקדמית**: שדרג את ה-summary_he לעברית אקדמית-ארכיונית (לא תרגום מילולי).
6. **English archival register**: שדרג summary_en להיות מקצועי וקצר.
7. **notes**: הוסף הערות לארכיונאי על: אנכרוניזמים, חוסר התאמה לקונטקסט, מילים שדורשות בירור.

═══ פלט ═══
החזר את **אותו JSON** עם כל ${Object.keys(geminiDraft).length} השדות, עם התיקונים שלך. אסור להשמיט שדות. אסור להוסיף שדות חדשים.

החזר JSON תקין בלבד, ללא code-fence, ללא טקסט הקדמה.

═══ הקונטקסט מהמוסר ═══
${ctx || '(לא ניתן)'}

═══ הטיוטה של Gemini ═══
\`\`\`json
${JSON.stringify(geminiDraft, null, 2)}
\`\`\``;

  const res = await yvProviders.anthropicFetch(state, {
    model: state.claudeModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  if (!res.ok) {
    const body = await res.text();
    let err = {}; try { err = JSON.parse(body); } catch {}
    throw new Error(`Claude HTTP ${res.status}: ${err.error?.message || body.slice(0, 200)}`);
  }
  const data = await res.json();
  let text = (data.content?.[0]?.text || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude החזיר תגובה שאינה JSON תקין');
    return JSON.parse(m[0]);
  }
}

// =====================================================================
//  Stage 2 (CLI variant) — runs `claude` CLI on the user's local machine
//  via the local-server /api/ask endpoint. Free for Claude Max users.
// =====================================================================
async function claudeRefineViaCLI(geminiDraft, ctx, sampleInfo) {
  if (!state.localServerUrl) throw new Error('חסר URL של שרת מקומי');

  const samplingNote = sampleInfo
    ? (sampleInfo.sampled === 'docling-markdown'
        ? `הטיוטה הוכנה לאחר חילוץ Markdown מלא ע"י Docling מ-${sampleInfo.total} עמודים.`
        : `הטיוטה הוכנה מ-${sampleInfo.sampled} דגימות עמודים מתוך ${sampleInfo.total} עמודים סה"כ — חלק מהתוכן לא נראה ע"י Gemini.`)
    : 'הטיוטה הוכנה ע"י Gemini שראה את ה-PDF במלואו.';

  const prompt = `אתה היסטוריון בכיר במדור המסמכים של הארכיון, מומחה לתקופה 1900–1948 (שואה, אנטישמיות, מלחמת העולם השנייה, יהדות מזרח אירופה).

תקבל **טיוטת רישום ארכיוני** שהכין Gemini על מסמך היסטורי. תפקידך: **לאמת היסטורית, לחדד טרמינולוגיה, לתקן שגיאות**, ולוודא שהרישום עומד בסטנדרטים ארכיוניים.

${samplingNote}

⚠ אתה לא ראית את המסמך עצמו — רק את הטיוטה והקונטקסט. אסור להוסיף עובדות שלא בטיוטה.

מטלות:
1. טרמינולוגיה ארכיונית (גטו, אקציה, גירוש, יודנראט, וכו')
2. שמות מקומות בגבולות 1939 + תעתיק מקובל
3. הגיוניות תאריכים
4. עברית אקדמית-ארכיונית ל-summary_he
5. English archival register ל-summary_en
6. notes: הערות לארכיונאי על אנכרוניזמים / חוסר התאמה / נושאים שדורשים בירור

החזר את אותו JSON עם ${Object.keys(geminiDraft).length} השדות, עם התיקונים שלך. אסור להשמיט / להוסיף שדות.
החזר JSON תקין בלבד, ללא code-fence ובלי טקסט הקדמה.

═══ הקונטקסט מהמוסר ═══
${ctx || '(לא ניתן)'}

═══ הטיוטה של Gemini ═══
\`\`\`json
${JSON.stringify(geminiDraft, null, 2)}
\`\`\``;

  // Text-only refine — route through the async /api/ask-async job runner so the
  // call survives the Cloudflare quick-tunnel ~100s limit (same as the direct read).
  let text = (await runClaudeJobV2(prompt, [])).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude CLI החזיר תגובה שאינה JSON תקין');
    return JSON.parse(m[0]);
  }
}

// =====================================================================
//  Main flow
// =====================================================================
function showStatus(msg, kind) {
  statusEl.className = 'status ' + (kind || 'info');
  const escMsg = String(msg).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  statusEl.innerHTML = (kind === 'info' ? '<span class="spinner"></span>' : '') + escMsg;
}

// Threshold above which we bypass the PDF route entirely and sample pages as images.
// Gemini Files API officially supports 2GB but PDFs >50MB tend to fail (FAILED state).
const PDF_SAMPLE_THRESHOLD_MB = 50;

analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  resultsEl.classList.remove('show');
  const sizeMB = state.pdf.size / 1024 / 1024;
  const INLINE_MAX = 14;

  try {
    // === UNIFIED SERVER ENGINE === upload → SSE progress → produced catalog HTML.
    // Runs fully server-side (Gemini + Claude CLI + validation) — no browser keys.
    if (state.mode === 'unified-server') {
      await runUnifiedServer();
      return;
    }

    // === CLAUDE CLI DIRECT === Claude reads the PDF/scans itself via the local
    // server's /api/ask-async (it writes the bytes to a temp file and has Claude
    // Read them). No Gemini → no PROHIBITED_CONTENT block on Holocaust material.
    // One pass: Claude reads the document AND produces the archival record.
    if (state.mode === 'claude-cli') {
      let images, sampleInfo;
      if (sizeMB <= 18) {
        showStatus(`מקודד את המסמך (${sizeMB.toFixed(1)}MB) ושולח ל-Claude…`);
        images = [{ mime: 'application/pdf', data: await fileToBase64(state.pdf) }];
      } else {
        // Too large to send whole (server JSON limit) — sample representative
        // pages to JPEGs in the browser and send those to Claude instead.
        showStatus(`קובץ גדול (${sizeMB.toFixed(0)}MB) — דוגם עמודים מייצגים בדפדפן לשליחה ל-Claude…`);
        const { totalPages, sampled } = await samplePdfAsImages(state.pdf, (done, total, allPages) => {
          showStatus(`דוגם עמוד ${done}/${total} (מתוך ${allPages} עמודים)…`);
        });
        images = sampled.map(s => ({ mime: 'image/jpeg', data: s.b64 }));
        sampleInfo = { sampled: sampled.length, total: totalPages };
      }
      const prompt = buildPrompt(contextEl.value.trim(), sampleInfo?.total || '', sampleInfo) +
        '\n\n🛑 הקובץ המצורף הוא סריקה אמיתית של מסמך היסטורי מהארכיון — קרא אותו במלואו. אם זה PDF רב-עמודים, קרא את כל העמודים (בטווחים אם צריך, למשל pages:"1-10") ואל תעצור אחרי העמוד הראשון.';
      let text = await runClaudeJobV2(prompt, images);
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('Claude החזיר תגובה שאינה JSON תקין:\n' + text.slice(0, 800));
        parsed = JSON.parse(m[0]);
      }
      state.result = parsed;
      fillForm(parsed);
      resultsEl.classList.add('show');
      showStatus('✓ הרישום הופק ע"י Claude (קריאה ישירה, בלי Gemini). סקור את השדות וערוך לפי הצורך.', 'ok');
      resultsEl.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    let parts;        // array of content parts to send to Gemini
    let sampleInfo;   // {sampled, total} if we sampled instead of sending the whole PDF

    if (sizeMB > PDF_SAMPLE_THRESHOLD_MB && state.localServerUrl) {
      // === DOCLING MODE === huge PDF + local server available
      // → send to docling on the local server, get back full markdown,
      //   then pass the markdown (not the PDF) to Gemini for the archival record.
      showStatus(`🔬 שולח קובץ גדול (${sizeMB.toFixed(0)}MB) ל-Docling במחשב המקומי…`);
      const fd = new FormData();
      if (window.yvChunk && state.pdf.size > yvChunk.THRESHOLD) {
        // past the tunnel's ~100MB request cap — chunked, assembled server-side
        fd.append('uploadId', await yvChunk.upload(state.localServerUrl, state.pdf,
          state.pdf.name || 'doc.pdf', msg => showStatus('🔬 Docling · ' + msg)));
      } else {
        fd.append('file', state.pdf);
      }
      const dRes = await fetch(state.localServerUrl + '/api/docling', { method: 'POST', body: fd });
      if (!dRes.ok) {
        const t = await dRes.text();
        throw new Error(`Docling failed: HTTP ${dRes.status} — ${t.slice(0, 300)}`);
      }
      const dData = await dRes.json();
      if (!dData.ok) throw new Error(`Docling error: ${dData.error || 'unknown'}`);

      showStatus(`Docling חילץ ${dData.num_chars.toLocaleString()} תווים מ-${dData.num_pages} עמודים (${dData.elapsed_sec}s). שולח ל-Gemini לרישום…`);
      sampleInfo = { sampled: 'docling-markdown', total: dData.num_pages };
      // Cap markdown at ~200K chars (~50K tokens) so Gemini context isn't blown
      let mdForGemini = dData.markdown || '';
      if (mdForGemini.length > 200000) {
        const head = mdForGemini.slice(0, 100000);
        const tail = mdForGemini.slice(-80000);
        mdForGemini = head + '\n\n[...טקסט מהאמצע הושמט בגלל אורך — ' + (dData.num_chars - 180000).toLocaleString() + ' תווים...]\n\n' + tail;
      }
      parts = [{
        text: `המסמך עובד מקומית ע"י Docling (IBM) שחילץ את הטקסט המובנה מ-${dData.num_pages} עמודים. הטקסט מצורף כ-Markdown להלן. תפיק רישום ארכיוני על-בסיסו.\n\n--- DOCLING MARKDOWN ---\n${mdForGemini}\n--- END MARKDOWN ---`
      }];
    } else if (sizeMB > PDF_SAMPLE_THRESHOLD_MB) {
      // === SAMPLE MODE === for huge PDFs without local server
      showStatus(`קובץ גדול (${sizeMB.toFixed(0)}MB) — דוגם עמודים מייצגים בדפדפן…`);
      const { totalPages, sampled } = await samplePdfAsImages(state.pdf, (done, total, allPages) => {
        showStatus(`דוגם עמוד ${done}/${total} (מתוך ${allPages} עמודים בקובץ)…`);
      });
      sampleInfo = { sampled: sampled.length, total: totalPages };
      parts = [{ text: `מצורפות ${sampled.length} דגימות עמודים מתוך ${totalPages} עמודים. כל תמונה מסומנת במספר העמוד שלה במסמך המקורי.` }];
      for (const s of sampled) {
        parts.push({ text: `--- עמוד ${s.pageNum} מתוך ${totalPages} ---` });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: s.b64 } });
      }
    } else if (sizeMB <= INLINE_MAX) {
      // === INLINE PDF === small files go directly
      showStatus(`מקודד את המסמך (${sizeMB.toFixed(1)}MB)…`);
      const b64 = await fileToBase64(state.pdf);
      parts = [{ inline_data: { mime_type: 'application/pdf', data: b64 } }];
    } else {
      // === FILES API === medium files (14-50MB)
      showStatus(`מעלה מסמך גדול (${sizeMB.toFixed(1)}MB) ל-Gemini Files API…`);
      const uploaded = await uploadToFiles(state.pdf, (loaded, total) => {
        const pct = Math.round(loaded / total * 100);
        showStatus(`העלאה: ${pct}% (${(loaded/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB)…`);
      });
      showStatus('ממתין ש-Gemini יעבד את הקובץ…');
      await waitForFileActive(uploaded.name);
      parts = [{ file_data: { file_uri: uploaded.uri, mime_type: uploaded.mimeType || 'application/pdf' } }];
    }

    const stageLabel = '';
    showStatus(sampleInfo
      ? `${stageLabel}Gemini מפיק רישום מתוך ${sampleInfo.sampled} דגימות (${sampleInfo.total} עמודים סה"כ)…`
      : `${stageLabel}Gemini מפיק רישום ארכיוני…`);
    const prompt = buildPrompt(contextEl.value.trim(), sampleInfo?.total || '', sampleInfo);
    parts.push({ text: prompt });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      let parsed = {}; try { parsed = JSON.parse(body); } catch {}
      throw new Error(`Gemini HTTP ${res.status}: ${parsed.error?.message || body.slice(0, 300)}\n\n=== body ===\n${body.slice(0, 1500)}`);
    }
    const data = await res.json();
    let text = (data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
    if (!text) throw new Error('Gemini החזיר תגובה ריקה');

    // Strip optional code-fence
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      // try to extract first {...}
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini החזיר תגובה שאינה JSON תקין:\n' + text.slice(0, 800));
      parsed = JSON.parse(m[0]);
    }

    state.result = parsed;
    fillForm(parsed);
    resultsEl.classList.add('show');
    showStatus('✓ הרישום הופק בהצלחה. סקור את השדות וערוך לפי הצורך.', 'ok');
    resultsEl.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    showStatus('שגיאה: ' + err.message, 'err');
  } finally {
    analyzeBtn.disabled = false;
  }
});

// =====================================================================
//  UNIFIED SERVER ENGINE — upload to /api/items, stream SSE, link output.
//  Reuses state.localServerUrl (same field as Docling / Claude CLI);
//  empty base ⇒ relative URLs (works when the page is served by the server).
// =====================================================================
// Same-origin first: if this page is served by the API server itself
// (films.mf-sr.com / localhost), a stale saved tunnel URL in localStorage must
// not shadow it — probe /api/health and prefer relative URLs when it answers.
async function resolveUnifiedBase() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) return '';
  } catch {}
  return state.localServerUrl || null;
}

async function runUnifiedServer() {
  const base = await resolveUnifiedBase();
  if (base === null)
    throw new Error('הזן URL של השרת המקומי (films.mf-sr.com) בשדה כתובת השרת');
  const fd = new FormData();
  fd.append('kind', 'doc');
  fd.append('context', contextEl.value.trim());
  if (window.yvFlow) fd.append('flow', yvFlow.current('documents-v2'));   // אוטומטי / Mistral למודפס
  if (window.yvFlow && yvFlow.backend) fd.append('backend', yvFlow.backend('documents-v2'));   // Claude: מנוי / API
  if (window.yvChunk && state.pdf.size > yvChunk.THRESHOLD) {
    // Big scan — sliced to ≤32MB parts (past the tunnel's ~100MB request cap;
    // per-chunk retry ×3), assembled server-side; the finalize POST carries
    // uploadId instead of the file.
    const uploadId = await yvChunk.upload(base, state.pdf, state.pdf.name || 'doc.pdf', msg => showStatus(msg));
    fd.append('uploadId', uploadId);
    showStatus('כל הנתחים הועלו — השרת מרכיב את המסמך ומתחיל בקטלוג…');
  } else {
    fd.append('file', state.pdf);
    showStatus('מעלה את המסמך לשרת המאוחד…');
  }

  const res = await fetch(base + '/api/items', { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ('שגיאת שרת ' + res.status));
  if (!j.jobId) throw new Error('השרת לא החזיר jobId — ודא שגרסת השרת תומכת ב-/api/items');

  showStatus('מנתח בשרת (Gemini → Claude → ולידציה)… מסמך — כמה דקות');
  if (window.yvProgress) yvProgress.begin({ screen: 'documents-v2', kind: 'doc' });
  await new Promise((resolve, reject) => {
    const es = new EventSource(base + '/api/jobs/' + j.jobId + '/events');
    let serverErr = '';
    // Bound a silent hang: a server restart mid-job reconnects the SSE but never
    // emits 'end', so cap the wait and reject instead of hanging forever.
    const esGuard = setTimeout(() => {
      es.close();
      if (window.yvProgress) yvProgress.end(false, 'אין תגובה מהשרת');
      reject(new Error('אין תגובה מהשרת (ייתכן שאותחל). רענן את הדף ובדוק בלוגים.'));
    }, 40 * 60 * 1000);
    es.onmessage = e => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'error') serverErr = ev.message || '';
        else if (ev.text) {
          if (window.yvProgress) yvProgress.step(ev.text);
          const line = String(ev.text).trim().split('\n').pop().slice(0, 160);
          if (line) showStatus('🛠 ' + line);
        }
      } catch (ignore) {}
    };
    es.addEventListener('end', async e => {
      clearTimeout(esGuard); es.close();
      let fin = {};
      try { fin = JSON.parse(e.data); } catch (ignore) {}
      if (fin.status === 'done' && fin.outputName) {
        if (window.yvProgress) yvProgress.end(true);
        const url = base + '/api/output/' + encodeURIComponent(fin.outputName);
        statusEl.className = 'status ok';
        statusEl.innerHTML = '✓ הרישום מוכן — <a href="' + url + '" download>⬇ הורד את קובץ הקטלוג</a> · <a href="' + url + '" target="_blank" rel="noopener">↗ פתח בלשונית</a>';
        await loadUnifiedResults(base, fin.outputName); // fills the editable results; fail-soft
        resolve();
      } else {
        if (window.yvProgress) yvProgress.end(false, serverErr);
        reject(new Error(serverErr || 'הניתוח הסתיים בשגיאה בשרת'));
      }
    });
    es.onerror = () => { /* SSE auto-reconnects; terminal state arrives via "end" */ };
  });
}

// =====================================================================
//  unified-server → editable results section.
//  The engine writes a fields-JSON sidecar next to the output HTML (same
//  name, .json extension). Map its template keys (TITLE_HE, INFO_HE, …)
//  onto the page's record shape and reuse fillForm so the archivist can
//  edit the fields before copying. Fail-soft: old outputs without a
//  sidecar keep the download links only.
// =====================================================================
async function loadUnifiedResults(base, outputName) {
  const jsonUrl = base + '/api/output/' + encodeURIComponent(outputName.replace(/\.html$/i, '.json'));
  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fields = await res.json();
    const r = mapUnifiedDocFields(fields);
    state.result = r;
    fillForm(r);
    resultsEl.classList.add('show');
    statusEl.innerHTML += ' · השדות נטענו למטה לעריכה ✎';
    resultsEl.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.warn('unified-server: fields JSON unavailable —', err);
    statusEl.innerHTML += ' · <span style="color:var(--muted)">(שדות לעריכה אינם זמינים לפלט זה)</span>';
  }
}

// HTML field value → plain text: confidence spans / <h4> subheads stripped,
// block ends become newlines. "— … —" placeholders are treated as empty.
// Shared in yv-providers.js (external review 2026-07-12 #7): parses via an
// INERT DOMParser document, never a live innerHTML sink — AI-produced sidecar
// HTML must not be able to fire <img onerror> on assignment.
const unifiedFieldText = v => yvProviders.unifiedFieldText(v);

// Sidecar template keys → the record shape fillForm expects. Extra keys
// (ocr_original, translation_*) are not form fields but stay visible in
// the raw-JSON panel and the copy-JSON button.
function mapUnifiedDocFields(f) {
  const txt = k => unifiedFieldText(f[k]);
  return {
    doc_type: txt('DOC_TYPE'),
    languages: txt('DOC_LANGUAGE'),
    doc_date: txt('DOC_DATE'),
    title_he: txt('TITLE_HE'), title_en: txt('TITLE_EN'),
    sender_he: txt('AUTHOR_HE'), sender_en: txt('AUTHOR_EN'),
    recipient_he: txt('RECIPIENT_HE'), recipient_en: txt('RECIPIENT_EN'),
    places_mentioned_he: txt('PLACES_HE'), places_mentioned_en: txt('PLACES_EN'),
    summary_he: txt('INFO_HE'), summary_en: txt('INFO_EN'),
    notes: txt('NOTES_HE'),
    ocr_original: txt('OCR_ORIGINAL'),
    translation_he: txt('TRANSLATION_HE'), translation_en: txt('TRANSLATION_EN'),
  };
}

// Strip dual-axis confidence markup the model sometimes injects into prose
// fields (e.g. <span class="cv c-mid">V~</span>, or the malformed
// 'span class="cv c-high">V✓</span>' with a dropped leading '<'), plus bare
// V✓/H~/V? tokens. Confidence belongs in the data, never in the copy-paste text.
function stripConfidenceMarkup(v) {
  // The model sometimes returns a prose field as an array of lines; coerce so
  // the strip runs on a string instead of passing the raw array (with markup) through.
  if (Array.isArray(v)) v = v.filter(x => x != null).join('\n');
  if (typeof v !== 'string') return v == null ? '' : String(v);
  return v
    .replace(/(?:<|&lt;)?\s*\/?\s*span(?:\s[^<>]*)?(?:>|&gt;)/gi, '')
    .replace(/[VH]\s*[✓~?]/g, '')
    .replace(/\s*class\s*=\s*"(?:cv|ch)[^"]*"/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:)])/g, '$1')
    .trim();
}

function fillForm(r) {
  const map = {
    'r-doc-type': r.doc_type,
    'r-languages': r.languages,
    'r-writing-type': r.writing_type,
    'r-pages-count': r.pages_count,
    'r-doc-date': r.doc_date,
    'r-title-he': r.title_he,
    'r-title-en': r.title_en,
    'r-sender-he': r.sender_he,
    'r-sender-en': r.sender_en,
    'r-recipient-he': r.recipient_he,
    'r-recipient-en': r.recipient_en,
    'r-place-he': r.place_he,
    'r-place-en': r.place_en,
    'r-summary-he': r.summary_he,
    'r-summary-en': r.summary_en,
    'r-persons-he': r.persons_he,
    'r-persons-en': r.persons_en,
    'r-places-mentioned-he': r.places_mentioned_he,
    'r-places-mentioned-en': r.places_mentioned_en,
    'r-orgs-he': r.orgs_he,
    'r-orgs-en': r.orgs_en,
    'r-subjects': r.subjects,
    'r-quotes': r.quotes,
    'r-notes': r.notes,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = $(id);
    if (el) el.value = stripConfidenceMarkup(val);
  }
  $('raw-json').textContent = JSON.stringify(r, null, 2);
}

$('copy-json-btn').addEventListener('click', async () => {
  if (!state.result) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.result, null, 2));
    showStatus('✓ JSON הועתק ללוח', 'ok');
  } catch (e) { alert('שגיאה: ' + e.message); }
});

$('download-html-btn').addEventListener('click', () => {
  if (!state.result) return;
  const r = state.result;
  const today = new Date().toISOString().slice(0, 10);
  const safeName = (state.pdf?.name || 'document').replace(/[^\w.-]+/g, '_').slice(0, 60);
  const html = buildOutputHtml(r, today);
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `doc_${safeName}_${today.replace(/-/g, '')}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function buildOutputHtml(r, today) {
  const esc = s => window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));   // canonical escaper delegate (review 21.7 #21)   // upgraded from the 4-char variant — apostrophes now escaped
  const row = (label, val) => val ? `<tr><th>${esc(label)}</th><td>${esc(val).replace(/\n/g, '<br>')}</td></tr>` : '';
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${esc(r.title_he || 'מסמך')}</title>
<style>
body { font-family: "SBL Hebrew", "Frank Ruhl Libre", sans-serif; line-height: 1.6; padding: 30px; max-width: 900px; margin: 0 auto; direction: rtl; text-align: right; }
h1 { color: #2e7d4e; border-bottom: 2px solid #2e7d4e; padding-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin: 15px 0; }
th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; vertical-align: top; text-align: right; unicode-bidi: isolate; }
th { background: #f0f7f2; width: 180px; color: #555; font-weight: 600; }
.section { margin-top: 20px; }
.section h2 { color: #2e7d4e; font-size: 18px; margin-bottom: 8px; }
.bilingual { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bilingual > div { direction: rtl; text-align: right; unicode-bidi: isolate; }
.bilingual .en { direction: ltr; text-align: left; }
.meta { color: #888; font-size: 12px; margin-top: 30px; }
</style></head><body>
<h1>${esc(r.title_he || '—')}</h1>
<div style="direction:ltr; text-align:left; color:#555; margin-bottom:20px;">${esc(r.title_en || '')}</div>

<div class="section"><h2>מטא-דאטה</h2><table>
${row('סוג מסמך', r.doc_type)}
${row('שפות', r.languages)}
${row('כתיבה', r.writing_type)}
${row('מספר עמודים', r.pages_count)}
${row('תאריך', r.doc_date)}
${row('שולח / יוצר', r.sender_he)}
${row('Sender (EN)', r.sender_en)}
${row('נמען', r.recipient_he)}
${row('Recipient (EN)', r.recipient_en)}
${row('מקום', r.place_he)}
${row('Place (EN)', r.place_en)}
</table></div>

<div class="section"><h2>סיכום מורחב</h2>
<div class="bilingual">
  <div><h4>עברית</h4><div>${esc(r.summary_he).replace(/\n/g, '<br>')}</div></div>
  <div class="en"><h4>English</h4><div>${esc(r.summary_en).replace(/\n/g, '<br>')}</div></div>
</div></div>

<div class="section"><h2>אישים, מקומות, מוסדות</h2><table>
${row('אישים מוזכרים', r.persons_he)}
${row('Persons (EN)', r.persons_en)}
${row('מקומות מוזכרים', r.places_mentioned_he)}
${row('Places mentioned (EN)', r.places_mentioned_en)}
${row('מוסדות', r.orgs_he)}
${row('Organizations (EN)', r.orgs_en)}
${row('נושאים', r.subjects)}
</table></div>

${r.quotes ? `<div class="section"><h2>ציטוטים</h2><div style="background:#fafaf6; padding:14px; border-right:3px solid #2e7d4e;">${esc(r.quotes).replace(/\n/g, '<br>')}</div></div>` : ''}

${r.notes ? `<div class="section"><h2>הערות</h2><div>${esc(r.notes).replace(/\n/g, '<br>')}</div></div>` : ''}

<div class="meta">הופק ב-${today} · documents v2 · Gemini ${esc(state.model || '')}</div>
</body></html>`;
}
