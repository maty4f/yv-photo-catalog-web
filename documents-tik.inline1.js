const $ = id => document.getElementById(id);
const state = { files: [], intakeFiles: [], queue: [], queueRunning: false };

/* ---------- helpers ---------- */
function fileToBase64(file){return new Promise(r=>{const fr=new FileReader();fr.onload=e=>r(e.target.result.split(',')[1]);fr.onerror=()=>r('');fr.readAsDataURL(file);});}
// Downscale a scan client-side before sending. Full-res archive scans are huge;
// shrinking to a modest long-edge keeps each /api/ask-async request under the
// 25MB JSON limit and speeds Claude's Read. Handwriting stays legible ~1500px.
function imgMaxEdge(){return Math.max(500,Math.min(3500,parseInt($('img-edge')?.value,10)||1100));}
// Tiling grid for handwriting: 0 = off, 2 = 2×2, 3 = 3×3.
function tilingGrid(){const v=parseInt($('tiling')?.value,10);return (v===2||v===3)?v:0;}
async function loadImg(file){
  const url=URL.createObjectURL(file);
  try{return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>{URL.revokeObjectURL(url);res(i);};i.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('טעינת תמונה נכשלה'));};i.src=url;});}
  catch(e){URL.revokeObjectURL(url);throw e;}
}
async function downscaledB64(file){
  const img=await loadImg(file);
  const edge=imgMaxEdge();
  const scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
  const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  cv.getContext('2d').drawImage(img,0,0,w,h);
  return cv.toDataURL('image/jpeg',0.72).split(',')[1];
}
// Split one scan into g×g OVERLAPPING tiles, each rendered near-native so the
// model "zooms in" on handwriting. Returns [{data,label}], preceded by a low-res
// full-page overview so the model can place tiles within the page layout.
// Overlap (~12%) ensures text on a tile boundary appears whole in a neighbor.
async function tileImageB64(file,grid,edge,quality){
  const img=await loadImg(file);
  const W=img.naturalWidth,H=img.naturalHeight;
  const out=[];
  // Full-page overview at modest res for layout context.
  const ovEdge=Math.min(1100,Math.max(W,H));
  const os=ovEdge/Math.max(W,H);
  const ocv=document.createElement('canvas');ocv.width=Math.max(1,Math.round(W*os));ocv.height=Math.max(1,Math.round(H*os));
  ocv.getContext('2d').drawImage(img,0,0,ocv.width,ocv.height);
  out.push({data:ocv.toDataURL('image/jpeg',0.75).split(',')[1],label:'סקירת עמוד מלא (overview)'});
  // Overlapping grid. Labels describe physical position (x=0 is the left edge).
  const ov=0.12, cellW=W/grid, cellH=H/grid, oW=cellW*ov, oH=cellH*ov;
  const rowName=grid===2?['עליונה','תחתונה']:['עליונה','אמצעית','תחתונה'];
  const colName=grid===2?['שמאלית','ימנית']:['שמאלית','אמצעית','ימנית'];
  for(let r=0;r<grid;r++){
    for(let c=0;c<grid;c++){
      const x0=Math.max(0,Math.round(c*cellW-oW)), x1=Math.min(W,Math.round((c+1)*cellW+oW));
      const y0=Math.max(0,Math.round(r*cellH-oH)), y1=Math.min(H,Math.round((r+1)*cellH+oH));
      const cw=x1-x0, ch=y1-y0;
      const s=Math.min(1,edge/Math.max(cw,ch));
      const tw=Math.max(1,Math.round(cw*s)), th=Math.max(1,Math.round(ch*s));
      const cv=document.createElement('canvas');cv.width=tw;cv.height=th;
      cv.getContext('2d').drawImage(img,x0,y0,cw,ch,0,0,tw,th);
      out.push({data:cv.toDataURL('image/jpeg',quality).split(',')[1],label:`אריח: פינה ${rowName[r]} ${colName[c]}`});
    }
  }
  return out;
}
function esc(s){ return window.yvEsc ? yvEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }   // delegates to the ONE canonical escaper (review 21.7 #21); inline fallback covers pre-load calls
function mimeOf(f){const n=(f.name||'').toLowerCase();
  if(n.endsWith('.pdf'))return'application/pdf';
  if(n.endsWith('.png'))return'image/png';
  if(n.endsWith('.tif')||n.endsWith('.tiff'))return'image/tiff';
  if(n.endsWith('.webp'))return'image/webp';
  return'image/jpeg';}
function showStatus(msg,kind){const s=$('status');s.innerHTML=msg;s.className='status show '+(kind||'info');}
function parseJson(text,label){
  // Delegate to the SHARED parser (yv-providers.js): the private copy here
  // missed the live invalid-escape fix of 2026-07-11 — the exact drift the
  // system review flagged (2026-07-21 #21). Local impl stays as fallback only.
  if(window.yvProviders&&yvProviders.parseJson)return yvProviders.parseJson(text,label);
  return parseJsonLocal(text,label);
}
function parseJsonLocal(text,label){
  let s=String(text||'').trim();
  const fence=s.match(/```(?:json)?\s*([\s\S]*?)```/); if(fence)s=fence[1].trim();
  if(!s.startsWith('{')){const m=s.match(/\{[\s\S]*\}/);if(m)s=m[0];}
  try{return JSON.parse(s);}catch(e1){
    const fixed=repairJson(s);
    if(fixed!=null)return fixed;
    const err=new Error(label+' החזיר תגובה שאינה JSON תקין');err.rawText=text;throw err;
  }
}
// Repair a truncated JSON object by walking it with a proper bracket stack,
// then cutting back to the most complete structural boundary that parses.
function repairJson(s){
  let inStr=false,esc=false; const stack=[]; const safe=[];
  for(let i=0;i<s.length;i++){const c=s[i];
    if(inStr){ if(esc)esc=false; else if(c==='\\')esc=true; else if(c==='"')inStr=false; continue; }
    if(c==='"')inStr=true;
    else if(c==='{'||c==='[')stack.push(c==='{'?'}':']');
    else if(c==='}'||c===']')stack.pop();
    if(!inStr&&(c==='}'||c===']'||c===','))safe.push([i,stack.slice()]);
  }
  for(let k=safe.length-1;k>=0;k--){
    const [i,st]=safe[k];
    const frag=s.slice(0,i+1).replace(/,\s*$/,'');
    let close=''; for(let j=st.length-1;j>=0;j--)close+=st[j];
    try{return JSON.parse(frag+close);}catch(e){}
  }
  return null;
}
const cmark = c => { const m={'✓':'high','~':'mid','?':'low'}; const cls=m[c]||'mid'; return `<span class="cmark ${cls}">${c||'~'}</span>`; };

/* ---------- the cataloging rules embedded in the prompt (from the two YV procedures) ---------- */
const TIK_SCHEMA_RULES = `אתה מקטלג ארכיוני בארכיון. לפניך **תיק שלם** (כל הדפים מצורפים). עליך להפיק **רשומת-תיק אחת** לפי נהלי ספיר לקטלוג תיעוד ממקורות פרטיים.

עקרונות-על:
- יחידת התיאור היא התיק כולו ("פריט תוכן/לוגי"), לא כל מסמך בנפרד.
- אסור לנחש. אם משהו לא קריא — ציין זאת. אל תמציא שמות/מקומות/תאריכים.
- אל תתקן עובדות סותרות בתיק — הצג את שתיהן ("במסמך X רשום…, באחר…").
- התמקד בתקופת השואה ובמה שרלוונטי לחיפוש (שמות, מקומות, אירועים). אל תפרט חומר טרום/בתר-מלחמתי לא רלוונטי.
- כשמתעתקים שם אדם, מקום, ארגון או מונח לעברית — שמור תמיד את הכתיב המקורי בלועזית בסוגריים מיד אחרי התעתיק העברי (לדוגמה: לודז׳ (Łódź), היינריך וייס (Heinrich Weiss), גסטפו (Gestapo)). זה חל בכל השדות — כותר, מקומות קשורים, מידע נוסף, יוצר החומר ויהלומים.

"יהלומים" — מסמכים ייחודיים שמישהו עשוי לחפש ספציפית, שאסור שייבלעו בתיאור כללי: מכתב אישי של ניצול על גורלו; תצהיר/עדות; יומן; רשימת נספים/מגורשים/תושבים יהודים; תעודה רשמית ממחנה/גטו (גם "סטנדרטית"); מסמך על זהות בדויה. סמן כל יהלום.

כותר: משפט אחד תמציתי בעברית — סוג החומר המרכזי + נושא + עד 2-3 שמות (אחר כך "ועוד") + טווח שנים. בלי נקודות, רק פסיקים. דוגמה: "מכתבים שנשלחו אל לסלו וייס בפלוגות עבודה בהונגריה בידי בני משפחה ב-1943–1944".

מידע נוסף: פסקאות לפי קבוצות החומר. יהלום מצוין במפורש בתוך הפסקה. עדות/יומן/זיכרונות → ראשי פרקים מופרדים בנקודה-פסיק (לא נרטיב). חומר משני → "בתיק גם". לא לכפול את הכותר.

מקומות קשורים: רק מקומות רלוונטיים לשואה (מגורים בתקופה, גטאות, מחנות, עבודת כפייה, גירוש, מסתור, שחרור). שם כפי שבמסמך; שם מקובל היום בסוגריים.

תאריכים: אותנטי = כפי שבמסמך. משוחזר = DD/MM/YYYY (אם רק שנה: 01/01 עד 31/12).
מקוריות: "מקורי" (כתב יד/דפוס מקורי/מכונת כתיבה) או "לא מקורי" (סריקה/הדפסה מודרנית).
מיועד להקלדת שמות: true אם יש בתיק שמות מלאים של נספים/מגורשים/תושבים יהודים.
סיווג: "בלתי מסווג" כברירת מחדל; "מוגבל"/"שמור" רק עם סיבה.

אינוונטר מסמכים (document_inventory): שורה לכל מסמך/קבוצת-דפים בתיק, מסודרת לפי סדר הדפים — "מפת התיק" לניווט המקטלג. pages=טווח דפים בתיק; doc_type=סוג; date=תאריך אם מופיע; languages=שפות; description=תיאור במשפט.

מפתח שמות (names_index): שורה לכל אדם המופיע בתיק (לא רק נספים — גם בני משפחה, פקידים, חותמים). אחד אותו אדם לשורה אחת גם אם מופיע בכמה מסמכים. name=שם בעברית; name_original=הכתיב המקורי בלועזית; role=תפקיד/קרבה; birth/death=תאריכים אם מצוינים; place=מקום קשור; fate=גורל אם מצוין (נספה/שרד/גורש/לא ידוע); source_pages=הדפים שבהם מופיע. מזין את מאגר שמות קורבנות השואה.

ציר זמן ביוגרפי (timeline): אירועים בעלי תאריך מתוך התיק, מסודרים כרונולוגית — גירוש, מאסר, העברה למחנה, שחרור, לידה/פטירה, הגירה וכו'. date=תאריך כפי שניתן לקבוע (שנה לפחות); event=תיאור קצר; place=מקום (עם כתיב מקורי בסוגריים); source_pages=דפים; confidence=✓/~/? לפי ודאות. רק אירועים המעוגנים בתיק — אל תמציא.

נושאים (subjects_he / subjects_en): בחר עד 10 נושאים רלוונטיים **רק מרשימת התזאורוס הסגורה** שתופיע בהמשך הבקשה. תרגום אחד-לאחד בין עברית לאנגלית לפי הרשימה. אם לא ניתנה רשימה — השאר מערכים ריקים.

החזר אך ורק JSON תקין בסכימה:
{
 "title": "",
 "additional_info_paragraphs": [ {"heading": "", "body": "", "contains_diamond": false} ],
 "also_in_file": [ "" ],
 "related_places": [ "" ],
 "date_authentic_start": "", "date_authentic_end": "",
 "date_reconstructed_start": "", "date_reconstructed_end": "",
 "originality": "מקורי",
 "creator_person": "", "creator_org": "",
 "content_note": "",
 "languages": [ "" ],
 "designate_name_typing": false, "name_typing_reason": "",
 "classification": "בלתי מסווג", "classification_reason": "",
 "diamonds": [ {"type": "", "description": "", "location": ""} ],
 "document_inventory": [ {"pages": "", "doc_type": "", "date": "", "languages": "", "description": ""} ],
 "names_index": [ {"name": "", "name_original": "", "role": "", "birth": "", "death": "", "place": "", "fate": "", "source_pages": ""} ],
 "timeline": [ {"date": "", "event": "", "place": "", "source_pages": "", "confidence": ""} ],
 "subjects_he": [ "" ],
 "subjects_en": [ "" ]
}`;

/* ---------- chunk extraction (Claude reads every page) & synthesis prompts ---------- */
const CHUNK_EXTRACT_RULES = `אתה מקטלג ארכיוני בארכיון הקורא **חלק** מתיק (טווח דפים שיצוין). הקבצים הם סריקות אמיתיות מתקופת השואה — קרא בעיון. אלו לא כל דפי התיק. הסיכום ישמש אחר כך לסינתזת רשומת-תיק אחת.

⚠ זו **נקודת ביניים** — היה **טלגרפי**. סך הכול **עד ~500 מילים**. בלי משפטי רקע/ניתוח, בלי חזרות, בלי הקדמה/סיכום. רק עובדות, בשורות קצרות.

החזר טקסט קצר תחת הכותרות (דלג על כותרת שאין לה תוכן):
- **מסמכים** — שורה לכל מסמך/טווח-דפים: דפים · סוג (פרוטוקול/תעודה/מכתב/רשימה/שער…) · תאריך · שפה · תיאור ב-5-8 מילים.
- **שמות** — שורה לכל אדם (פעם אחת בלבד): שם + כתיב מקורי בסוגריים · קרבה/תפקיד · תאריכים · מקום · גורל · דף.
- **תאריכים/אירועים** — שורה לכל אחד: אירוע · תאריך · מקום.
- **יהלומים** — עדות/מכתב-ניצול/יומן/רשימת-נספים/תעודת-מחנה-גטו/זהות-בדויה — אם יש; אחרת "אין".

אסור לנחש. דף לא קריא → "[לא קריא: דף X]". ישר לעובדות.`;

const SYNTH_RULES = `אתה מקטלג ארכיוני בכיר בארכיון. לפניך סיכומי-טקסט שכתבת קודם אחרי שקראת את **כל דפי התיק** (מנה אחר מנה, לפי טווחי דפים). תפקידך עכשיו: לסנתז מהם **רשומת-תיק אחת** לפי נהלי ספיר — לאחד כפילויות, לזהות סתירות בין מנות, ולסמן ודאות. הסתמך על הסיכומים; אם משהו חסר/לא ברור סמן זאת.
${TIK_SCHEMA_RULES}

בנוסף לשדות הסכימה, החזר:
 "field_confidence": { "title":"✓", "related_places":"~", ... },
 "review_flags": [ {"field":"", "issue":"", "note":""} ]
היכן שהממצאים עקביים וברורים → "✓"; חלקיים/מבוסס מנה אחת → "~"; לא קריא/מוטל בספק → "?". רשום ב-review_flags כל סתירה בין מנות, דף לא-קריא, או פער שדורש בדיקת אנוש לפני הדבקה לספיר.

איחוד בין מנות לאינוונטר ולמפתח השמות: document_inventory — מזג את המסמכים מכל המנות והסדר אותם לפי טווחי הדפים לרצף אחד. names_index — אם אותו אדם הופיע בכמה מנות, מזג לשורה אחת ואחד את כל הדפים (source_pages); אל תיצור שורות כפולות לאותו אדם. timeline — מזג אירועים מכל המנות, הסר כפילויות וסדר כרונולוגית.`;

