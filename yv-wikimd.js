/* yv-wikimd.js — ONE safe renderer for the archive wiki's markdown (graph.html,
   wiki.html). Escape first, then a closed set of constructs: headings, bullets,
   bold, [[path|label]] wiki-links, [tik_x.html] record refs, managed-block
   markers (shown as faint separators), <div dir="ltr"> from synthesis blocks
   (re-allowed as a plain LTR paragraph). No HTML from the page is ever trusted. */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // opts: { outputUrl(file) → href for [tik_x.html], pageHref(rel) → href for [[rel]] }
  window.yvWikiMd = function (md, opts) {
    opts = opts || {};
    const outputUrl = opts.outputUrl || (f => '/api/output/' + encodeURIComponent(f));
    const pageHref = opts.pageHref || (rel => 'wiki.html?page=' + encodeURIComponent(rel + '.md'));
    const lines = String(md || '').split('\n');
    let out = '', inList = false;
    const close = () => { if (inList) { out += '</ul>'; inList = false; } };
    const inline = s => s
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, rel, label) => `<a class="wl" href="${esc(pageHref(rel))}" data-page="${esc(rel)}.md">${label}</a>`)
      .replace(/\[\[([^\]|]+)\]\]/g, (_, rel) => `<a class="wl" href="${esc(pageHref(rel))}" data-page="${esc(rel)}.md">${rel}</a>`)
      .replace(/\[(tik_[^\]\s]+\.html)\]/g, (_, f) => `<a class="ext" href="${esc(outputUrl(f))}" target="_blank" rel="noopener">${f}</a>`);
    for (const raw of lines) {
      let line = esc(raw);
      const mk = /^&lt;!-- YV:([A-Z-]+) (START|END) --&gt;/.exec(line);
      if (mk) { close(); out += `<div class="managed">${mk[2] === 'START' ? '— בלוק ' + mk[1] + ' (מנוהל) —' : '— סוף —'}</div>`; continue; }
      const ltr = /^&lt;div dir=&quot;ltr&quot;&gt;(.*)&lt;\/div&gt;$/.exec(line);
      if (ltr) { close(); out += `<p dir="ltr" style="text-align:left">${inline(ltr[1])}</p>`; continue; }
      line = inline(line);
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { close(); out += `<h${Math.min(4, h[1].length + 1)}>${h[2]}</h${Math.min(4, h[1].length + 1)}>`; continue; }
      const li = /^\s*-\s+(.*)$/.exec(line);
      if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
      const mem = /^members:\s*(.*)$/.exec(raw);
      if (mem) { close(); out += `<div class="members"><b>חברים (ידני):</b> ${esc(mem[1])}</div>`; continue; }
      close();
      if (line.trim()) out += `<p>${line}</p>`;
    }
    close();
    return out;
  };
})();
