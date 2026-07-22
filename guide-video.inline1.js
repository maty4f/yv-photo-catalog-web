(function(){
  var SCENES = [
    { dur:4200, cap:"ברוכים הבאים למערכת הקטלוג הארכיוני. בסרטון הקצר הזה נראה את כל זרימת העבודה — מכניסה ועד רישום." },
    { dur:6500, cap:"נכנסים מכל מחשב, בלי התקנה: לכתובת films.mf-sr.com, מזינים את האימייל שלכם, ומקבלים קוד חד-פעמי למייל. אין סיסמה לזכור.",
      cursor:[{sel:'#loginEmail',at:800},{sel:'#loginCode',at:2600},{sel:'#loginBtn',at:4600,click:true}] },
    { dur:5500, cap:"בוחרים מה לקטלג: תצלום, סרט, מסמך או תיק שלם. הזרימה זהה בכולם — כאן נדגים תצלום.",
      cursor:[{sel:'#cardPhoto',at:1400,click:true}], onEnter:function(){cls('#cardPhoto','hi',1500);} },
    { dur:6500, cap:"מעלים את החזית — ואם יש, גם את גב התצלום. הגב הוא לרוב מקור המידע הכי חשוב: שמות, תאריכים וחותמות.",
      cursor:[{sel:'#dropFront',at:900,click:true},{sel:'#dropBack',at:3400,click:true}],
      onEnter:function(){ show('#fcFront',900); show('#fcBack',3200); } },
    { dur:7000, cap:"את המידע המוקדם אפשר להקליד — או פשוט להעלות את מסמכי המסירה, או מסמך מפריט האוסף, והמערכת תחלץ מהם את המידע הרלוונטי. תמיד אפשר לבדוק ולערוך.",
      cursor:[{sel:'#ctxUploadBtn',at:900,click:true}],
      onEnter:extractCtxDemo },
    { dur:7000, cap:"מתחילים — והמערכת קוראת את הפריט, מפענחת כיתובים ומצליבה מול מאגר הידע. אפשר לעבוד על משהו אחר במקביל.",
      onEnter:runProcessing },
    { dur:7500, cap:"מתקבלת רשומה דו-לשונית: כותר, מקומות, מידע נוסף ועוד. עברית מימין, אנגלית משמאל — קוראים את הכל, לא רק את הכותר." },
    { dur:6200, cap:"מעתיקים למערכת הרישום שדה אחר שדה — לוחצים העתק, עוברים, מדביקים. בלי הקלדה מחדש. יש גם ייצוא לאקסל ו-PDF.",
      cursor:[{sel:'#copyTarget',at:1200,click:true}], onEnter:function(){ cls('#copyTarget','hi',1400); show('#copyToast',1500); } },
    { dur:7000, cap:"שימו לב לסימוני הוודאות: וי ירוק זה מאושר, טילדה וסימן שאלה — לא ודאי. מצאתם טעות? כפתור זיהוי שגוי ליד השדה. לא מעתיקים בעיוורון!",
      cursor:[{sel:'#misidBtn',at:2600,click:true}], onEnter:function(){ cls('#misidBtn','hi',1800); } },
    { dur:6800, cap:"אפשר להעלות חומר עזר חיצוני — ספרי קהילה, מפתחות שמות, מחקרים. פעם אחת, והמערכת מצליבה מולם בכל קטלוג עם ציון המקור.",
      cursor:[{sel:'#kbUpload',at:2200,click:true}], onEnter:function(){ cls('#kbUpload','hi',1200); show('#kbRow',2500); } },
    { dur:6000, cap:"זהו — אתם מוכנים. לפני כל רישום עברו על הבדיקות הקצרות, וכל שאלה — מנהל המערכת כאן בשבילכם. בהצלחה!" }
  ];
  // Each scene lasts its neural-narration clip + a short tail (measured from the
  // generated Gemini-TTS audio in audio/guide/). Keeps visuals synced to speech.
  var NARR_MS=[8970,13570,8810,9490,11770,9210,9690,10010,12850,10370,8650];
  SCENES.forEach(function(s,n){ s.dur = NARR_MS[n] + 650; });

  var stage=document.getElementById('stage'), cursor=document.getElementById('cursor'),
      caption=document.getElementById('caption'), overlay=document.getElementById('overlay'),
      tlFill=document.getElementById('timelineFill'), count=document.getElementById('count'),
      dots=document.getElementById('scenedots');
  var i=0, playing=false, sceneT0=0, raf=null, timers=[], soundOn=true, heVoice=null, started=false, gen=0, sceneTimer=null, tlTimer=null, sceneElapsed=0;

  // Narration: pre-rendered NEURAL Hebrew audio (Gemini TTS, voice "Leda") is the
  // primary voice — the SAME natural voice for every viewer, independent of their
  // machine's installed voices. The browser's built-in speech is only a fallback
  // if an audio file fails to load.
  var narr = SCENES.map(function(_,n){ var a=new Audio('audio/guide/scene_'+String(n).padStart(2,'0')+'.mp3'); a.preload='auto'; return a; });
  var curAudio=null;
  function stopAudio(){ if(curAudio){ try{ curAudio.pause(); curAudio.currentTime=0; }catch(e){} } curAudio=null; if(window.speechSynthesis)speechSynthesis.cancel(); }
  function narrate(n){ stopAudio(); if(!soundOn)return; var a=narr[n]; curAudio=a; try{a.currentTime=0;}catch(e){} a.play().catch(function(){ speakFallback(SCENES[n].cap); }); }

  // Fallback path only: the browser's best available Hebrew voice.
  function rankVoice(v){ var s=0,x=((v.name||'')+' '+(v.voiceURI||'')).toLowerCase(); if(/enhanced|premium|neural|natural|siri/.test(x))s+=4; if(v.localService===false)s+=1; return s; }
  function pickVoice(){ var vs=window.speechSynthesis?speechSynthesis.getVoices():[]; heVoice=vs.filter(function(v){return /^he/i.test(v.lang);}).sort(function(a,b){return rankVoice(b)-rankVoice(a);})[0]||null; }
  if(window.speechSynthesis){ speechSynthesis.onvoiceschanged=pickVoice; pickVoice(); }
  function speakFallback(t){ if(!soundOn||!window.speechSynthesis)return; speechSynthesis.cancel(); var u=new SpeechSynthesisUtterance(t); u.lang='he-IL'; if(heVoice)u.voice=heVoice; u.rate=0.98; u.pitch=1.03; speechSynthesis.speak(u); }

  // scene dots
  SCENES.forEach(function(_,n){ var d=document.createElement('i'); d.onclick=function(){ go(n); }; dots.appendChild(d); });

  function clearTimers(){ timers.forEach(clearTimeout); timers=[]; if(raf)cancelAnimationFrame(raf); raf=null; clearTimeout(sceneTimer); clearInterval(tlTimer); }
  function at(fn,ms){ timers.push(setTimeout(fn,ms)); }
  function show(sel,ms){ at(function(){ var e=stage.querySelector(sel); if(e)e.classList.add('show'); },ms); }
  function cls(sel,c,ms){ var e=stage.querySelector(sel); if(!e)return; e.classList.add(c); at(function(){ e.classList.remove(c); },ms); }

  function moveCursor(sel,click){ var el=stage.querySelector(sel); if(!el)return; var s=stage.getBoundingClientRect(), r=el.getBoundingClientRect();
    var x=r.left-s.left+r.width/2-6, y=r.top-s.top+r.height/2-4; cursor.style.transform='translate('+x+'px,'+y+'px)';
    if(click){ cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click'); } }

  function resetScene(n){
    // reset transient states so replays look right
    ['#fcFront','#fcBack','#copyToast','#kbRow','#ctxFileChip'].forEach(function(s){var e=stage.querySelector(s);if(e)e.classList.remove('show');});
    stage.querySelectorAll('.hi').forEach(function(e){e.classList.remove('hi');});
    if(n===4){ var c=stage.querySelector('#ctxBox'); if(c)c.innerHTML='<span class="caret"></span>'; var st=stage.querySelector('#ctxExtractStatus'); if(st)st.textContent=''; }
    if(n===5){ setRing(0); document.getElementById('stageTxt').textContent='קריאת התצלום…'; document.getElementById('clock').textContent='00:07'; }
  }

  function render(n){
    stage.querySelectorAll('[data-scene]').forEach(function(el){ el.classList.toggle('active', +el.dataset.scene===n); });
    Array.prototype.forEach.call(dots.children,function(d,k){ d.classList.toggle('on',k===n); });
    count.textContent=(n+1)+' / '+SCENES.length;
    caption.textContent=SCENES[n].cap;
    cursor.style.opacity=(n===0||n===SCENES.length-1)?'0':'1';
  }

  function enterScene(n){
    clearTimers(); gen++; sceneElapsed=0; resetScene(n); render(n);
    var sc=SCENES[n];
    if(sc.onEnter) at(sc.onEnter,60);
    (sc.cursor||[]).forEach(function(c){ at(function(){ moveCursor(c.sel,c.click); }, c.at); });
    narrate(n);
    startClock();
  }

  // Scene ADVANCE is setTimeout-based so it fires even when a background/inactive
  // tab throttles requestAnimationFrame. rAF stays only for the cosmetic ring +
  // typing animations; the timeline bar is refreshed on a light interval.
  function startClock(){
    sceneT0=performance.now();
    clearTimeout(sceneTimer); clearInterval(tlTimer);
    sceneTimer=setTimeout(advance, Math.max(0, SCENES[i].dur - sceneElapsed));
    tlTimer=setInterval(updateTl, 120); updateTl();
  }
  function updateTl(){ var el=sceneElapsed+(performance.now()-sceneT0); tlFill.style.width=Math.min(100,(el/SCENES[i].dur)*100)+'%'; }
  function advance(){ if(i<SCENES.length-1){ i++; enterScene(i); } else { pause(); tlFill.style.width='100%'; } }
  function setIcon(){ document.getElementById('btnPlay').textContent=playing?'⏸':'▶'; }

  function play(){ if(!started){ started=true; overlay.classList.add('hidden'); } playing=true; setIcon(); enterScene(i); }
  function resume(){ if(playing)return; if(sceneElapsed>=SCENES[i].dur-50){ sceneElapsed=0; playing=true; setIcon(); startClock(); narrate(i); return; }
    playing=true; setIcon(); startClock(); if(soundOn){ if(curAudio && !curAudio.ended){ curAudio.play().catch(function(){}); } else { narrate(i); } } }
  function pause(){ if(playing) sceneElapsed+=performance.now()-sceneT0; playing=false; setIcon(); clearTimeout(sceneTimer); clearInterval(tlTimer); if(raf)cancelAnimationFrame(raf); if(curAudio)curAudio.pause(); if(window.speechSynthesis)speechSynthesis.cancel(); }
  function go(n){ i=Math.max(0,Math.min(SCENES.length-1,n)); if(!started){started=true;overlay.classList.add('hidden');} playing=true; setIcon(); enterScene(i); }

  document.getElementById('btnPlay').onclick=function(){ if(!started){play();return;} playing?pause():resume(); };
  document.getElementById('btnPrev').onclick=function(){ go(i-1); };
  document.getElementById('btnNext').onclick=function(){ go(i+1); };
  document.getElementById('btnRestart').onclick=function(){ go(0); };
  document.getElementById('btnSound').onclick=function(){ soundOn=!soundOn; this.innerHTML=(soundOn?'🔊':'🔇')+' <span class="lbl">קול</span>'; if(!soundOn) stopAudio(); else if(playing) narrate(i); };
  overlay.onclick=play;
  document.getElementById('timeline').onclick=function(e){ var r=this.getBoundingClientRect(); var p=(e.clientX-r.left)/r.width; sceneT0=performance.now()-p*SCENES[i].dur; };
  document.addEventListener('keydown',function(e){ if(e.code==='Space'){e.preventDefault();document.getElementById('btnPlay').click();} if(e.code==='ArrowLeft')go(i+1); if(e.code==='ArrowRight')go(i-1); });

  // scene-specific animations
  // Scene 5: demonstrate that "מידע מוקדם" can be EXTRACTED from an uploaded
  // accompanying document (delivery form / a page from the collection item) — the
  // archivist clicks "חלץ מידע מקובץ", a file appears, and the box fills with the
  // AI-extracted facts. (You can also just type; the caption says so.)
  function extractCtxDemo(){
    var g=gen, box=stage.querySelector('#ctxBox'),
        chip=stage.querySelector('#ctxFileChip'), status=stage.querySelector('#ctxExtractStatus');
    if(!box)return;
    box.innerHTML='<span class="caret"></span>';
    if(chip)chip.classList.remove('show');
    if(status){ status.textContent=''; status.style.color='var(--muted)'; }
    cls('#ctxUploadBtn','hi',1300);
    at(function(){ if(g!==gen)return; if(chip)chip.classList.add('show'); if(status)status.textContent='מחלץ מידע מהמסמך…'; }, 1500);
    at(function(){ if(g!==gen)return; typeExtracted(g); }, 2700);
  }
  function typeExtracted(g){
    var box=stage.querySelector('#ctxBox'), status=stage.querySelector('#ctxExtractStatus'); if(!box)return;
    var txt="מוסר החומר: משפחת לוין (בעלים).\nאישים: רחל לוין לבית קפלן (1912–1943).\nמקום: גטו לודז'.\nתקופה: חורף 1941–42.\nסימול: P.5030/17.";
    box.innerHTML=''; var j=0; (function step(){ if(!playing||g!==gen){return;} box.textContent=txt.slice(0,j); var c=document.createElement('span'); c.className='caret'; box.appendChild(c); j++;
      if(j<=txt.length) at(step,40);
      else if(status){ status.textContent='✓ חולץ מטופס המסירה'; status.style.color='var(--good)'; } })(); }

  var C=326.7;
  function setRing(p){ var arc=document.getElementById('ringArc'); if(arc)arc.style.strokeDashoffset=(C*(1-p/100)).toFixed(1); var n=document.getElementById('pctNum'); if(n)n.textContent=Math.round(p)+'%'; var b=document.getElementById('barFill'); if(b)b.style.width=p+'%'; }
  function runProcessing(){ var t0=performance.now(), dur=6200, g=gen, stages=[[0,'קריאת התצלום…'],[25,'פענוח כיתוב הגב (פולנית)…'],[55,'הצלבה מול מאגר הידע…'],[80,'ניסוח הרשומה הדו-לשונית…'],[97,'כמעט מוכן…']];
    (function frame(){ if(!playing||g!==gen){return;} var el=performance.now()-t0, p=Math.min(100,(el/dur)*100); setRing(p);
      var sec=7+Math.round(el/1000); document.getElementById('clock').textContent='00:'+(sec<10?'0':'')+sec;
      var st=stages[0][1]; stages.forEach(function(s){ if(p>=s[0])st=s[1]; }); document.getElementById('stageTxt').textContent= p>=100?'✓ הרשומה מוכנה':st;
      if(p<100) raf=requestAnimationFrame(frame); })(); }

  render(0);
})();