// Intermediate condensation for a LARGE tik: squeeze a batch of per-page-range
// notes into one tighter summary WITHOUT losing the structured facts the final
// synthesis needs. Lets a 300+ page tik reduce in stages so no single Claude
// synthesis call overruns its 15-min budget.
const REDUCE_RULES = `אתה מקטלג ארכיוני בארכיון. לפניך סיכומי-קריאה של **חלק מתיק** (כמה טווחי דפים רצופים). תפקידך: לעבות אותם לסיכום אחד תמציתי יותר — **בלי לאבד עובדות מהותיות**. שמור במפורש:
- **מסמכים** — שורה לכל מסמך/טווח-דפים: טווח הדפים · סוג · תאריך · שפה · תיאור קצר. אל תאחד מסמכים שונים לשורה אחת, ואל תשמיט טווחי דפים.
- **שמות** — כל אדם (פעם אחת), עם הכתיב המקורי, תפקיד/קרבה, תאריכים, מקום, גורל, והדפים שבהם הופיע.
- **תאריכים ואירועים מתוארכים**, **מקומות**, **שפות**.
- **יהלומים** — עדויות/מכתבי ניצולים/יומנים/רשימות נספים/תעודות מחנה-גטו/זהות בדויה.
- **נקודות לבדיקה** — דפים לא קריאים, סתירות, אי-ודאויות.
החזר **טקסט חופשי מובנה בלבד** (לא JSON). תמציתי אך שלם בעובדות — זו עדיין נקודת ביניים, לא הרשומה הסופית. אסור לנחש.`;

// Read an uploaded intake form (טופס איסוף) and pull the donor/archival info as
// structured Hebrew text. This is מידע מוקדם ABOUT the תיק — never evidence FROM it.
const INTAKE_EXTRACT_RULES = `לפניך סריקה/צילום של **טופס איסוף / דף מלווה** של תיק ארכיוני — מסמך שמילא מוסר החומר או הארכיון, ובו מידע מוקדם על התיק (לא חלק מהתיק עצמו). קרא אותו בעיון וחלץ את כל המידע הרלוונטי לקטלוג.

החזר **טקסט עברי קצר ומובנה** (לא JSON, לא טבלאות) עם הכותרות הרלוונטיות בלבד (דלג על מה שלא מופיע):
- **מוסר החומר** — שם, קשר לחומר (בעלים/שליח/יורש), פרטי קשר אם רשומים.
- **מקור / בעלים מקורי** — אם המוסר אינו הבעלים.
- **רקע משפחתי / ביוגרפי** — שמות, קרבה, גורל, ערים.
- **מקומות ותאריכים** — כפי שמצוינים בטופס.
- **תיאור התיק לפי המוסר** — מה לדבריו כולל התיק.
- **הערות ארכיוניות / סימול** — מספר נכנסות, סימול, הערות הארכיון.
- **הוראות / הגבלות** — מגבלות שימוש/סיווג שביקש המוסר.

זהו מידע מוקדם מהמוסר/מהטופס — לא ראיה מתוך התיק עצמו. אסור לנחש; אם שדה ריק או לא קריא — דלג עליו או ציין "לא קריא".`;

// Merge the form-derived text with any free-text notes into one מידע-מוקדם block,
// shared by stage-1 chunk reading and stage-2 synthesis.
function contextBlock(){
  const typed=$('context').value.trim();
  const intake=(state.intakeText||'').trim();
  const parts=[];
  if(intake)parts.push('### מתוך טופס האיסוף / דף מלווה (קריאת Claude)\n'+intake);
  if(typed)parts.push('### הערות נוספות שהוקלדו\n'+typed);
  return parts.length?`\n\n## מידע מוקדם / דף איסוף\n${parts.join('\n\n')}`:'\n\n## מידע מוקדם\n(אין)';
}
// Closed-vocabulary subject list (same one films.html uses). Loaded once; injected
// into the synthesis prompt so Claude picks subjects ONLY from this thesaurus.
state.thesaurus=[];
fetch('data/thesaurus_top300.json').then(r=>r.ok?r.json():[]).then(d=>{state.thesaurus=Array.isArray(d)?d:[];}).catch(()=>{});
function thesaurusBlock(){
  const t=state.thesaurus||[];
  if(!t.length)return '';
  return `\n\n## רשימת תזאורוס סגורה — בחר עד 10 נושאים **רק מכאן** (החזר ב-subjects_he ובמקביל subjects_en):\n`+t.map(x=>`${x.he} | ${x.en}`).join('\n');
}
function chunkArr(arr,size){const out=[];for(let i=0;i<arr.length;i+=size)out.push(arr.slice(i,i+size));return out;}

// Build the images[] payload for /api/ask-async — base64 each page. Images are
// downscaled client-side (saves bandwidth + keeps the request under the 25MB
// JSON limit); PDFs are sent as-is. The server materializes each to a temp file
// and tells Claude to Read it, giving Claude a real visual pass over the scans.
async function imagesForChunk(files){
  const imgs=[]; const grid=tilingGrid();
  for(const f of files){
    const mime=mimeOf(f);
    if(mime==='application/pdf'){imgs.push({mime,data:await fileToBase64(f)});}
    else if(grid){
      // Tiles in deterministic order: overview, then top→bottom, left→right.
      // Claude reads them in this order; chunkPrompt explains the scheme.
      for(const t of await tileImageB64(f,grid,imgMaxEdge(),0.85))imgs.push({mime:'image/jpeg',data:t.data});
    }
    else{imgs.push({mime:'image/jpeg',data:await downscaledB64(f)});}
  }
  return imgs;
}

/* ---------- Gemini engine (dual-mode stage 1: visual reading) ---------- */
// Build inline_data parts for a chunk. PDFs sent as-is; images downscaled.
async function geminiPartsFor(files){
  const parts=[]; const grid=tilingGrid();
  for(const f of files){
    const mime=mimeOf(f);
    if(mime==='application/pdf'){const b64=await fileToBase64(f);parts.push({inline_data:{mime_type:mime,data:b64}});}
    else if(grid){
      // Label each tile so Gemini knows where it sits on the page.
      for(const t of await tileImageB64(f,grid,imgMaxEdge(),0.85)){
        parts.push({text:t.label});
        parts.push({inline_data:{mime_type:'image/jpeg',data:t.data}});
      }
    }
    else{const b64=await downscaledB64(f);parts.push({inline_data:{mime_type:'image/jpeg',data:b64}});}
  }
  return parts;
}
// On localhost, route Gemini through the local proxy (same-origin, no CORS).
// Off localhost, call Google directly.
function geminiBase(){
  if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname))
    return location.origin+'/api/gemini-proxy/v1beta/models/';
  return 'https://generativelanguage.googleapis.com/v1beta/models/';
}
async function callGeminiOnParts(parts,promptText){
  const url=geminiBase()+$('model-gemini').value+':generateContent';
  let res;
  try{
    res=await fetch(url,{method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':state.keyGemini},
      body:JSON.stringify({contents:[{role:'user',parts:[...parts,{text:promptText}]}],
        generationConfig:{temperature:0,maxOutputTokens:8192}})});
  }catch(netErr){
    throw new Error('לא ניתן להגיע ל-Gemini ('+netErr.message+'). בדוק חיבור רשת/חסימה.');
  }
  if(!res.ok){
    const t=await res.text();
    const err=new Error('Gemini HTTP '+res.status+': '+t.slice(0,300));
    err.httpStatus=res.status;
    if(res.status===429){
      // Gemini's 429 body carries RetryInfo {retryDelay:"45s"} and a QuotaFailure
      // whose quotaId says PerMinute (waitable) vs PerDay (can't wait it out today).
      const md=t.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
      if(md)err.retryMs=Math.round(parseFloat(md[1])*1000);
      err.isDaily=/PerDay/i.test(t);
    }
    throw err;
  }
  const data=await res.json();
  // Free text (not JSON) — robust against truncation; Claude turns it into the record.
  return (data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'').trim();
}
// Retry on rate-limit (429 / RESOURCE_EXHAUSTED). Honour Gemini's own retryDelay
// from the 429 body (capped at 60s), falling back to an escalating backoff. A
// *daily* quota (RPD) can't be waited out — fail fast with a clear message rather
// than stalling through three useless waits.
async function callGeminiRetry(parts,promptText,onWait){
  const tries=5;
  for(let a=0;a<tries;a++){
    try{return await callGeminiOnParts(parts,promptText);}
    catch(e){
      const rate=e.httpStatus===429||/HTTP 429|RESOURCE_EXHAUSTED|quota|rate/i.test(e.message);
      if(rate&&e.isDaily)throw new Error('מכסת Gemini היומית (RPD) מוצתה — המתנה לא תעזור היום. עבור למנוע Claude, הפעל חיוב על מפתח Gemini, או נסה מחר.');
      if(rate&&a<tries-1){
        const wait=Math.min(60000,Math.max(e.retryMs||0,15000*(a+1)));
        if(onWait)onWait(wait);
        await new Promise(r=>setTimeout(r,wait));
        continue;
      }
      throw e;
    }
  }
}

/* ---------- Claude CLI engine (single engine: reads scans + synthesizes) ---------- */
// On localhost we talk to this same origin (localhost never changes). Off
// localhost (remote access) we use the tunnel URL the archivist pasted.
function serverBase(){
  // Canonical resolver with required:true (review 21.7 #21) — same strict
  // contract as before: no resolvable base ⇒ loud throw, never a silent ''.
  if(window.yvServerBase)return yvServerBase({ inputEl: $('server-url'), required: true });
  const v=$('server-url').value.trim().replace(/\/$/,'');
  if(v)return v;
  if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname))return location.origin;
  throw new Error('חסרה כתובת שרת מקומי / tunnel.');
}
const NET_HINT='ודא ששרת הבית רץ (node server.js), ובגישה מרחוק שגם המנהרה (cloudflared) רצה ושכתובת ה-tunnel מעודכנת — היא מתחלפת בכל הפעלה.';

// POST a job to /api/ask-async and poll until done. Async POST returns a jobId
// immediately so a long Claude run survives the Cloudflare quick-tunnel ~100s
// limit. `onTick(secs)` updates the status line. Returns the raw text.
async function runClaudeJob({prompt,images,onTick,model}){
  const base=serverBase();
  model=model||($('model-claude').value.includes('opus')?'opus':'sonnet');
  let res;
  try{
    res=await fetch(base+'/api/ask-async',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,model,images:images||[]})});
  }catch(netErr){throw new Error('לא ניתן להגיע לשרת המקומי ('+netErr.message+'). '+NET_HINT);}
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error('שרת HTTP '+res.status+': '+(e.error||'').slice(0,400));}
  const {jobId}=await res.json();
  if(!jobId)throw new Error('השרת לא החזיר jobId. ודא שגרסת השרת תומכת ב-/api/ask-async.');
  // Poll up to ~15 minutes (a big chunk of scans can take a while for Claude to Read).
  const started=Date.now(), maxMs=15*60*1000;
  while(Date.now()-started<maxMs){
    await new Promise(r=>setTimeout(r,3000));
    let pr;
    try{pr=await fetch(base+'/api/ask-async/'+jobId);}catch(e){continue;} // transient — keep polling
    if(!pr.ok){ if(window.yvAuthExpired&&yvAuthExpired(pr))return; continue; }
    const j=await pr.json();
    if(onTick)onTick(Math.round((Date.now()-started)/1000));
    if(j.status==='done')return (j.text||'').trim();
    if(j.status==='error')throw new Error('Claude נכשל: '+(j.error||'').slice(0,400));
  }
  throw new Error('הריצה נמשכה מעל 15 דקות ולא הסתיימה. צמצם את "דפים למנה" או את גודל התיק ונסה שוב.');
}

// Stage 1 — Claude READS one chunk of scans and returns free-text notes.
async function claudeReadChunk(files,promptText,onTick){
  const images=await imagesForChunk(files);
  // Stage-1 reads run on Sonnet — ~2x faster than Opus for the bulk vision pass;
  // the final synthesis keeps the user-selected model (Opus) for quality.
  return await runClaudeJob({prompt:promptText,images,onTick,model:'sonnet'});
}
// Stage 2 — Claude SYNTHESIZES the per-chunk notes into one JSON record (no images).
async function claudeSynthesize(promptText,onTick){
  const text=await runClaudeJob({prompt:promptText,images:[],onTick});
  return parseJson(text,'Claude');
}

// Pack consecutive items into batches each under maxChars (≥1 item/batch),
// preserving page order so condensed summaries stay sequential.
function packByChars(items,maxChars){
  const out=[];let cur=[],len=0;
  for(const it of items){
    if(cur.length&&len+it.length>maxChars){out.push(cur);cur=[];len=0;}
    cur.push(it);len+=it.length+2;
  }
  if(cur.length)out.push(cur);
  return out;
}

// Stage 2 (full) — synthesize per-chunk notes into ONE record. For a LARGE tik the
// combined notes overrun one Claude call's 15-min budget, so condense them in
// batches first (recursive map-reduce) and only then run the final JSON synthesis
// on the smaller input. A small tik skips straight to the final synthesis.
async function synthesizeTik(notes,onStage){
  const MAX=55000;                          // per-call input char budget (stays well under 15 min)
  let items=notes.map(n=>`### דפים ${n.range}\n${n.text}`);
  let round=0;
  while(items.join('\n\n').length>MAX&&items.length>1){
    round++;
    const batches=packByChars(items,MAX);
    const condensed=[];
    for(let b=0;b<batches.length;b++){
      const tag=`שלב 2א · עיבוי מנות התיק (סבב ${round}, חלק ${b+1}/${batches.length})`;
      onStage&&onStage(`<span class="spinner"></span>${tag}…`);
      const prompt=`${REDUCE_RULES}\n\n## סיכומי קריאה — חלק מהתיק (לפי טווחי דפים)\n${batches[b].join('\n\n')}\n\nהחזר סיכום מעובה אחד (טקסט חופשי, לא JSON).`;
      const txt=await runClaudeJob({prompt,images:[],model:'sonnet',onTick:s=>onStage&&onStage(`<span class="spinner"></span>${tag}… (${s} שׄ)`)});
      condensed.push(txt||'(אין)');
    }
    items=condensed;
  }
  const findingsText=items.join('\n\n');
  const synthPrompt=`${SYNTH_RULES}\n\n## הסיכומים שלך מכל מנות התיק (טקסט חופשי, לפי טווחי דפים)\n${findingsText}${contextBlock()}${thesaurusBlock()}\n\nהחזר JSON סופי בלבד.`;
  onStage&&onStage(`<span class="spinner"></span>שלב 2 · Claude מסנתז את רשומת התיק…`);
  return await claudeSynthesize(synthPrompt,s=>onStage&&onStage(`<span class="spinner"></span>שלב 2 · Claude מסנתז את רשומת התיק… (${s} שׄ)`));
}

/* ---------- render ---------- */
/* clone `el` minus rows whose .row-pick is UNCHECKED (read from the LIVE
   checkboxes — cloneNode copies the checked attribute, not the live property)
   and minus control cells/buttons. Every copy path goes through this. */
