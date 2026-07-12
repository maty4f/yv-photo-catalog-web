// yv-providers.js — shared AI-transport + response-parsing layer for the
// cataloging dashboards (photos / films / documents / documents-v2).
//
// WHY THIS EXISTS
// The provider plumbing — the Anthropic-proxy request, the Gemini base URL, the
// JSON-extraction/repair — was copy-pasted inline across the big dashboards. A
// single cross-cutting change then had to be repeated in every file. The clearest
// example: the review-#2 security fix that stripped client key headers from the
// Anthropic proxy call touched 8 sites across 4 files. Centralising the transport
// here makes the next such change ONE edit.
//
// SECURITY INVARIANT (review #1 / #2 — pinned by key-hygiene.gui.test.js)
// The browser holds NO Anthropic key. Every Claude request goes to the server's
// /api/anthropic-proxy, which injects the API key and version server-side. So the
// ONLY header the browser may attach to that request is Content-Type — never a
// client key header, a client version header, or a direct-browser-access header
// (those also break cross-origin CORS preflight). That rule now lives in ONE
// place: anthropicFetch() below.
//
// CONTRACT
// Each screen passes its own per-screen `state` object. anthropicFetch/anthropicJson
// read state.localServerUrl; geminiBase also reads state.proxyGemini. Pure logic,
// no DOM — safe to load before the page's main script.
//
// DELIBERATELY NOT HERE
// getActiveApiKey() and syncProviderRows() stay inline in each dashboard: they run
// in the page's *synchronous load path* (refreshButtons() at module top-level), and
// the jsdom test harness does not load external <script src>, so routing them
// through this file would risk a load-time throw. They also differ per screen
// (three distinct provider-row strategies). fileToBase64() likewise stays inline —
// its error handling genuinely differs across all five screens (reject-event /
// reject-Error / resolve-empty) around a single shared line, so centralising it
// would add a mode switch for almost no real dedup.
(function () {
  'use strict';

  // ── Anthropic (Claude) transport ──────────────────────────────────────
  // The proxy base. The dashboard is served BY the server, so location.origin is
  // a valid fallback when no explicit local-server URL is configured.
  function anthropicBase(state) {
    return (state.localServerUrl || location.origin) + '/api/anthropic-proxy';
  }

  // Low-level: POST a Messages payload to the proxy, return the raw Response.
  // review #2: Content-Type is the ONLY header — the proxy injects key + version.
  // Callers that need bespoke error/parse handling (documents-v2) use this and do
  // their own res.ok check.
  function anthropicFetch(state, payload) {
    return fetch(anthropicBase(state) + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // High-level: the request + the common ok-check + decode shared by
  // photos/films/documents. Returns the decoded Messages response object
  // ({ content: [{ text }], ... }). Throws on !ok with the shared message.
  async function anthropicJson(state, payload) {
    const res = await anthropicFetch(state, payload);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || ('Anthropic HTTP ' + res.status));
    }
    return res.json();
  }

  // ── Gemini transport ──────────────────────────────────────────────────
  // Proxy-aware base used by films/photos/documents. When proxyGemini is on AND a
  // local-server URL exists, route through the same-origin proxy (no CORS, key can
  // be server-managed); otherwise call Google directly.
  function geminiBase(state) {
    return (state.proxyGemini && state.localServerUrl)
      ? state.localServerUrl + '/api/gemini-proxy'
      : 'https://generativelanguage.googleapis.com';
  }

  // ── Response JSON extraction + repair ─────────────────────────────────
  // Pull a JSON object out of a model's text reply: strip ``` fences, isolate the
  // outermost { … }, parse; on failure repair (drop trailing commas, strip invalid
  // \-escapes like \' that models emit inside long transcriptions, balance
  // brackets from truncation) and retry. On total failure throw an Error carrying
  // the raw text for the UI. opts.detail === true appends the parser message to
  // the error (films' variant); default appends the "even after auto-repair" note
  // (photos/documents' variant).
  function parseJson(text, label, opts) {
    const detail = !!(opts && opts.detail);
    let s = text.trim();
    const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) s = fenceMatch[1].trim();
    if (!s.startsWith('{')) { const m = s.match(/\{[\s\S]*\}/); if (m) s = m[0]; }
    try { return JSON.parse(s); } catch (e1) {
      let repaired = s.replace(/,(\s*[}\]])/g, '$1');
      // Invalid escape sequences (e.g. וכו\' inside a quoted transcription — live
      // doc-queue failure 2026-07-11): JSON allows only \" \\ \/ \b \f \n \r \t
      // \uXXXX. Consume valid escapes atomically (so the 2nd char of \\ is never
      // re-examined) and drop the backslash of anything else.
      repaired = repaired.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g,
        m => (m.length > 1 ? m : ''));
      const openB = (repaired.match(/\{/g) || []).length;
      const closB = (repaired.match(/\}/g) || []).length;
      const openS = (repaired.match(/\[/g) || []).length;
      const closS = (repaired.match(/\]/g) || []).length;
      let nB = closB, nS = closS;
      while (nS < openS) { repaired += ']'; nS++; }
      while (nB < openB) { repaired += '}'; nB++; }
      try { return JSON.parse(repaired); } catch (e2) {
        console.error(`${label} raw response:`, text);
        const err = new Error(`${label} החזיר תגובה לא JSON תקין ${detail ? '(' + e2.message + ')' : '(גם אחרי ניסיון תיקון אוטומטי)'}`);
        err.rawText = text; err.parseError = e2.message; err.label = label;
        throw err;
      }
    }
  }

  // ── Inert HTML parsing (external review 2026-07-12 #7) ─────────────────
  // The unified sidecar HTML is AI-PRODUCED from untrusted historical documents.
  // Assigning it to a live element's innerHTML (even detached) can fire
  // <img onerror=…> on assignment — a prompt-injection payload in a scanned
  // verso would execute in the dashboard. DOMParser yields an INERT document:
  // nothing loads, nothing executes. Every sidecar-HTML read (field text,
  // id-table rows, timeline scenes) must go through here, never innerHTML.
  function parseInertHtml(html) {
    return new DOMParser().parseFromString(typeof html === 'string' ? html : '', 'text/html');
  }

  // HTML field value → plain text: confidence spans / <h4> subheads stripped,
  // block ends become newlines. "— … —" placeholders are treated as empty.
  // Was copy-pasted across photos/films/documents-v2 — exactly the drift this
  // file exists to prevent; consolidated here with the inert parser.
  function unifiedFieldText(v) {
    if (typeof v !== 'string') return '';
    const doc = parseInertHtml(v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h4|li|tr)>/gi, '\n'));
    const t = doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
    return /^—.+—$/.test(t) ? '' : t;
  }

  window.yvProviders = { anthropicBase, anthropicFetch, anthropicJson, geminiBase, parseJson, parseInertHtml, unifiedFieldText };
})();
