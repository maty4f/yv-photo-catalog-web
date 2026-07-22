(function(){
      // Self-contained live model-availability poller — reads /api/status and
      // marks which route in each fallback chain is serving right now.
      function serverBase(){
        // Deliberately NOT the canonical yvServerBase (review 21.7 #21): this
        // widget additionally treats stored trycloudflare.com URLs as stale.
        var u = (localStorage.getItem('yv_local_server_url') || '').replace(/\/$/, '');
        if (u && !/trycloudflare\.com/.test(u)) return u;
        if (location.origin && /^https?:/.test(location.origin) &&
            !/localhost|127\.0\.0\.1/.test(location.origin)) return location.origin;
        return u || location.origin;
      }
      function mapState(s){ return s==='ok' ? 'up' : s==='limited' ? 'limited'
        : (s==='error' || s==='no-key') ? 'down' : 'standby'; }
      function setNode(model, dotState, active){
        var n = document.querySelector('.ms-node[data-model="'+model+'"]');
        if(!n) return;
        n.querySelector('.ms-dot').className = 'ms-dot ' + dotState;
        n.classList.toggle('active', !!active);
      }
      function render(st){
        var g = mapState(st && st.gemini && st.gemini.status);
        var c = mapState(st && st.claude && st.claude.status);
        // Reading chain: Gemini primary; if not fully up → Qwen carries it.
        var readGemini = (g === 'up');
        setNode('gemini', g, readGemini);
        setNode('qwen', 'standby', !readGemini);
        setNode('mistral', 'standby', false);
        // Synthesis chain: Claude CLI first; if CLI not up → Claude API takes over.
        var cliUp = (c === 'up');
        setNode('claude-cli', c, cliUp);
        setNode('claude-api', cliUp ? 'standby' : 'up', !cliUp);
        setNode('gemini-synth', 'standby', false);
        document.getElementById('ms-updated').textContent =
          'עודכן ' + new Date().toLocaleTimeString('he-IL');
      }
      function renderUnknown(){
        ['gemini','qwen','mistral','claude-cli','claude-api','gemini-synth']
          .forEach(function(m){ setNode(m, 'standby', false); });
        document.getElementById('ms-updated').textContent = 'לא ניתן לבדוק (אין חיבור לשרת)';
      }
      function poll(){
        fetch(serverBase() + '/api/status', { cache: 'no-store' })
          .then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(render).catch(renderUnknown);
      }
      poll();
      setInterval(poll, 15000);
    })();