function copyCloneOf(el){
  const c=el.cloneNode(true);
  const live=[...el.querySelectorAll('.row-pick')];
  [...c.querySelectorAll('.row-pick')].forEach((cb,i)=>{
    if(live[i]&&!live[i].checked){const tr=cb.closest('tr');if(tr)tr.remove();}
  });
  c.querySelectorAll('th.rp,td.rp,th.act,td.act,button').forEach(x=>x.remove());
  return c;
}
/* innerText needs layout — attach the filtered clone off-screen briefly */
function copyTextOf(el){
  const c=copyCloneOf(el);
  c.style.cssText='position:absolute;left:-9999px;top:0;direction:rtl';
  document.body.appendChild(c);
  const t=c.innerText.trim();
  c.remove();
  return t;
}
function fieldBlock(label,id,html){
  // field-pick: the cataloger chooses which fields transfer to the catalog
  // page (default: ALL checked — uncheck to exclude). "העתק מסומנים" assembles
  // only the checked ones.
  return `<div class="field" data-field="${id}"><div class="head">`+
    `<input type="checkbox" class="field-pick" data-fid="${id}" checked title="כלול בהעברה לדף הקטלוג">`+
    `<span class="label">${esc(label)}</span>`+
    `<button class="copy-btn" data-copy="${id}">העתק</button></div>`+
    `<div class="body" id="${id}">${html}</div></div>`;
}
function conf(rec,key){const c=rec.field_confidence?.[key];return c?(' '+cmark(c)):'';}

/* ---------- testimony deep-describe (כפתור "תיאור מפורט") ---------- */
// "3-5" / "4,7" / "3-5, 9" → [3,4,5,9]. Bounded so a bad range can't explode.
function parsePagesSpec(s){
  const out=new Set();
  String(s||'').split(',').forEach(part=>{
    const m=part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if(m){const a=+m[1],b=Math.min(+m[2],a+400);for(let i=a;i<=b;i++)out.add(i);}
    else if(/^\d+$/.test(part.trim()))out.add(+part.trim());
  });
  return [...out].sort((x,y)=>x-y);
}
async function deepDescribeTestimony(btn){
  const pagesSpec=btn.getAttribute('data-pages')||'';
  const rowDesc=btn.getAttribute('data-desc')||'';
  const pages=parsePagesSpec(pagesSpec);
  // Evidence = the actual pages. Individual scans: page N ↔ the N-th uploaded
  // image (upload order). Single PDF ≤20MB: send whole, prompt scopes the pages.
  // No evidence available → honest refusal (a "deeper" pass without re-reading
  // the pages would be inflation, not description).
  const imgs=state.files.filter(f=>mimeOf(f)!=='application/pdf');
  const pdfs=state.files.filter(f=>mimeOf(f)==='application/pdf');
  let evidence=[];
  if(imgs.length&&pages.length){evidence=pages.map(p=>imgs[p-1]).filter(Boolean);}
  if(!evidence.length&&pdfs.length===1&&pdfs[0].size<=20*1024*1024)evidence=pdfs;
  if(!evidence.length){
    showStatus('לתיאור מפורט צריך את דפי המקור — העלה שוב את סריקות התיק (או PDF עד 20MB) ונסה שוב.','err');
    return;
  }
  const ctx=(state.lastRecord&&state.lastRecord.donor_notes)||'';
  const prompt=[
    'לפניך דפי עדות מתוך תיק ארכיוני (שואה, שנות ה-30–40). כתוב תיאור מפורט של העדות — לקטלוג, לא לתמלול מלא.',
    `הדפים המצורפים: ${pagesSpec||'כל המצורף'}. ${rowDesc?`תקציר קודם: ${rowDesc}`:''}`,
    ctx?`הקשר מהמוסר: ${ctx}`:'',
    '',
    'מבנה התשובה (עברית, פרוזה ארכיונית):',
    '1. העד/ה — מי מוסר/ת את העדות (שם כפי שכתוב, verbatim), ומה יחסו/ה לאירועים.',
    '2. תוכן העדות — מהלך הדברים כפי שמתואר: אירועים, תאריכים, אנשים שמוזכרים (שמות verbatim + עמוד).',
    '3. ציטוטי מפתח — 2-4 קטעים ראויים לציטוט, במקור + תרגום עברי.',
    '4. הערות — דפים קשים לקריאה, אי-בהירויות, מה דורש בירור.',
    '',
    'חוקים: אל תמציא דבר — רק מה שכתוב בדפים. שמות מקומות באנגלית בלבד (Riga, Warsaw). ',
    'לכל קביעה סמן ודאות V (בהירות הקריאה) ו-H (ודאות היסטורית): V✓/V~/V? H✓/H~/H?. ',
    'דף שאינו קריא — אמור זאת במפורש.'
  ].filter(Boolean).join('\n');
  const o=btn.textContent;btn.disabled=true;
  try{
    btn.textContent='⏳ קורא את הדפים…';
    const text=await claudeReadChunk(evidence,prompt,s=>{btn.textContent=`⏳ מתאר… (${s} שׄ)`;});
    if(!text||!text.trim())throw new Error('תשובה ריקה');
    const rec=state.lastRecord||{};
    (rec.deep_descriptions=rec.deep_descriptions||[]).push({
      pages:pagesSpec,text:text.trim(),
      html:esc(text.trim()).replace(/\n/g,'<br>')});
    renderRecord(rec,false); // re-render (persists via the refresh-survival path)
    showStatus(`✓ נוסף תיאור מפורט לעדות (דפים ${pagesSpec}) — מופיע אחרי האינוונטר, עם כפתור העתקה ותיבת-סימון משלו.`,'ok');
  }catch(e){
    showStatus('התיאור המפורט נכשל: '+(e.message||e),'err');
    btn.disabled=false;btn.textContent=o;
  }
}

function renderRecord(rec,restored){
  state.lastRecord=rec;
  const fc=rec.field_confidence||{};
  // review flags — points Claude marked as needing human verification before Sapir
  const dz=$('disagree-box'); dz.innerHTML='';
  if((rec.review_flags||[]).length){
    dz.innerHTML=`<div class="disagree"><h3>⚠ נקודות לבדיקת המקטלג לפני הדבקה לספיר</h3>`+
      rec.review_flags.map(d=>`<div class="d"><b>${esc(d.field)}</b><br>`+
        `${esc(d.issue)}`+
        (d.note?`<br><small>${esc(d.note)}</small>`:'')+`</div>`).join('')+`</div>`;
  }
  // additional info (assembled)
  let info='';
  (rec.additional_info_paragraphs||[]).forEach(p=>{
    const body=esc(p.body);
    if(p.contains_diamond) info+=`<div class="diamond">${p.heading?`<b>${esc(p.heading)}</b><br>`:''}${body}</div>`;
    else info+=`${p.heading?`<b>${esc(p.heading)}</b><br>`:''}${body}\n\n`;
  });
  if((rec.also_in_file||[]).length){
    info+=`<b>בתיק גם:</b>\n`+rec.also_in_file.map(x=>'• '+esc(x)).join('\n')+'\n\n';
  }
  const fallbackDonor=[(state.intakeText||'').trim(),$('context').value.trim()].filter(Boolean).join('\n\n');
  if(rec.donor_notes||fallbackDonor){
    const dn=rec.donor_notes||fallbackDonor;
    info+=`<b>הערות מוסר החומר:</b>\n${esc(dn)}`;
  }
  // diamonds summary
  const dia=(rec.diamonds||[]).length
    ? rec.diamonds.map(d=>`<div class="diamond"><b>${esc(d.type)}</b> — ${esc(d.description)}${d.location?` <small>(${esc(d.location)})</small>`:''}</div>`).join('')
    : '<span class="none">— לא זוהו יהלומים —</span>';
  // Page-number lists arrive comma-packed ("84,85,86,…") — no break points, so
  // long lists overflow the cell. Insert a space after each comma so the
  // browser wraps the numbers onto the next line naturally.
  const pgs=v=>v?esc(String(v)).replace(/,(?=\S)/g,', '):'—';
  // document inventory — the "map" of the תיק for navigation
  const inv=(rec.document_inventory||[]).filter(d=>d&&(d.doc_type||d.description||d.pages));
  // עדות → deep-describe button: a second, richer pass over THOSE pages only
  // (type_key is the engine's controlled-vocabulary key; the text match covers
  // records described before the vocabulary existed).
  const isTestimony=d=>d.type_key==='testimony'||/עדות|testimon/i.test(String(d.doc_type||''));
  // "עמוד בתיק" = continuous tik-wide sequence; "דפי מקור" = physical numbers
  // (restart across bundles). Column shown only when the engine stamped tik_pages.
  const hasTikPages=inv.some(d=>String(d.tik_pages||'').trim());
  const invHtml=inv.length
    ? `<table class="tbl"><thead><tr><th class="rp"></th>${hasTikPages?'<th>עמוד בתיק</th>':''}<th>דפי מקור</th><th>סוג</th><th>תאריך</th><th>שפות</th><th>תיאור</th><th class="act"></th></tr></thead><tbody>`+
        inv.map(d=>`<tr><td class="rp"><input type="checkbox" class="row-pick" checked title="כלול שורה זו בהעתקה ובדף-ההעתקה"></td>${hasTikPages?`<td>${pgs(d.tik_pages||'—')}</td>`:''}<td>${pgs(d.pages)}</td><td>${esc(d.doc_type||'—')}</td><td>${esc(d.date||'—')}</td><td>${esc(d.languages||'—')}</td><td>${esc(d.description||'')}</td>`+
          `<td class="act">${isTestimony(d)?`<button class="deep-btn" data-pages="${esc(String(d.pages||''))}" data-desc="${esc(String(d.description||d.doc_type||''))}">🔎 תיאור מפורט</button>`:''}</td></tr>`).join('')+
      `</tbody></table>`
    : '<span class="none">— לא נרשם אינוונטר —</span>';
  // deep descriptions from previous button runs ride the record (refresh-safe)
  const deepBlocks=(rec.deep_descriptions||[]).map((d,i)=>
    fieldBlock(`תיאור מפורט — עדות (דפים ${d.pages||'?'})`,`f-deep-${i}`,d.html||esc(d.text||''))).join('');
  // names index — feeds the Shoah Victims' Names DB. Split into three lists
  // (archivist decision): Jews & fate (the focus) · Germans/collaborators with
  // role+crimes+fate · additional people. Records with no category fall back to
  // the single legacy table.
  const nm=(rec.names_index||[]).filter(p=>p&&(p.name||p.name_original));
  const nameCell=p=>esc(p.name||'')+(p.name_original&&p.name_original!==p.name?` <span dir="auto" style="unicode-bidi:isolate;color:var(--muted)">(${esc(p.name_original)})</span>`:'')||'—';
  // rp = per-row pick (archivist request): every data row carries a checkbox —
  // an unchecked row is excluded from every copy and from the cataloger's
  // copy-sheet. Default: checked.
  const RP_TH='<th class="rp"></th>';
  const RP_TD='<td class="rp"><input type="checkbox" class="row-pick" checked title="כלול שורה זו בהעתקה ובדף-ההעתקה"></td>';
  const nmTable=(list,cols)=>`<table class="tbl"><thead><tr>${RP_TH}`+cols.map(c=>`<th>${c[0]}</th>`).join('')+
    `</tr></thead><tbody>`+list.map(p=>`<tr>${RP_TD}`+cols.map(c=>`<td>${c[1](p)}</td>`).join('')+`</tr>`).join('')+`</tbody></table>`;
  const COLS={
    jew:[['שם',nameCell],['לידה',p=>esc(p.birth||'—')],['פטירה',p=>esc(p.death||'—')],['מקום',p=>esc(p.place||'—')],['גורל',p=>esc(p.fate||'—')],['דפים',p=>pgs(p.source_pages)]],
    perpetrator:[['שם',nameCell],['תפקיד',p=>esc(p.role||'—')],['פשעים',p=>esc(p.crimes||'—')],['גורל',p=>esc(p.fate||'—')],['דפים',p=>pgs(p.source_pages)]],
    other:[['שם',nameCell],['תפקיד/קרבה',p=>esc(p.role||'—')],['מקום',p=>esc(p.place||'—')],['דפים',p=>pgs(p.source_pages)]]
  };
  const legacyCols=[['שם',nameCell],['תפקיד/קרבה',p=>esc(p.role||'—')],['לידה',p=>esc(p.birth||'—')],['פטירה',p=>esc(p.death||'—')],['מקום',p=>esc(p.place||'—')],['גורל',p=>esc(p.fate||'—')],['דפים',p=>pgs(p.source_pages)]];
  let nmHtml;
  if(!nm.length){ nmHtml='<span class="none">— לא זוהו שמות —</span>'; }
  else if(!nm.some(p=>(p.category||'').trim())){ nmHtml=nmTable(nm,legacyCols); }
  else{
    const SECT=[['jew','יהודים וגורלם / Jews & their fate'],['perpetrator','גרמנים ומשתפי פעולה / Germans & collaborators'],['other','אנשים נוספים / Additional people']];
    nmHtml=SECT.map(([k,title])=>{
      const g=nm.filter(p=>((p.category||'other').trim().toLowerCase()===k)||(k==='other'&&!['jew','perpetrator'].includes((p.category||'').trim().toLowerCase())));
      return g.length?`<div class="names-section"><div class="names-sub">${title} <span class="names-count">(${g.length})</span></div>${nmTable(g,COLS[k])}</div>`:'';
    }).join('');
  }
  // biographical timeline (chronological events)
  const tl=(rec.timeline||[]).filter(t=>t&&(t.event||t.date));
  const tlHtml=tl.length
    ? `<table class="tbl"><thead><tr>${RP_TH}<th>תאריך</th><th>אירוע</th><th>מקום</th><th>דפים</th></tr></thead><tbody>`+
        tl.map(t=>`<tr>${RP_TD}<td>${esc(t.date||'—')}${t.confidence?' '+cmark(t.confidence):''}</td><td>${esc(t.event||'')}</td><td>${esc(t.place||'—')}</td><td>${pgs(t.source_pages)}</td></tr>`).join('')+
      `</tbody></table>`
    : '<span class="none">— לא נבנה ציר זמן —</span>';
  // controlled-vocabulary subjects (thesaurus) as chips
  const sh=(rec.subjects_he||[]).filter(Boolean), sen=rec.subjects_en||[];
  const subjHtml=sh.length
    ? sh.map((he,i)=>`<span class="chip">${esc(he)}${sen[i]?` · ${esc(sen[i])}`:''}</span>`).join('')
    : '<span class="none">— לא נבחרו נושאים —</span>';
  const places=(rec.related_places||[]).filter(Boolean).join('; ')||'<span class="none">—</span>';
  const langs=(rec.languages||[]).filter(Boolean).join(', ')||'<span class="none">—</span>';
  const dAuth=`${esc(rec.date_authentic_start||'—')} – ${esc(rec.date_authentic_end||'—')}`;
  const dRec=`${esc(rec.date_reconstructed_start||'—')} – ${esc(rec.date_reconstructed_end||'—')}`;
  const nameType=rec.designate_name_typing
    ? `כן${rec.name_typing_reason?' — '+esc(rec.name_typing_reason):''}`
    : 'לא';
  const cls=`${esc(rec.classification||'בלתי מסווג')}${rec.classification_reason?' — '+esc(rec.classification_reason):''}`;

  $('record').innerHTML=
    `<div class="pick-bar">`+
      `<button class="btn" id="copy-picked" type="button">📋 העתק את השדות המסומנים</button>`+
      `<span class="pick-count" id="pick-count"></span>`+
      `<span style="flex:1"></span>`+
      `<button class="mini-btn" id="pick-all" type="button">סמן הכל</button>`+
      `<button class="mini-btn" id="pick-none" type="button">נקה הכל</button>`+
    `</div>`+
    `<div class="section-bar">דפית ראשית</div>`+
    fieldBlock('כותר'+conf(rec,'title'), 'f-title', esc(rec.title))+
    fieldBlock('מקומות קשורים', 'f-places', places)+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('תאריך אותנטי (תחילה–סיום)','f-dauth',dAuth)+
      fieldBlock('תאריך משוחזר (תחילה–סיום)','f-drec',dRec)+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('מקוריות','f-orig',esc(rec.originality||'—'))+
      fieldBlock('שפות','f-lang',langs)+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('שם יוצר החומר','f-cperson',esc(rec.creator_person||'—'))+
      fieldBlock('יוצר החומר (גוף)','f-corg',esc(rec.creator_org||'—'))+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('מיועד להקלדת שמות','f-nt',nameType)+
      fieldBlock('סיווג','f-cls',cls)+
    `</div>`+
    fieldBlock('הערת תוכן','f-cnote',esc(rec.content_note||'—'))+

    `<div class="section-bar">מידע נוסף</div>`+
    fieldBlock('מידע נוסף (להדבקה לספיר)','f-info',info.trim()||'<span class="none">—</span>')+

    `<div class="section-bar">יהלומים — מסמכים לרישום פרטני</div>`+
    `<div class="field"><div class="body">${dia}</div></div>`+

    `<div class="section-bar">אינוונטר מסמכים — מפת התיק</div>`+
    fieldBlock('אינוונטר מסמכים','f-inv',invHtml)+
    deepBlocks+

    `<div class="section-bar">מפתח שמות — להזנת מאגר שמות הקורבנות</div>`+
    fieldBlock('מפתח שמות','f-names',nmHtml)+

    `<div class="section-bar">ציר זמן ביוגרפי</div>`+
    fieldBlock('ציר זמן','f-timeline',tlHtml)+

    `<div class="section-bar">נושאים — תזאורוס</div>`+
    fieldBlock('נושאים','f-subjects',subjHtml);

  // bind copy
  document.querySelectorAll('.copy-btn[data-copy]').forEach(b=>{
    b.addEventListener('click',async()=>{
      const el=$(b.getAttribute('data-copy')); if(!el)return;
      const txt=copyTextOf(el); // honors per-row picks
      try{await navigator.clipboard.writeText(txt);}
      catch(e){const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);}
      const o=b.textContent;b.classList.add('copied');b.textContent='✓';
      $('toast').classList.add('show');
      setTimeout(()=>{b.classList.remove('copied');b.textContent=o;$('toast').classList.remove('show');},1100);
    });
  });
  // bind field selection (task: only checked fields transfer to the catalog page)
  const pickCount=()=>{
    const all=document.querySelectorAll('.field-pick'),on=document.querySelectorAll('.field-pick:checked');
    const c=$('pick-count');if(c)c.textContent=`${on.length}/${all.length} שדות מסומנים`;
  };
  document.querySelectorAll('.field-pick').forEach(cb=>{
    cb.addEventListener('change',()=>{
      cb.closest('.field').classList.toggle('unpicked',!cb.checked);pickCount();
    });
  });
  const setAll=v=>{document.querySelectorAll('.field-pick').forEach(cb=>{cb.checked=v;cb.closest('.field').classList.toggle('unpicked',!v);});pickCount();};
  $('pick-all')?.addEventListener('click',()=>setAll(true));
  $('pick-none')?.addEventListener('click',()=>setAll(false));
  $('copy-picked')?.addEventListener('click',async()=>{
    const parts=[];
    document.querySelectorAll('.field-pick:checked').forEach(cb=>{
      const f=cb.closest('.field'),lb=f.querySelector('.label'),bd=f.querySelector('.body');
      if(!bd)return;const t=copyTextOf(bd);if(!t||t==='—')return; // honors row picks
      parts.push(`## ${lb?lb.innerText.trim():''}\n${t}`);
    });
    if(!parts.length){showStatus('לא סומנו שדות להעתקה.','err');return;}
    const text=parts.join('\n\n');
    try{await navigator.clipboard.writeText(text);}
    catch(e){const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);}
    const b=$('copy-picked'),o=b.textContent;b.textContent=`✓ הועתקו ${parts.length} שדות`;
    setTimeout(()=>{b.textContent=o;},1600);
  });
  pickCount();
  // bind testimony deep-describe buttons
  document.querySelectorAll('.deep-btn').forEach(b=>{
    b.addEventListener('click',()=>deepDescribeTestimony(b));
  });
  // bind per-row picks — unchecked row dims and drops out of every copy path
  document.querySelectorAll('.row-pick').forEach(cb=>{
    cb.addEventListener('change',()=>{cb.closest('tr').classList.toggle('row-off',!cb.checked);});
  });
  $('results').classList.add('show');
  $('tik-export-bar').style.display='block';
  // open a fresh chat about this newly-cataloged תיק
  state.chatHistory=[];
  $('chat-log').innerHTML='';
  $('chat-panel').classList.add('show');
  // refresh-survival: a synthesized record is 15-40 min of model work, and the
  // record div has no [id] form fields, so yv-autosave never captures it —
  // persist it (with the chunk notes when they fit) so a refresh can restore.
  if(!restored){
    try{
      const payload={rec,savedAt:Date.now()};
      const notes=JSON.stringify(state.chunkNotes||[]);
      if(notes.length<1500000)payload.notes=state.chunkNotes||[];
      localStorage.setItem('yv_tik_last_record',JSON.stringify(payload));
      localStorage.removeItem('yv_tik_chat');
    }catch(e){
      try{localStorage.setItem('yv_tik_last_record',JSON.stringify({rec,savedAt:Date.now()}));}catch(e2){}
    }
  }
}

