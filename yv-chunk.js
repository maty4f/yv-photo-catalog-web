// yv-chunk.js — chunked upload transport shared by the cataloging screens.
// The Cloudflare tunnel (films.mf-sr.com) rejects any single request body over
// ~100MB, so a big film/PDF can never arrive as ONE POST from a remote computer.
// A screen calls yvChunk.upload() to slice the blob into ≤32MB parts and POST
// each to /api/upload-chunk (per-chunk retry ×3 — a network blip re-sends one
// part, not the whole file); the consuming endpoint (/api/items, /api/docling,
// /api/tik-describe) then receives uploadId= instead of file= and assembles the
// parts server-side into a normal uploads/ file. Files at or under THRESHOLD
// must keep their plain single-POST path — only chunk ABOVE it.
(function () {
  'use strict';
  const CHUNK = 32 * 1024 * 1024;      // each part safely under Cloudflare's ~100MB request cap
  const THRESHOLD = 60 * 1024 * 1024;  // chunk only above this; small files stay one POST

  // XHR (not fetch) so the archivist sees upload progress — a big file through
  // the tunnel uploads at ~0.5MB/s, and a silent spinner reads as a hang.
  const xhrPost = (url, body, onPct) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // Session header (CSRF hardening, review 21.7 #36): fetch calls inherit it
    // from the yv-client-log wrapper, but XHR bypasses that wrapper — set it
    // here so chunk uploads pass the production header requirement too.
    try {
      const sid = sessionStorage.getItem('yvSessionId');
      if (sid) xhr.setRequestHeader('x-yv-session', sid);
    } catch (e) { /* storage blocked — server exempts rayless/local anyway */ }
    xhr.upload.onprogress = ev => { if (ev.lengthComputable && onPct) onPct(ev.loaded, ev.total); };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('ההעלאה בוטלה'));
    xhr.send(body);
  });

  // Slice + upload every part; resolves to the uploadId the caller sends in its
  // finalize POST. onStatus (optional) receives a ready Hebrew progress line —
  // the screen wraps it with its own spinner/prefix.
  async function upload(base, blob, name, onStatus) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    const uploadId = (crypto.randomUUID ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + Math.random().toString(36).slice(2, 10));
    const total = Math.ceil(blob.size / CHUNK);
    for (let i = 0; i < total; i++) {
      const part = blob.slice(i * CHUNK, Math.min((i + 1) * CHUNK, blob.size));
      let sent = false, lastErr = null;
      for (let a = 0; a < 3 && !sent; a++) {   // a network blip retries ONE chunk, not the whole file
        try {
          const cfd = new FormData();
          cfd.append('uploadId', uploadId); cfd.append('index', String(i));
          cfd.append('total', String(total)); cfd.append('name', name || 'file.bin');
          cfd.append('chunk', part, 'part');
          const r = await xhrPost(base + '/api/upload-chunk', cfd, l => {
            const done = Math.min(Math.round((i * CHUNK + l) / blob.size * 100), 100);
            if (onStatus) onStatus(`מעלה נתח ${i + 1}/${total}… ${done}% מתוך ${mb}MB`);
          });
          if (r.status >= 200 && r.status < 300) { sent = true; break; }
          let er = {}; try { er = JSON.parse(r.responseText); } catch (ignore) {}
          lastErr = new Error(er.error || ('שרת HTTP ' + r.status));
        } catch (e) { lastErr = e; }
        await new Promise(rr => setTimeout(rr, 2500 * (a + 1)));
      }
      if (!sent) {
        // fetch-wrap doesn't see XHR — log the api-fail ourselves
        if (window.__yvLog) __yvLog.push({ type: 'api-fail', url: base + '/api/upload-chunk', text: `chunk ${i + 1}/${total} failed: ${lastErr && lastErr.message}` });
        throw new Error(`העלאת נתח ${i + 1}/${total} נכשלה אחרי 3 ניסיונות (${lastErr && lastErr.message}) — בדוק את החיבור ונסה שוב.`);
      }
    }
    return uploadId;
  }

  window.yvChunk = { CHUNK, THRESHOLD, upload };
})();