/* ---------- NotebookLM export — names · dates · context of this תיק record ---------- */
function buildTikNotebookLMExport(){
  const rec=state.lastRecord; if(!rec) return null;
  const strip=t=>String(t||'').replace(/<[^>]+>/g,'').trim();
  const L=[];
  L.push(`# רשומת תיק לייצוא ל-NotebookLM`);
  L.push(`נוצר ${new Date().toLocaleDateString('he-IL')}`);
  L.push('');
  L.push(`> רשומת תיק אחת שפוענחה (Claude קרא את כל דפי התיק). העלה כמקור ב-NotebookLM כדי לחפש שמות, תאריכים ומקומות ולהצליב מידע. השמות מופיעים בתוך "מידע נוסף".`);
  L.push('');
  const add=(label,val)=>{const v=strip(val);if(v)L.push(`- **${label}:** ${v}`);};
  add('כותר', rec.title);
  add('מקומות קשורים', (rec.related_places||[]).filter(Boolean).join('; '));
  add('תאריך אותנטי', [rec.date_authentic_start,rec.date_authentic_end].filter(Boolean).join(' – '));
  add('תאריך משוחזר', [rec.date_reconstructed_start,rec.date_reconstructed_end].filter(Boolean).join(' – '));
  add('שפות', (rec.languages||[]).filter(Boolean).join(', '));
  add('מקוריות', rec.originality);
  add('יוצר החומר (אדם)', rec.creator_person);
  add('יוצר החומר (גוף)', rec.creator_org);
  add('מיועד להקלדת שמות', rec.designate_name_typing?('כן'+(rec.name_typing_reason?' — '+rec.name_typing_reason:'')):'');
  add('סיווג', (rec.classification||'')+(rec.classification_reason?' — '+rec.classification_reason:''));
  add('הערת תוכן', rec.content_note);
  const infoParts=[];
  (rec.additional_info_paragraphs||[]).forEach(p=>{const b=strip(p.body); if(b)infoParts.push((p.heading?strip(p.heading)+': ':'')+b);});
  if((rec.also_in_file||[]).length) infoParts.push('בתיק גם: '+rec.also_in_file.map(strip).filter(Boolean).join('; '));
  if(rec.donor_notes) infoParts.push('הערות מוסר: '+strip(rec.donor_notes));
  if(infoParts.length){ L.push(''); L.push(`## מידע נוסף (כולל שמות)`); infoParts.forEach(t=>L.push(t)); }
  if((rec.diamonds||[]).length){ L.push(''); L.push(`## יהלומים — מסמכים לרישום פרטני`); rec.diamonds.forEach(d=>{const t=strip(d.type),de=strip(d.description); if(t||de)L.push(`- **${t}** — ${de}${d.location?' ('+strip(d.location)+')':''}`);}); }
  if((rec.document_inventory||[]).length){ L.push(''); L.push(`## אינוונטר מסמכים — מפת התיק`); rec.document_inventory.forEach(d=>{const pg=strip(d.pages),ty=strip(d.doc_type),de=strip(d.description),dt=strip(d.date),lg=strip(d.languages); if(ty||de)L.push(`- **${pg||'—'}** · ${ty}${dt?' · '+dt:''}${lg?' · '+lg:''}${de?' — '+de:''}`);}); }
  if((rec.names_index||[]).length){ L.push(''); L.push(`## מפתח שמות`); rec.names_index.forEach(p=>{const nm=strip(p.name),or=strip(p.name_original); if(!nm&&!or)return; const bits=[strip(p.role),[strip(p.birth),strip(p.death)].filter(Boolean).join('–'),strip(p.place),strip(p.fate),strip(p.source_pages)?'דפים '+strip(p.source_pages):''].filter(Boolean).join(' · '); L.push(`- **${nm}${or?' ('+or+')':''}**${bits?' — '+bits:''}`);}); }
  if((rec.timeline||[]).length){ L.push(''); L.push(`## ציר זמן ביוגרפי`); rec.timeline.forEach(t=>{const dt=strip(t.date),ev=strip(t.event); if(!dt&&!ev)return; L.push(`- **${dt||'—'}** — ${ev}${strip(t.place)?' ('+strip(t.place)+')':''}${strip(t.source_pages)?' [דפים '+strip(t.source_pages)+']':''}`);}); }
  if((rec.subjects_he||[]).filter(Boolean).length){ L.push(''); L.push(`## נושאים`); L.push(rec.subjects_he.map(s=>strip(s)).filter(Boolean).join(' · ')); }
  if((rec.review_flags||[]).length){ L.push(''); L.push(`## נקודות לבדיקת המקטלג`); rec.review_flags.forEach(d=>L.push(`- **${strip(d.field)}**: ${strip(d.issue)}${d.note?' — '+strip(d.note):''}`)); }
  return L.join('\n');
}
$('notebooklm-btn').addEventListener('click',()=>{
  const md=buildTikNotebookLMExport();
  if(!md){showStatus('אין רשומת תיק לייצוא','err');return;}
  const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const fname=`notebooklm_tik_${today}.md`;
  const blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fname;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showStatus(`✓ הורד ל-NotebookLM: ${fname}`,'ok');
});

/* ---------- דף-העתקה למקטלג — self-contained HTML hand-off ----------
   The cataloger has no access to this software: they receive ONE file that
   opens by double-click anywhere (no server, no login), with a copy button per
   field and a "✓ הוזן" tracker (localStorage). ONLY the checkbox-selected
   fields go in — the selection IS what transfers to the cataloging system.
   Same pattern as the photo-batch copysheet (local-server/build_copysheet.py). */
function buildTikCopySheet(){
  const rec=state.lastRecord; if(!rec) return null;
  const fields=[];
  document.querySelectorAll('#record .field[data-field]').forEach(f=>{
    const cb=f.querySelector('.field-pick'); if(cb&&!cb.checked) return;
    const lb=f.querySelector('.label'), bd=f.querySelector('.body');
    if(!lb||!bd) return;
    const txt=bd.innerText.trim(); if(!txt||txt==='—') return;
    // rows the archivist UNCHECKED stay out of the hand-off entirely; rows that
    // go in KEEP a live checkbox (the cataloger makes their own row selection in
    // the file — "וגם במסמך של המקטלג"). Action column/buttons are dead weight.
    const clone=bd.cloneNode(true);
    const live=[...bd.querySelectorAll('.row-pick')];
    [...clone.querySelectorAll('.row-pick')].forEach((cb,i)=>{
      if(live[i]&&!live[i].checked){const tr=cb.closest('tr');if(tr)tr.remove();}
      else cb.setAttribute('checked','');  // serialize as checked (property→attribute)
    });
    clone.querySelectorAll('th.act,td.act,button').forEach(el=>el.remove());
    fields.push({label:lb.innerText.trim(), html:clone.innerHTML, hasTable:!!clone.querySelector('table')});
  });
  if(!fields.length) return null;
  const title=String(rec.title||'רשומת תיק').replace(/<[^>]+>/g,'').trim();
  const stamp=new Date().toLocaleDateString('he-IL');
  const flags=(rec.review_flags||[]).map(d=>
    `<div class="flag"><b>${esc(d.field||'')}</b> — ${esc(d.issue||'')}${d.note?`<br><small>${esc(d.note)}</small>`:''}</div>`).join('');
  const secs=fields.map((f,i)=>
    `<section class="f" data-i="${i}"><header>`+
    `<input type="checkbox" class="done" title="סמן אחרי שהוזן למערכת הקטלוג">`+
    `<h3>${esc(f.label)}</h3>`+
    (f.hasTable?`<button type="button" class="c tsv" data-t="b${i}">📊 העתק כטבלה</button>`:'')+
    `<button type="button" class="c" data-t="b${i}">📋 העתק</button>`+
    `</header><div class="b" id="b${i}">${f.html}</div></section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>דף-העתקה — ${esc(title)}</title>
<style>
 body{font-family:'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right;background:#f5f6f8;color:#1a1a1a;margin:0;padding:18px;font-size:14px;line-height:1.55}
 .wrap{max-width:980px;margin:0 auto}
 h1{font-size:18px;border-bottom:3px solid #6a3fb5;padding-bottom:8px;margin:0 0 4px}
 .sub{color:#666;font-size:12px;margin-bottom:14px}
 .prog{position:sticky;top:0;background:#f5f6f8;padding:8px 0;font-size:13px;color:#444;z-index:5;border-bottom:1px solid #ddd;margin-bottom:10px}
 .flag{border:1px solid #e0b000;background:#fffbe6;border-radius:6px;padding:8px 12px;margin:0 0 8px;font-size:13px}
 section.f{background:#fff;border:1px solid #d9dce3;border-radius:8px;margin:0 0 12px;overflow:hidden}
 section.f.entered{opacity:.55;background:#eef7ee;border-color:#9fcfa4}
 section.f header{display:flex;align-items:center;gap:10px;background:#eef0f4;padding:7px 12px;border-bottom:1px solid #d9dce3}
 section.f.entered header{background:#dff0df}
 section.f h3{flex:1;margin:0;font-size:13.5px;color:#4a2f86}
 .done{width:16px;height:16px;accent-color:#1a7f4b;cursor:pointer}
 .c{background:#6a3fb5;color:#fff;border:none;border-radius:6px;padding:5px 13px;font-size:12.5px;cursor:pointer;font-family:inherit;font-weight:700}
 .c:hover{background:#7d55c7}.c.ok{background:#1a7f4b}
 .c.tsv{background:#2c5f7c}
 .b{padding:10px 14px;direction:rtl;text-align:right;unicode-bidi:isolate;white-space:pre-wrap}
 table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0;white-space:normal}
 th,td{border:1px solid #cbd5df;padding:4px 7px;text-align:right;vertical-align:top;unicode-bidi:isolate}
 th{background:#eef3f7;font-weight:700}
 .names-sub{font-weight:700;color:#4a2f86;margin:10px 0 4px;font-size:13.5px}
 .names-count{color:#888;font-weight:400;font-size:11.5px}
 .diamond{border:1px solid #d4b106;background:#fffbe6;border-radius:6px;padding:6px 10px;margin:6px 0}
 .chip{display:inline-block;background:#eef0f4;border:1px solid #d9dce3;border-radius:999px;padding:1px 10px;margin:2px;font-size:12px}
 .none{color:#999}.dm-tikpage{color:#888;font-size:11px}
 small{color:#777}
 th.rp,td.rp{width:26px;text-align:center;padding:4px}
 .row-pick{accent-color:#6a3fb5;width:14px;height:14px;cursor:pointer;margin:0}
 tr.row-off td{opacity:.35}tr.row-off td.rp{opacity:1}
 @media print{.c,.done,.prog,th.rp,td.rp{display:none!important}section.f{break-inside:avoid}}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1>
<div class="sub">דף-העתקה למערכת הקטלוג · הופק ${esc(stamp)} · ${fields.length} שדות · לחץ 📋 ליד שדה, הדבק במערכת, וסמן ✓ משהוזן</div>
<div class="prog" id="prog"></div>
${flags?`<div class="flags"><b style="font-size:13px">⚠ נקודות לבדיקה לפני הזנה:</b>${flags}</div>`:''}
${secs}
</div><script>
var KEY='yv_cs_'+${JSON.stringify(title.slice(0,60)+'_'+stamp)};
/* clone minus unchecked rows + pick cells — every copy honors the row picks */
function rowClone(el){var c=el.cloneNode(true);var live=el.querySelectorAll('.row-pick');
  var cl=c.querySelectorAll('.row-pick');
  for(var i=cl.length-1;i>=0;i--){if(live[i]&&!live[i].checked){var tr=cl[i].closest('tr');if(tr)tr.remove();}}
  c.querySelectorAll('th.rp,td.rp').forEach(function(x){x.remove();});return c;}
function textOf(el){var c=rowClone(el);c.style.cssText='position:absolute;left:-9999px;direction:rtl';
  document.body.appendChild(c);var t=c.innerText.trim();c.remove();return t;}
function tsvOf(el){var out=[];rowClone(el).querySelectorAll('table').forEach(function(tb){
  var sec=tb.closest('.names-section');var t=sec&&sec.querySelector('.names-sub');
  if(t)out.push(t.textContent.trim());
  tb.querySelectorAll('tr').forEach(function(tr){out.push([].map.call(tr.querySelectorAll('th,td'),function(c){return c.innerText.replace(/\\s+/g,' ').trim();}).join('\\t'));});
  out.push('');});return out.join('\\n').trim();}
function put(txt,btn){function ok(){var o=btn.textContent;btn.classList.add('ok');btn.textContent='✓ הועתק';setTimeout(function(){btn.classList.remove('ok');btn.textContent=o;},1200);}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(ok,function(){fb();});}else fb();
  function fb(){var t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);ok();}}
document.querySelectorAll('.c').forEach(function(b){b.addEventListener('click',function(){
  var el=document.getElementById(b.getAttribute('data-t'));if(!el)return;
  put(b.classList.contains('tsv')?tsvOf(el):textOf(el),b);});});
document.querySelectorAll('.row-pick').forEach(function(cb){cb.addEventListener('change',function(){
  cb.closest('tr').classList.toggle('row-off',!cb.checked);});});
var done=[];try{done=JSON.parse(localStorage.getItem(KEY)||'[]');}catch(e){}
function prog(){var n=document.querySelectorAll('.done:checked').length,t=document.querySelectorAll('.done').length;
  document.getElementById('prog').textContent='הוזנו '+n+' מתוך '+t+' שדות'+(n===t?' — הכל הוזן ✓':'');}
document.querySelectorAll('section.f').forEach(function(s,i){var cb=s.querySelector('.done');
  if(done.indexOf(i)>-1){cb.checked=true;s.classList.add('entered');}
  cb.addEventListener('change',function(){s.classList.toggle('entered',cb.checked);
    var d=[];document.querySelectorAll('section.f').forEach(function(x,j){if(x.querySelector('.done').checked)d.push(j);});
    try{localStorage.setItem(KEY,JSON.stringify(d));}catch(e){}prog();});});
prog();
</${'script'}></body></html>`;
}
$('copysheet-btn').addEventListener('click',()=>{
  const html=buildTikCopySheet();
  if(!html){showStatus('אין רשומה, או שלא נשארו שדות מסומנים — סמן שדות ונסה שוב.','err');return;}
  const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const stem=String((state.lastRecord&&state.lastRecord.title)||'tik').replace(/<[^>]+>/g,'').replace(/[\\/:*?"<>|]/g,'').trim().slice(0,40).replace(/\s+/g,'_')||'tik';
  downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),`copysheet_tik_${stem}_${today}.html`);
  const n=document.querySelectorAll('.field-pick:checked').length;
  showStatus(`✓ הורד דף-העתקה עם השדות המסומנים (${n}) — שלח את הקובץ למקטלג; נפתח בדאבל-קליק בכל דפדפן.`,'ok');
});

/* ---------- catalog downloads: Excel · PDF · archival interchange ---------- */
function downloadBlob(blob,fname){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fname;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function tikStem(){
  const t=(state.lastRecord&&state.lastRecord.title||'תיק').replace(/<[^>]+>/g,'').trim().replace(/[\\/:*?"<>|]+/g,'_').slice(0,50);
  return `tik_${t||'record'}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
}
// Client-side CSV fallback (UTF-8 BOM → opens in Excel) when the server xlsx
// endpoint isn't reachable (e.g. viewing on the static Pages surface).
function recordToCsv(rec){
  const q=v=>{const s=String(v==null?'':v).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const L=[];const sec=(title,head,rows)=>{L.push(q(title));if(head)L.push(head.map(q).join(','));rows.forEach(r=>L.push(r.map(q).join(',')));L.push('');};
  const j=(a,s)=>(a||[]).map(x=>String(x==null?'':x).replace(/<[^>]+>/g,'').trim()).filter(Boolean).join(s||', ');
  sec('רשומה',['שדה','ערך'],[
    ['כותר',rec.title],['מקומות קשורים',j(rec.related_places,'; ')],
    ['תאריך אותנטי',[rec.date_authentic_start,rec.date_authentic_end].filter(Boolean).join(' – ')],
    ['שפות',j(rec.languages)],['סיווג',rec.classification||''],['הערת תוכן',rec.content_note||''],
  ]);
  sec('מפת התיק',['דפים','סוג','תאריך','שפות','תיאור'],(rec.document_inventory||[]).map(d=>[d.pages,d.doc_type,d.date,d.languages,d.description]));
  sec('מפתח שמות',['שם','כתיב מקורי','סיווג','תפקיד','פשעים','לידה','פטירה','מקום','גורל','דפים'],(rec.names_index||[]).map(p=>[p.name,p.name_original,({jew:'יהודי/ה',perpetrator:'גרמני/משתף-פעולה',other:'אחר'}[(p.category||'').trim().toLowerCase()]||''),p.role,p.crimes,p.birth,p.death,p.place,p.fate,p.source_pages]));
  sec('ציר זמן',['תאריך','אירוע','מקום','דפים','ודאות'],(rec.timeline||[]).map(t=>[t.date,t.event,t.place,t.source_pages,t.confidence]));
  return '﻿'+L.join('\n');
}
$('export-xlsx-btn').addEventListener('click',async()=>{
  const rec=state.lastRecord; if(!rec){showStatus('אין רשומה לייצוא','err');return;}
  const stem=tikStem();
  showStatus('<span class="spinner"></span>בונה קובץ Excel…','info');
  try{
    const r=await fetch(serverBase()+'/api/export-xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record:rec,filename:stem})});
    if(!r.ok){let e={};try{e=await r.json();}catch{}throw new Error(e.error||('שרת HTTP '+r.status));}
    downloadBlob(await r.blob(),stem+'.xlsx');
    showStatus(`✓ הורד Excel: ${stem}.xlsx`,'ok');
  }catch(err){
    // No server (e.g. Pages) or endpoint down → CSV fallback that opens in Excel.
    downloadBlob(new Blob([recordToCsv(rec)],{type:'text/csv;charset=utf-8'}),stem+'.csv');
    showStatus(`✓ הורד כ-CSV (נפתח ב-Excel): ${stem}.csv · (שרת Excel לא זמין: ${esc(err.message)})`,'ok');
  }
});
$('export-pdf-btn').addEventListener('click',()=>{
  const rec=state.lastRecord; if(!rec){showStatus('אין רשומה לייצוא','err');return;}
  // Print the rendered record via a dedicated RTL print window → user picks
  // "Save as PDF". Most reliable, RTL-perfect, zero-lib, works on every surface.
  const body=$('record').innerHTML;
  const flags=$('disagree-box').innerHTML;
  const w=window.open('','_blank');
  if(!w){showStatus('הדפדפן חסם את חלון ההדפסה — אשר חלונות קופצים ונסה שוב','err');return;}
  w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc((rec.title||'תיק').replace(/<[^>]+>/g,''))}</title>
<style>@page{size:A4;margin:14mm}body{font-family:'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right;color:#1a1a1a;font-size:12px;line-height:1.5}
h1{font-size:16px;border-bottom:2px solid #2c5f7c;padding-bottom:6px}
.section-bar{background:#2c5f7c;color:#fff;padding:4px 10px;margin:14px 0 8px;font-weight:700;border-radius:4px;font-size:12.5px}
.field{margin:6px 0}.field .label,.label{font-weight:700;color:#2c5f7c;font-size:11px}
.copy-btn,.pick-bar,.field-pick,.deep-btn{display:none!important}
table.tbl{width:100%;border-collapse:collapse;font-size:10.5px;margin:4px 0}
table.tbl th,table.tbl td{border:1px solid #cbd5df;padding:3px 6px;text-align:right;vertical-align:top;overflow-wrap:anywhere}
table.tbl th{background:#eef3f7}
.chip{display:inline-block;background:#eef3f7;border-radius:10px;padding:1px 8px;margin:2px;font-size:10.5px}
.disagree{border:1px solid #e0b000;background:#fffbe6;padding:8px 12px;border-radius:6px;margin-bottom:10px}
.diamond{border-inline-start:3px solid #b8860b;padding-inline-start:8px;margin:4px 0}
.none{color:#8a97a3}</style></head><body>
<h1>${esc((rec.title||'רשומת תיק').replace(/<[^>]+>/g,''))}</h1>${flags}${body}
<p style="margin-top:16px;color:#8a97a3;font-size:10px">הופק ממערכת הקטלוג · ${new Date().toLocaleString('he-IL')}</p>
</body></html>`);
  w.document.close();
  setTimeout(()=>{w.focus();w.print();},350);
  showStatus('✓ נפתח חלון הדפסה — בחר "שמור כ-PDF"','ok');
});
$('export-arch-btn').addEventListener('click',async()=>{
  const rec=state.lastRecord; if(!rec){showStatus('אין רשומה לייצוא','err');return;}
  if(!state.outputName){showStatus('ייצוא ארכיוני זמין רק לתיק שקוטלג בהרצה זו (נדרש קובץ הפלט בשרת) — הרץ תיאור מהיר ונסה שוב','err');return;}
  const fmt=$('export-arch-fmt').value;
  showStatus(`<span class="spinner"></span>מייצא לפורמט ${fmt}…`,'info');
  try{
    const r=await fetch(serverBase()+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:state.outputName,format:fmt})});
    const jr=await r.json();
    if(!r.ok||!jr.ok)throw new Error(jr.error||('שרת HTTP '+r.status));
    // The server wrote output/<...>.<fmt>.{xml,csv}; download it.
    const dl=await fetch(serverBase()+'/api/output/'+encodeURIComponent(jr.outputName));
    if(!dl.ok)throw new Error('הקובץ נוצר אך ההורדה נכשלה ('+dl.status+')');
    downloadBlob(await dl.blob(),jr.outputName);
    showStatus(`✓ הורד ייצוא ארכיוני: ${jr.outputName}`,'ok');
  }catch(err){showStatus('ייצוא ארכיוני נכשל: '+esc(err.message),'err');}
});

/* ---------- chat about the תיק (grounded in what Claude already read) ---------- */
// Context = the per-chunk reading notes (Claude's full pass over every page) +
// the synthesized record. No images are re-sent; the chat reasons over text only.
function chatContext(){
  const notes=(state.chunkNotes||[]).map(n=>`### דפים ${n.range}\n${n.text}`).join('\n\n');
  const record=buildTikNotebookLMExport()||'';
  return `## סיכומי קריאה של כל דפי התיק (לפי טווחי דפים)\n${notes||'(אין)'}\n\n## רשומת התיק המסונתזת\n${record}`;
}
function appendMsg(role,text){
  const log=$('chat-log');
  const d=document.createElement('div');
  d.className='msg '+(role==='user'?'user':'bot');
  d.textContent=text;
  log.appendChild(d); log.scrollTop=log.scrollHeight;
  return d;
}
async function sendChat(){
  const input=$('chat-input'); const q=input.value.trim(); if(!q)return;
  try{serverBase();}catch(e){appendMsg('bot','⚠ '+e.message);return;}
  input.value=''; $('chat-send').disabled=true;
  appendMsg('user',q);
  state.chatHistory=state.chatHistory||[];
  const thinking=appendMsg('bot','…');
  const history=state.chatHistory.map(m=>`${m.role==='user'?'מקטלג':'Claude'}: ${m.text}`).join('\n\n');
  const prompt=`אתה עוזר מחקר ארכיוני בארכיון. עיינת בתיק ארכיוני שלם וכעת אתה עונה על שאלות המקטלג לגביו.
ענה אך ורק על סמך תוכן התיק שלהלן. אם מידע אינו מופיע בתיק או שדף לא היה קריא — אמור זאת במפורש; אל תמציא ואל תוסיף ידע חיצוני כעובדה. ענה בעברית, תמציתי וברור. כשרלוונטי, ציין באילו דפים/מנה נמצא המידע.

${chatContext()}${history?`\n\n## השיחה עד כה\n${history}`:''}

## שאלת המקטלג
${q}

## תשובתך`;
  try{
    const ans=await runClaudeJob({prompt,images:[]});
    thinking.textContent=ans||'(אין תשובה)';
    state.chatHistory.push({role:'user',text:q},{role:'bot',text:ans});
    try{localStorage.setItem('yv_tik_chat',JSON.stringify(state.chatHistory));}catch(e){}
  }catch(err){
    thinking.textContent='⚠ שגיאה: '+err.message;
  }finally{$('chat-send').disabled=false; input.focus();}
}
$('chat-send').addEventListener('click',sendChat);
$('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendChat();}});

/* ---------- refresh-survival: restore the last synthesized תיק record ---------- */
(function(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem('yv_tik_last_record')||'null');}catch(e){}
  if(!saved||!saved.rec)return;
  const bar=document.createElement('div');
  bar.style.cssText='background:color-mix(in srgb, var(--warn) 12%, var(--card));border:1px solid color-mix(in srgb, var(--warn) 40%, transparent);border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:13.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--ink)';
  const when=new Date(saved.savedAt||Date.now()).toLocaleString('he-IL');
  const sp=document.createElement('span');
  sp.innerHTML='💾 נמצאה רשומת-תיק מריצה קודמת <b>('+esc(when)+')</b> — הרשומה אינה נשמרת בשרת; שחזר כדי להמשיך לעבוד עליה.';
  bar.appendChild(sp);
  const mk=(t,primary)=>{const b=document.createElement('button');b.type='button';b.textContent=t;
    b.style.cssText='border-radius:6px;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:13px;border:1px solid '+(primary?'var(--accent);background:var(--accent);color:#150a22':'var(--line-strong);background:var(--card);color:var(--muted)');return b;};
  const rb=mk('שחזר את הרשומה',true), xb=mk('מחק',false);
  rb.addEventListener('click',()=>{
    if(Array.isArray(saved.notes))state.chunkNotes=saved.notes; // re-grounds the chat
    renderRecord(saved.rec,true);
    let chat=null;try{chat=JSON.parse(localStorage.getItem('yv_tik_chat')||'null');}catch(e){}
    if(Array.isArray(chat)&&chat.length){state.chatHistory=chat;chat.forEach(m=>appendMsg(m.role==='user'?'user':'bot',m.text));}
    bar.remove();
    $('results').scrollIntoView({behavior:'smooth'});
  });
  xb.addEventListener('click',()=>{try{localStorage.removeItem('yv_tik_last_record');localStorage.removeItem('yv_tik_chat');}catch(e){}bar.remove();});
  bar.appendChild(rb);bar.appendChild(xb);
  const anchor=$('results');
  anchor.parentNode.insertBefore(bar,anchor);
})();

/* ---------- combined PDF of all uploaded image pages (self-contained, no libs) ---------- */
// Decode one image file, downscale to a sane edge, and return baseline JPEG bytes
// + pixel dimensions. Re-encoding to JPEG keeps every page in one color space
// (DeviceRGB) and keeps the merged PDF small enough for big תיקים (156+ scans).
async function pdfPageFor(file,edge=2000,quality=0.85){
  // NOTE: benchmarked 2026-07-12 — createImageBitmap(+toBlob) is ~6x SLOWER
  // than Image+toDataURL in this Chromium for large scans. Keep the simple
  // decode path; the speedup for big tiks comes from the caller running
  // pdfPageFor in a small concurrency pool (overlapping file reads, which
  // dominate on cloud-mounted scans).
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('טעינת תמונה נכשלה'));im.src=url;});
    const scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    cv.getContext('2d').drawImage(img,0,0,w,h);
    const b64=cv.toDataURL('image/jpeg',quality).split(',')[1];
    const bin=atob(b64);const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return {bytes,width:w,height:h};
  }finally{URL.revokeObjectURL(url);}
}
// Assemble a minimal valid PDF: one page per image, each JPEG embedded as a
// DCTDecode XObject so no re-compression happens on the PDF side. Objects:
// 1=Catalog, 2=Pages, then 3 objects per page (page, content, image xobject).
function buildImagesPdf(pages){
  const enc=s=>{const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i)&0xff;return a;};
  const parts=[];let offset=0;const offsets=[];
  const push=chunk=>{const u=typeof chunk==='string'?enc(chunk):chunk;parts.push(u);offset+=u.length;};
  const mark=n=>{offsets[n]=offset;};
  const N=pages.length;
  const kids=[];for(let i=0;i<N;i++)kids.push((3+i*3)+' 0 R');
  push('%PDF-1.3\n%\xff\xff\xff\xff\n');
  mark(1);push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  mark(2);push('2 0 obj\n<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+N+' >>\nendobj\n');
  for(let i=0;i<N;i++){
    const p=pages[i],pageN=3+i*3,contentN=pageN+1,imgN=pageN+2,W=p.width,H=p.height;
    mark(pageN);
    push(pageN+' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+']'+
         ' /Resources << /XObject << /Im0 '+imgN+' 0 R >> >> /Contents '+contentN+' 0 R >>\nendobj\n');
    const content='q '+W+' 0 0 '+H+' 0 0 cm /Im0 Do Q';
    mark(contentN);
    push(contentN+' 0 obj\n<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream\nendobj\n');
    mark(imgN);
    push(imgN+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+W+' /Height '+H+
         ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+p.bytes.length+' >>\nstream\n');
    push(p.bytes);push('\nendstream\nendobj\n');
  }
  const xrefStart=offset,total=2+N*3;
  push('xref\n0 '+(total+1)+'\n0000000000 65535 f \n');
  for(let n=1;n<=total;n++)push(String(offsets[n]||0).padStart(10,'0')+' 00000 n \n');
  push('trailer\n<< /Size '+(total+1)+' /Root 1 0 R >>\nstartxref\n'+xrefStart+'\n%%EOF');
  let len=0;parts.forEach(p=>len+=p.length);
  const out=new Uint8Array(len);let o=0;parts.forEach(p=>{out.set(p,o);o+=p.length;});
  return out;
}
function triggerDownload(blob,fname){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fname;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
// When the תיק is made of image scans (not a single PDF), merge them into one
// PDF alongside the cataloging. Runs in parallel with the analysis; failures are
// surfaced in the PDF bar only and never abort the catalog run.
function tikPdfKey(){return state.files.map(f=>f.name+':'+f.size).join('|');}
function pdfBarDone(msg){
  const bar=$('pdf-bar');bar.style.display='block';bar.innerHTML=msg+' ';
  const b=document.createElement('button');b.className='copy-btn';b.style.background='var(--films)';b.style.color='#fff';b.textContent='⬇ הורד שוב';
  b.addEventListener('click',()=>triggerDownload(state.pdfBlob,state.pdfName));
  bar.appendChild(b);
}
// Merge the loaded image scans into ONE full-quality PDF. Cached per file set,
// so a catalog run and the download button never build the same PDF twice.
async function buildCombinedPdf(){
  const imgs=state.files.filter(f=>mimeOf(f)!=='application/pdf');
  if(!imgs.length)return null;
  const key=tikPdfKey();
  if(state.pdfBlob&&state.pdfKey===key)return state.pdfBlob;
  const bar=$('pdf-bar');bar.style.display='block';
  bar.textContent='⏳ בונה PDF מאוחד מ-'+imgs.length+' תמונות…';
  // Pool of 4: overlaps file reads (the dominant cost on cloud-mounted scans).
  // Full-quality pages are heavier than the describe path, so keep the pool small.
  const pages=new Array(imgs.length);
  let built=0;
  const POOL=Math.min(4,imgs.length);
  await Promise.all(Array.from({length:POOL},async(_,k)=>{
    for(let i=k;i<imgs.length;i+=POOL){
      pages[i]=await pdfPageFor(imgs[i]);
      bar.textContent='⏳ בונה PDF מאוחד… '+(++built)+'/'+imgs.length;
    }
  }));
  const tikName=((imgs[0].webkitRelativePath||'').split('/')[0]||'תיק').replace(/[\\/:*?"<>|]+/g,'_');
  const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
  state.pdfBlob=new Blob([buildImagesPdf(pages)],{type:'application/pdf'});
  state.pdfName=tikName+'_'+today+'.pdf';
  state.pdfKey=key;
  return state.pdfBlob;
}
async function maybeBuildCombinedPdf(){
  const imgs=state.files.filter(f=>mimeOf(f)!=='application/pdf');
  if(!imgs.length)return;
  try{
    await buildCombinedPdf();
    triggerDownload(state.pdfBlob,state.pdfName);
    pdfBarDone('✓ PDF מאוחד מוכן ('+imgs.length+' עמ׳) — '+esc(state.pdfName));
  }catch(e){const bar=$('pdf-bar');bar.style.display='block';bar.innerHTML='⚠ בניית ה-PDF המאוחד נכשלה: '+esc(e.message);}
}
// ⬇ הורד את התיק כ-PDF — on-demand download of the whole תיק as one PDF file,
// without running any cataloging: a single uploaded PDF is downloaded as-is;
// image scans are merged client-side (same builder the catalog run uses).
$('download-tik-pdf').addEventListener('click',async()=>{
  if(!state.files.length){showStatus('העלה תיק (PDF או סריקות) קודם.','err');return;}
  const btn=$('download-tik-pdf'),bar=$('pdf-bar');
  const pdfs=state.files.filter(f=>mimeOf(f)==='application/pdf');
  const imgs=state.files.filter(f=>mimeOf(f)!=='application/pdf');
  if(pdfs.length===1&&!imgs.length){ // התיק כבר קובץ PDF אחד — מורידים כמו שהוא
    triggerDownload(pdfs[0],pdfs[0].name||'tik.pdf');
    bar.style.display='block';bar.innerHTML='✓ הורד: '+esc(pdfs[0].name||'tik.pdf');
    return;
  }
  if(!imgs.length){
    bar.style.display='block';
    bar.innerHTML='⚠ התיק מכיל כמה קובצי PDF — איחוד קובצי PDF אינו נתמך בדפדפן. העלה את דפי התיק כסריקות תמונה, או אחד את ה-PDF-ים בכלי חיצוני.';
    return;
  }
  btn.disabled=true;
  try{
    await buildCombinedPdf();
    triggerDownload(state.pdfBlob,state.pdfName);
    const skip=pdfs.length?' · ⚠ '+pdfs.length+' קובצי PDF שבתיק לא נכללו':'';
    pdfBarDone('✓ ה-PDF של התיק ירד ('+imgs.length+' עמ׳) — '+esc(state.pdfName)+skip);
  }catch(e){bar.style.display='block';bar.innerHTML='⚠ בניית ה-PDF נכשלה: '+esc(e.message);}
  finally{btn.disabled=!state.files.length;}
});

/* ---------- run (chunked: Claude reads every page, then synthesizes one record) ---------- */
// Returns true when a record was produced, false otherwise — the folder queue
// relies on this to decide done/failed per tik.
async function catalogTik(){
  if(!state.files.length){showStatus('העלה תיק (PDF או סריקות).','err');return false;}
  try{serverBase();}catch(e){showStatus(esc(e.message),'err');return false;}
  const engine=$('engine-mode').value;  // 'claude' | 'dual'
  if(engine==='dual'){
    // When the server manages the Gemini key (owner), the proxy injects it and
    // overrides x-goog-api-key — the browser never needs a key. Use the sentinel
    // instead of the (intentionally hidden, empty) input so the gate never blocks.
    state.keyGemini=window.YV_GEMINI_MANAGED?'server-managed':$('key-gemini').value.trim();
    if(!state.keyGemini){showStatus('מצב דו-מנועי דורש מפתח Gemini (הקריאה הויזואלית של הדפים).','err');return false;}
  }
  const reader=engine==='dual'?'Gemini':'Claude';
  // Tiling explodes each page into many tiles → force one page per chunk so a
  // single request stays within the model's image-count / 25MB limits.
  const chunkSize=tilingGrid()?1:Math.max(1,parseInt($('chunk-size').value,10)||8);
  const chunks=chunkArr(state.files,chunkSize);
  $('run').disabled=true;
  // In parallel with cataloging: if the תיק is image scans, merge them into one PDF.
  maybeBuildCombinedPdf();
  try{
    // Stage 0 — if a טופס איסוף was uploaded, read it FIRST so its donor/archival
    // info feeds into every stage as מידע מוקדם (not as evidence from the תיק).
    state.intakeText='';
    if(state.intakeFiles.length){
      showStatus('<span class="spinner"></span>קורא את טופס האיסוף / הדף המלווה…','info');
      try{state.intakeText=await claudeReadChunk(state.intakeFiles,INTAKE_EXTRACT_RULES);}
      catch(e){showStatus('⚠ קריאת טופס האיסוף נכשלה ('+esc(e.message)+') — ממשיך בלי המידע מהטופס.','info');}
    }
    // Stage 1 — the chosen reader reads every chunk (full coverage) → free-text notes.
    // Precompute each chunk's page-range label up front so chunks can be read in
    // any order (Claude mode reads several at once; see the bounded pool below).
    const meta=chunks.map((c,i)=>{
      const from=chunks.slice(0,i).reduce((n,cc)=>n+cc.length,0)+1;
      const to=from+c.length-1;
      // A PDF is ONE uploaded file but contains MANY pages — don't label it "page 1–1".
      const hasPdf=c.some(f=>mimeOf(f)==='application/pdf');
      const range=hasPdf?`מסמך PDF מלא (קובץ ${from}${c.length>1?`–${to}`:''})`:`${from}–${to}`;
      return {from,to,hasPdf,range};
    });
    const notes=new Array(chunks.length); const failed=[];
    function chunkPrompt(i){
      const m=meta[i];
      const coverage = m.hasPdf
        ? (engine==='dual'
            ? `\n\n🛑 המצורף הוא מסמך PDF שלם המכיל **דפים רבים** (לא דף בודד). קרא את **כל הדפים** מהראשון עד האחרון — לא רק את דף השער/המנהלה. סכם את תוכן כל הדפים וציין כמה דפים יש במסמך. אל תעצור אחרי הדף הראשון.`
            : `\n\n🛑 המצורף הוא מסמך PDF שלם המכיל **דפים רבים** (לא דף בודד). עליך לקרוא את **כל הדפים** במסמך — מהראשון עד האחרון — ולא רק את דף השער/דף המנהלה הראשון. כלי ה-Read על PDF ארוך עשוי לדרוש קריאה בטווחי דפים (למשל pages:"1-10", אחר כך pages:"11-20" וכן הלאה) — חזור על הקריאה עד שכיסית את כל הדפים. בסיכום ציין כמה דפים סך הכול יש במסמך ואילו סוגי דפים מופיעים לאורכו. אל תעצור אחרי הדף הראשון.`)
        : `\n\n(טווח דפים: ${m.range} מתוך ${state.files.length})`;
      const g=tilingGrid();
      const tilingNote = (g&&!m.hasPdf)
        ? `\n\n🔍 **התמונות המצורפות הן אריחים חופפים של עמוד יחיד** (לא עמודים נפרדים): קודם תמונת **סקירה** של העמוד המלא, ואחריה ${g*g} אריחים ברזולוציה גבוהה בסדר קריאה — משורה עליונה לתחתונה, ומימין לשמאל בכל שורה. כל אריח מתויג במיקומו הפיזי.\n- **השתמש בתמונת הסקירה כדי להבין את מבנה העמוד** (טופס? טבלה? טקסט חופשי?), ובאריחים כדי לקרוא את הפרטים הדקים.\n- **אם זה טופס/טבלה — שמר את שיוך תווית-השדה לערך שלצדה** (אל תהפוך אותו לרשימה שטוחה שמנתקת ערכים מהתוויות).\n- האריחים חופפים בקצוות, לכן טקסט שמופיע בשני אריחים = אותו טקסט (אל תכפיל).\n- כשאות/מילה אינה ודאית — הצע את הקריאה הסבירה ביותר וסמן ב-"?", ואל תמציא.\n⚠ אריחים מועילים לכתב יד צפוף, אך דורשים מודל קורא חזק — מומלץ לבחור Gemini Pro או Claude Opus כשמפעילים אריחים.`
        : '';
      return `${CHUNK_EXTRACT_RULES}${coverage}${tilingNote}${contextBlock()}`;
    }
    // Don't abort a long run over one bad chunk — record it and keep going.
    function recordFailure(i,err){
      failed.push(meta[i].range);
      notes[i]={range:meta[i].range,text:`⚠ מנה זו נכשלה בקריאה (${err.message}). דרושה קריאה חוזרת ידנית של דפים ${meta[i].range}.`};
    }

    if(engine==='dual'){
      // Gemini free tier is rate-limited (5 RPM) → read sequentially with pacing.
      for(let i=0;i<chunks.length;i++){
        const m=meta[i];
        showStatus(`<span class="spinner"></span>שלב 1 · Gemini קורא ${m.hasPdf?'את כל דפי ה-PDF':`דפים ${m.range} מתוך ${state.files.length}`} (מנה ${i+1}/${chunks.length})…`,'info');
        try{
          const parts=await geminiPartsFor(chunks[i]);
          const txt=await callGeminiRetry(parts,chunkPrompt(i),wait=>showStatus(`<span class="spinner"></span>שלב 1 · מגבלת קצב של Gemini (${m.range}) — ממתין ${wait/1000} שׄ ומנסה שוב…`,'info'));
          notes[i]={range:m.range,text:txt||'(אין טקסט)'};
        }catch(err){recordFailure(i,err);}
        if(i<chunks.length-1)await new Promise(r=>setTimeout(r,4000)); // pace Gemini RPM (free tier ~5–15 RPM); retryDelay handles any overflow
      }
    }else{
      // Claude mode: chunks are independent, and the server spawns one CLI process
      // per job with no lock — so read several at once. Bounded to stay within the
      // Claude subscription's limits and the machine's resources.
      const CONCURRENCY=3;
      let started=0, completed=0;
      const tick=()=>showStatus(`<span class="spinner"></span>שלב 1 · Claude קורא ${chunks.length} מנות במקביל (${completed}/${chunks.length} הושלמו, עד ${CONCURRENCY} בו-זמנית)…`,'info');
      tick();
      async function worker(){
        while(started<chunks.length){
          const i=started++;
          try{
            const txt=await claudeReadChunk(chunks[i],chunkPrompt(i));
            notes[i]={range:meta[i].range,text:txt||'(אין טקסט)'};
          }catch(err){recordFailure(i,err);}
          completed++; tick();
        }
      }
      await Promise.all(Array.from({length:Math.min(CONCURRENCY,chunks.length)},worker));
    }
    if(failed.length===chunks.length)throw new Error(`כל המנות נכשלו בקריאת ${reader}. `+(engine==='dual'?'בדוק מפתח/מודל/מכסת Gemini.':NET_HINT));

    // Stage 2 — synthesize all chunk notes into ONE record. synthesizeTik condenses
    // the notes in batches first when the tik is large (recursive map-reduce), so a
    // big tik never overruns one Claude call's 15-min budget. Small tiks go direct.
    showStatus(`<span class="spinner"></span>שלב 2 · Claude מסנתז ${chunks.length} מנות לרשומת-תיק אחת…`,'info');
    const final=await synthesizeTik(notes,h=>showStatus(h,'info'));
    state.chunkNotes=notes;  // grounding context for the תיק chat
    renderRecord(final);
    const warn=failed.length?` ⚠ ${failed.length} מנות נכשלו (דפים ${failed.join(', ')}) — דרושה קריאה חוזרת ידנית.`:'';
    showStatus(`✓ הקטלוג הושלם — נקראו ${state.files.length} הדפים ב-${chunks.length} מנות.${warn} בדוק את נקודות הבדיקה והיהלומים לפני הדבקה לספיר.`,failed.length?'info':'ok');
    $('results').scrollIntoView({behavior:'smooth'});
    return true;
  }catch(err){
    console.error(err);
    showStatus('שגיאה: '+esc(err.message)+(err.rawText?'\n\n=== תגובה גולמית ===\n'+esc(err.rawText.slice(0,1200)):''),'err');
    return false;
  }finally{$('run').disabled=false;}
}
// With pending queue items the button runs the whole queue (tik after tik);
// otherwise it catalogs the currently loaded files, exactly as before.
$('run').addEventListener('click',()=>{
  if(state.queueRunning)return;
  if(state.queue.some(q=>q.status==='pending'))runQueue('catalog');else catalogTik();
});

/* ---------- ⚡ fast description: ONE whole-PDF Gemini call (no page-by-page) ---------- */
// Returns true when a record was produced, false otherwise (queue relies on this).
async function fastDescribe(){
  if(!state.files.length){showStatus('העלה תיק (PDF או סריקות) קודם.','err');return false;}
  try{serverBase();}catch(e){showStatus(esc(e.message),'err');return false;}
  $('run').disabled=true;$('describe-fast').disabled=true;
  try{
    // One PDF for the whole tik. For image scans, build a DOWNSIZED PDF (~1100px):
    // a description doesn't need full-res, and the full-res merge can blow past the
    // Cloudflare tunnel's ~100MB request cap (HTTP 413). ~1100px keeps 400 scans well
    // under the limit and readable enough for a tik-level description.
    let blob=null,name='tik.pdf';
    const imgs=state.files.filter(f=>mimeOf(f)!=='application/pdf');
    if(state.files.length===1&&mimeOf(state.files[0])==='application/pdf'){
      blob=state.files[0];name=state.files[0].name||'tik.pdf';   // single uploaded PDF — as-is
    }else if(imgs.length){
      // Concurrency pool: overlap file reads (slow on cloud-mounted scans) with
      // decode/encode. Order is preserved via index assignment. Pool of 4 keeps
      // memory bounded (~4 decoded bitmaps at 1100px) and the UI responsive.
      const pages=new Array(imgs.length);
      let built=0;
      const POOL=Math.min(4,imgs.length);
      await Promise.all(Array.from({length:POOL},async(_,k)=>{
        for(let i=k;i<imgs.length;i+=POOL){
          pages[i]=await pdfPageFor(imgs[i],1100,0.55);
          showStatus(`<span class="spinner"></span>תיאור מהיר · בונה PDF מוקטן לתיאור… ${++built}/${imgs.length}`,'info');
        }
      }));
      blob=new Blob([buildImagesPdf(pages)],{type:'application/pdf'});name='tik_describe.pdf';
    }
    if(!blob){showStatus('צריך PDF יחיד או סריקות תמונה.','err');return false;}
    const mb=(blob.size/1024/1024).toFixed(1);
    if(blob.size>1900*1024*1024){showStatus(`⚠ ה-PDF ${mb}MB — מעל תקרת 2GB של Gemini Files API. פצל את התיק לשני חלקים.`,'err');return false;}
    // Gemini→Claude collaboration: the server has Gemini read every page and extract
    // facts, then Claude (the historian) synthesizes the record from those facts. This
    // prompt is Claude's synthesis brief; the server appends Gemini's extracted facts.
    const prompt=`${TIK_SCHEMA_RULES}\n\n⚠ Gemini כבר קרא את **כל דפי התיק** וחילץ עובדות גולמיות (יצורפו בהמשך ההודעה). תפקידך כהיסטוריון ארכיוני: לסנתז מהן **רשומת-תיק אחת ברמת תיאור** — מפת המסמכים, היקף, מקומות ותקופה, אנשים מרכזיים, ויהלומים — עם **הקשר היסטורי מעמיק ומדויק**. עגן כל קביעה בעובדות בלבד (אל תמציא), והבחן בבירור בין מה שמתועד בתיק לבין ידע היסטורי כללי. החזר field_confidence (✓/~/?) לכל שדה, ו-review_flags לכל הסקה/אי-ודאות/פער שדורש אימות ארכיונאי. **לא** תמלול דף-דף ולא רשימת כל שם בכל דף.${contextBlock()}${thesaurusBlock()}\n\nהחזר JSON סופי בלבד.`;
    // shared non-file fields — the finalize of a chunked upload sends them without the blob.
    // context is written server-side as the standard <pdf>.context.txt sidecar.
    const fields={prompt,context:[$('context').value.trim(),(state.intakeText||'').trim()].filter(Boolean).join('\n\n')};
    if(window.yvFlow)fields.reader=yvFlow.current('documents-tik');   // אוטומטי / Claude / Gemini
    if(window.yvFlow&&yvFlow.backend)fields.backend=yvFlow.backend('documents-tik');   // Claude: מנוי / API
    const t=Date.now();
    // XHR (not fetch) so the archivist sees upload progress — a big tik through the
    // Cloudflare tunnel uploads at ~0.5MB/s, and a silent spinner reads as a hang.
    const xhrPost=(url,body,onPct)=>new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST',url);
      xhr.upload.onprogress=ev=>{if(ev.lengthComputable&&onPct)onPct(ev.loaded,ev.total);};
      xhr.onload=()=>resolve(xhr);
      xhr.onerror=()=>reject(new Error('network'));
      xhr.onabort=()=>reject(new Error('ההעלאה בוטלה'));
      xhr.send(body);
    });
    const CHUNK=32*1024*1024;   // each part safely under Cloudflare's ~100MB request cap
    let post;
    if(blob.size<=60*1024*1024){
      // small tik — ONE request, as always
      const fd=new FormData();fd.append('file',blob,name);for(const k in fields)fd.append(k,fields[k]);
      showStatus(`<span class="spinner"></span>תיאור מהיר · מעלה את התיק לשרת (${mb}MB)…`,'info');
      let pct=0;
      try{
        post=await xhrPost(serverBase()+'/api/tik-describe',fd,(l,tt)=>{pct=Math.round(l/tt*100);showStatus(`<span class="spinner"></span>תיאור מהיר · מעלה את התיק לשרת… ${pct}% מתוך ${mb}MB`,'info');});
      }catch(e){  // fetch-wrap doesn't see XHR — log the api-fail ourselves
        if(window.__yvLog)__yvLog.push({type:'api-fail',url:serverBase()+'/api/tik-describe',text:`upload died at ${pct}% of ${mb}MB`});
        throw new Error(`העלאה נכשלה אחרי ${Math.round((Date.now()-t)/1000)} שניות (נעצרה ב-${pct}% מתוך ${mb}MB) — החיבור לשרת נותק באמצע. נסה שוב; אם זה חוזר, בדוק שהשרת רץ.`);
      }
    }else{
      // big tik — sliced to ≤32MB parts (each under the Cloudflare cap), assembled server-side
      const uploadId=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)+'-'+Math.random().toString(36).slice(2,10));
      const total=Math.ceil(blob.size/CHUNK);
      for(let i=0;i<total;i++){
        const part=blob.slice(i*CHUNK,Math.min((i+1)*CHUNK,blob.size));
        let sent=false,lastErr=null;
        for(let a=0;a<3&&!sent;a++){   // a network blip retries ONE chunk, not the whole tik
          try{
            const cfd=new FormData();cfd.append('uploadId',uploadId);cfd.append('index',String(i));cfd.append('total',String(total));cfd.append('name',name);cfd.append('chunk',part,'part');
            const r=await xhrPost(serverBase()+'/api/upload-chunk',cfd,l=>{const done=Math.min(Math.round((i*CHUNK+l)/blob.size*100),100);showStatus(`<span class="spinner"></span>תיאור מהיר · מעלה נתח ${i+1}/${total}… ${done}% מתוך ${mb}MB`,'info');});
            if(r.status>=200&&r.status<300){sent=true;break;}
            let er={};try{er=JSON.parse(r.responseText);}catch{}
            lastErr=new Error(er.error||('שרת HTTP '+r.status));
          }catch(e){lastErr=e;}
          await new Promise(rr=>setTimeout(rr,2500*(a+1)));
        }
        if(!sent){
          if(window.__yvLog)__yvLog.push({type:'api-fail',url:serverBase()+'/api/upload-chunk',text:`chunk ${i+1}/${total} failed: ${lastErr&&lastErr.message}`});
          throw new Error(`העלאת נתח ${i+1}/${total} נכשלה אחרי 3 ניסיונות (${lastErr&&lastErr.message}) — בדוק את החיבור ונסה שוב.`);
        }
      }
      showStatus(`<span class="spinner"></span>תיאור מהיר · כל ${total} הנתחים הועלו — השרת מרכיב את התיק…`,'info');
      const ffd=new FormData();ffd.append('uploadId',uploadId);for(const k in fields)ffd.append(k,fields[k]);
      post=await xhrPost(serverBase()+'/api/tik-describe',ffd);
    }
    if(post.status<200||post.status>=300){let e={};try{e=JSON.parse(post.responseText);}catch{}throw new Error(e.error||('שרת HTTP '+post.status));}
    let jr={};try{jr=JSON.parse(post.responseText);}catch{}
    const {jobId}=jr;
    if(!jobId)throw new Error('השרת לא החזיר jobId (ודא שגרסת השרת החדשה רצה).');
    // Poll until the SERVER resolves the job (done/error). The server self-resolves
    // via its own watchdogs (idle-based engine kill + bounded model calls), so we
    // keep waiting as long as the job shows PROGRESS: the 90-min window slides —
    // it resets whenever a new engine event arrives, and only a genuinely silent
    // stretch aborts (a huge tik legitimately runs hours). Each poll is a quick
    // GET, so the Cloudflare ~100s limit never bites.
    let started=Date.now(),lastEvCount=0;const maxMs=90*60*1000;
    if(window.yvProgress)yvProgress.begin({screen:'documents-tik',kind:'tik'});
    while(Date.now()-started<maxMs){
      await new Promise(r=>setTimeout(r,3000));
      let pr;try{pr=await fetch(serverBase()+'/api/tik-describe/'+jobId);}catch(e){continue;}
      if(!pr.ok){ if(window.yvAuthExpired&&yvAuthExpired(pr))return; continue; }
      const j=await pr.json();
      const evs=Array.isArray(j.events)?j.events:[];
      if(evs.length>lastEvCount){lastEvCount=evs.length;started=Date.now();}   // progress → slide the deadline
      if(window.yvProgress)yvProgress.pump({status:j.status==='done'?'done':(j.status==='error'?'error':'running'),events:evs,progressPct:j.progressPct});
      // Live line: what the engine checks RIGHT NOW + which model + real elapsed.
      const lastEv=evs.length?String(evs[evs.length-1].text||'').trim():'';
      const mdl=j.progressModel?` · מודל: ${esc(j.progressModel)}`:'';
      const pctTxt=(typeof j.progressPct==='number')?` · ${j.progressPct}%`:'';
      showStatus(`<span class="spinner"></span>תיאור מהיר${mdl}${pctTxt} · ${lastEv?esc(lastEv):'המנוע התחיל…'} (${Math.round((Date.now()-t)/1000)} שׄ)`,'info');
      if(j.status==='done'){
        state.outputName=j.outputName||null;   // enables archival export (server sidecar)
        renderRecord(parseJson(j.text,'Claude'));
        const split=(j.geminiSec&&j.claudeSec)?`Gemini ${j.geminiSec}שׄ + Claude ${j.claudeSec}שׄ`:(j.model||'Gemini+Claude');
        showStatus(`✓ תיאור הושלם תוך ${j.elapsedSec||Math.round((Date.now()-t)/1000)} שׄ (${split}). בדוק את נקודות הבדיקה ו-review_flags לפני הדבקה לספיר.`,'ok');
        $('results').scrollIntoView({behavior:'smooth'});
        return true;
      }
      if(j.status==='error'){
        if(j.prohibited){showStatus('⚠ Gemini סירב לקרוא את התיק (חומר רגיש). עבור למצב "Claude בלבד" והרץ "קטלג תיק".','err');return false;}
        throw new Error(j.error||'תיאור נכשל');
      }
    }
    throw new Error('לא התקבלה שום התקדמות מהשרת במשך 90 דקות — ייתכן שהשרת נתקע או שהחיבור נותק. בדוק את מסך ההפעלות (logs.html) לפני ניסיון חוזר.');
  }catch(err){console.error(err);showStatus('שגיאה בתיאור מהיר: '+esc(err.message),'err');}
  finally{$('run').disabled=false;$('describe-fast').disabled=false;}
  return false;
}
$('describe-fast').addEventListener('click',()=>{
  if(state.queueRunning)return;
  if(state.queue.some(q=>q.status==='pending'))runQueue('fast');else fastDescribe();
});

/* ---------- engine-mode toggle: reveal Gemini fields only in dual mode ---------- */
function syncEngineUI(){
  const dual=$('engine-mode').value==='dual';
  const managed=!!window.YV_GEMINI_MANAGED;
  // In dual mode show the key field ONLY when the server does not manage the key.
  $('gemini-key-wrap').style.display=(dual&&!managed)?'block':'none';
  const gm=$('gemini-managed-note');if(gm)gm.style.display=(dual&&managed)?'block':'none';
  $('model-gemini-wrap').style.display=dual?'block':'none';
}
$('engine-mode').addEventListener('change',syncEngineUI);
syncEngineUI();

/* ---------- persist settings locally ---------- */
const PERSIST=['engine-mode','key-gemini','model-gemini','model-claude','server-url','chunk-size','img-edge','tiling'];
const STORE_KEY='yv-tik-settings';
function setSaveState(msg,color){const el=$('save-state');if(el){el.textContent=msg;el.style.color=color||'var(--good)';}}
function loadSettings(){
  let s={};
  try{s=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
    PERSIST.forEach(id=>{if(s[id]!=null&&$(id)&&$(id).value!==s[id])$(id).value=s[id];});}catch(e){}
  // Auto-config the server URL: the dashboard is always served BY the server it
  // must call (localhost during dev, films.mf-sr.com via the tunnel), so the page
  // origin IS the correct server URL — and same-origin keeps the Cloudflare Access
  // cookie attached. Fill it when empty, or repair a stale saved value (old
  // trycloudflare URLs change every run and break "from any computer").
  if(/^https?:$/.test(location.protocol)&&!/\.(pages\.dev|github\.io)$/.test(location.hostname)&&$('server-url')){
    const cur=$('server-url').value.trim();
    if(!cur||/trycloudflare\.com/.test(cur))$('server-url').value=location.origin;
  }
  syncEngineUI();
  setSaveState('🔒 הגדרות נטענו מהמכשיר','var(--good)');
}
function saveSettings(){
  try{const s={};PERSIST.forEach(id=>{if($(id))s[id]=$(id).value;});
    localStorage.setItem(STORE_KEY,JSON.stringify(s));
    setSaveState('🔒 נשמר במכשיר זה','var(--good)');}catch(e){setSaveState('⚠ לא ניתן לשמור (אחסון חסום בדפדפן)','var(--error)');}
}
PERSIST.forEach(id=>{const el=$(id);if(el){el.addEventListener('change',saveSettings);el.addEventListener('input',saveSettings);el.addEventListener('blur',saveSettings);}});
loadSettings();
window.addEventListener('pageshow',loadSettings);

/* ---------- file handling ---------- */
function renderFiles(){
  const n=state.files.length;
  const g=tilingGrid();
  const cs=g?1:Math.max(1,parseInt($('chunk-size').value,10)||8);
  const tnote=g?` · אריחים ${g}×${g} (${g*g} אריחים + סקירה לכל עמוד)`:'';
  const note=n?`<div class="f" style="font-weight:600">📁 ${n} דפים — ייקראו במלואם ב-${Math.ceil(n/cs)} מנות${tnote}</div>`:'';
  const rows=state.files.slice(0,60).map(f=>
    `<div class="f"><span>${esc(f.name)}</span><span>${(f.size/1024/1024).toFixed(1)}MB</span></div>`).join('');
  const more=n>60?`<div class="f"><span>… ועוד ${n-60}</span><span></span></div>`:'';
  $('filelist').innerHTML=note+rows+more;
  syncRunButtons();
  $('download-tik-pdf').disabled=!n;
}
// Run buttons work when there are loaded files OR pending queue items; both are
// locked while the queue is running (the queue loop drives the runs itself).
function syncRunButtons(){
  const runnable=state.files.length||state.queue.some(q=>q.status==='pending');
  $('run').disabled=state.queueRunning||!runnable;
  $('describe-fast').disabled=state.queueRunning||!runnable;
}
function addFiles(list){
  const files=Array.from(list)
    .filter(f=>/\.(pdf|jpe?g|png|tiff?|webp)$/i.test(f.name))
    .sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,undefined,{numeric:true}));
  state.files=[...state.files,...files];renderFiles();
}
const drop=$('drop');
$('file-input').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
$('folder-input').addEventListener('change',e=>{
  if(!e.target.files.length){alert('לא נבחרו קבצים.');return;}
  enqueueFolderSelection(e.target.files);e.target.value='';
});
$('clear-files').addEventListener('click',()=>{state.files=[];renderFiles();});
$('chunk-size').addEventListener('change',renderFiles);
$('tiling').addEventListener('change',renderFiles);
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');addFiles(e.dataTransfer.files);});

/* ---------- folder queue: many tiks, processed one after another ---------- */
// Mirrors the CLI semantics (yv doc describe <folder>): each first-level
// subfolder = one tik; ≥2 root-level PDFs = one tik per PDF; root-level scans
// = one tik. A plain folder of scans keeps the classic single-tik flow.
function tikGroupsOf(list){
  const files=Array.from(list)
    .filter(f=>/\.(pdf|jpe?g|png|tiff?|webp)$/i.test(f.name))
    .sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,undefined,{numeric:true}));
  const subs=new Map(),rootImgs=[],rootPdfs=[];
  for(const f of files){
    const parts=String(f.webkitRelativePath||f.name).split('/');
    if(parts.length>=3){const k=parts[1];if(!subs.has(k))subs.set(k,[]);subs.get(k).push(f);}
    else (/\.pdf$/i.test(f.name)?rootPdfs:rootImgs).push(f);
  }
  const groups=[...subs.entries()].map(([name,fs])=>({name,files:fs}));
  if(rootPdfs.length>=2||(rootPdfs.length===1&&groups.length))
    groups.push(...rootPdfs.map(p=>({name:p.name.replace(/\.pdf$/i,''),files:[p]})));
  else rootImgs.push(...rootPdfs);   // a single root PDF with no subfolders stays part of the root tik
  if(rootImgs.length){
    const rootName=String((files[0]&&files[0].webkitRelativePath)||'').split('/')[0]||'התיקייה';
    groups.push({name:groups.length?rootName+' — דפים בשורש':rootName,files:rootImgs});
  }
  groups.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  return groups;
}
function enqueueFolderSelection(list){
  const groups=tikGroupsOf(list);
  if(!groups.length){alert('לא נמצאו קבצים נתמכים (PDF / JPG / PNG / TIFF / WEBP).');return;}
  if(groups.length===1&&!state.queue.length){addFiles(groups[0].files);return;}   // classic single-tik flow
  groups.forEach(g=>state.queue.push({name:g.name,files:g.files,status:'pending'}));
  renderQueue();
  showStatus(`נוספו ${groups.length} תיקים לתור (${state.queue.length} סה״כ) — לחץ «⚡ תיאור מהיר» או «קטלג תיק» כדי להריץ את התור, תיק אחרי תיק.`,'ok');
}
function renderQueue(){
  const panel=$('tik-queue-panel');
  if(!state.queue.length){panel.style.display='none';syncRunButtons();return;}
  panel.style.display='block';
  const c={pending:0,running:0,done:0,error:0};state.queue.forEach(q=>c[q.status]=(c[q.status]||0)+1);
  $('tik-queue-summary').textContent=`${state.queue.length} תיקים · ${c.done||0} הושלמו`+(c.error?` · ${c.error} נכשלו`:'')+((c.pending&&!state.queueRunning)?` · ${c.pending} ממתינים`:'')+(state.queueRunning?' · התור רץ…':'');
  $('tik-queue-retry').style.display=(c.error&&!state.queueRunning)?'':'none';
  let base='';try{base=serverBase();}catch(e){}
  const icon=q=>q.status==='running'?'<span class="spinner"></span>'
    :q.status==='done'?'<span style="color:var(--good)">✓</span>'
    :q.status==='error'?'<span style="color:var(--error)">✗</span>':'⏳';
  $('tik-queue-list').innerHTML=state.queue.map((q,i)=>{
    const mb=(q.files.reduce((s,f)=>s+f.size,0)/1024/1024).toFixed(1);
    const what=(q.files.length===1&&/\.pdf$/i.test(q.files[0].name))?'PDF':`${q.files.length} דפים`;
    const acts=[];
    if(q.status==='done'&&q.rec)acts.push(`<button type="button" class="copy-btn" data-show="${i}" style="padding:2px 9px;font-size:11.5px" title="הצגת רשומת התיק הזה במסך (הרשומות של שאר התיקים נשארות שמורות בתור)">הצג</button>`);
    if(q.status==='done'&&q.outputName&&base)acts.push(`<a href="${base}/api/output/${encodeURIComponent(q.outputName)}" style="font-size:11.5px" title="הורדת קובץ הרשומה שנשמר בשרת">⬇ קובץ</a>`);
    if(q.status==='pending')acts.push(`<button type="button" class="copy-btn" data-del="${i}" style="padding:2px 9px;font-size:11.5px;background:var(--error);color:#fff" title="הסרה מהתור">✕</button>`);
    const err=q.status==='error'?` <span style="color:var(--error);font-size:11px" title="${esc(q.error||'')}">— ${esc(String(q.error||'נכשל').slice(0,90))}</span>`:'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px dashed color-mix(in srgb, var(--muted) 30%, transparent);font-size:12.5px;flex-wrap:wrap">
      <span style="width:18px;text-align:center;flex:none">${icon(q)}</span>
      <b>${i+1}. ${esc(q.name)}</b>
      <span style="color:var(--muted)">${what} · ${mb}MB</span>${err}
      <span style="margin-inline-start:auto;display:flex;gap:6px;align-items:center">${acts.join('')}</span>
    </div>`;
  }).join('');
  $('tik-queue-list').querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{state.queue.splice(+b.dataset.del,1);renderQueue();}));
  $('tik-queue-list').querySelectorAll('[data-show]').forEach(b=>b.addEventListener('click',()=>showQueueItem(+b.dataset.show)));
  syncRunButtons();
}
// Bring a finished tik's record back on screen. Works mid-queue too — the
// bookkeeping in runQueue captures its fields synchronously, so a view switch
// between items can't corrupt what gets saved.
function showQueueItem(i){
  const q=state.queue[i];if(!q||q.status!=='done'||!q.rec)return;
  state.files=q.files.slice();renderFiles();
  state.chunkNotes=Array.isArray(q.notes)?q.notes:[];
  state.outputName=q.outputName||null;
  renderRecord(q.rec,true);   // restored=true: don't overwrite the refresh-survival snapshot
  showStatus(`מוצגת רשומת התיק «${esc(q.name)}» מהתור — שאר הרשומות נשארות שמורות ברשימת התור.`,'ok');
  $('results').scrollIntoView({behavior:'smooth'});
}
async function runQueue(mode){
  if(state.queueRunning)return;
  state.lastQueueMode=mode;
  // Loose files already on screen become the first tik — nothing is dropped
  // silently. Files that came FROM the queue («הצג», or the last processed tik)
  // are recognized by File-object identity and skipped, so viewing a finished
  // record never re-enqueues it as a duplicate.
  if(state.files.length){
    const fromQueue=state.queue.some(q=>q.files.length===state.files.length&&q.files.every((f,j)=>f===state.files[j]));
    if(!fromQueue)state.queue.unshift({name:'דפים שהועלו ידנית',files:state.files.slice(),status:'pending'});
    state.files=[];
  }
  state.queueRunning=true;renderQueue();
  const runner=mode==='catalog'?catalogTik:fastDescribe;
  let ok=0,fail=0,i;
  // Re-scan for the next pending item each round: items can be added/removed
  // from the queue mid-run without breaking iteration.
  while((i=state.queue.findIndex(q=>q.status==='pending'))!==-1){
    const item=state.queue[i];
    item.status='running';renderQueue();
    state.files=item.files.slice();renderFiles();
    state.chunkNotes=null;state.outputName=null;
    let good=false;
    try{good=(await runner())===true;}catch(e){console.error(e);}
    if(good){
      item.status='done';item.rec=state.lastRecord;
      // Capture per-engine only — "הצג" mid-run swaps these globals, so a blind
      // copy could attach another tik's notes/output to this item.
      item.notes=(mode==='catalog'&&Array.isArray(state.chunkNotes))?state.chunkNotes:null;
      item.outputName=(mode==='fast'&&state.outputName)?state.outputName:null;
      ok++;
    }else{
      item.status='error';item.error=(($('status').textContent||'').trim()||'נכשל').slice(0,400);fail++;
    }
    renderQueue();
    if(state.queue.some(q=>q.status==='pending'))await new Promise(r=>setTimeout(r,800));
  }
  state.queueRunning=false;renderQueue();   // state.files keeps the last tik's pages (צ'אט / תיאור מפורט / PDF)
  const failTxt=fail?` · ${fail} נכשלו — «🔄 נסה כושלים מחדש» יריץ אותם שוב`:'';
  showStatus(`✓ התור הסתיים — ${ok} תיקים קוטלגו${failTxt}. כל הרשומות שמורות בתור: «הצג» מחזיר רשומה למסך, «⬇ קובץ» מוריד את מה שנשמר בשרת.`,fail?'info':'ok');
}
$('tik-queue-clear').addEventListener('click',()=>{
  if(state.queueRunning){showStatus('התור רץ — המתן לסיום התיק הנוכחי לפני ניקוי.','err');return;}
  state.queue=[];renderQueue();
});
$('tik-queue-retry').addEventListener('click',()=>{
  if(state.queueRunning)return;
  state.queue.forEach(q=>{if(q.status==='error'){q.status='pending';delete q.error;}});
  renderQueue();runQueue(state.lastQueueMode||'fast');
});

/* ---------- intake form (טופס איסוף) handling ---------- */
function renderIntake(){
  const n=state.intakeFiles.length;
  $('intake-filelist').innerHTML = n
    ? state.intakeFiles.map(f=>`<div class="f"><span>📄 ${esc(f.name)}</span><span>${(f.size/1024/1024).toFixed(1)}MB</span></div>`).join('')
      +`<div class="f" id="intake-clear" style="cursor:pointer;color:var(--error);font-weight:600">נקה טופס איסוף ✕</div>`
    : '';
  const c=$('intake-clear');if(c)c.addEventListener('click',()=>{state.intakeFiles=[];renderIntake();});
}
function addIntake(list){
  const files=Array.from(list).filter(f=>/\.(pdf|jpe?g|png|tiff?|webp)$/i.test(f.name));
  state.intakeFiles=[...state.intakeFiles,...files];renderIntake();
}
const idrop=$('intake-drop');
$('intake-input').addEventListener('change',e=>{addIntake(e.target.files);e.target.value='';});
idrop.addEventListener('dragover',e=>{e.preventDefault();idrop.classList.add('over');});
idrop.addEventListener('dragleave',()=>idrop.classList.remove('over'));
idrop.addEventListener('drop',e=>{e.preventDefault();idrop.classList.remove('over');addIntake(e.dataTransfer.files);});
