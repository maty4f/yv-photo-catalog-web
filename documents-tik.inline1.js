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
// A bare "טעינת תמונה נכשלה" says nothing about WHICH page of a 200-scan tik
// died or why (3.8.2026: a folder picked straight off the Google Drive mount —
// the files were online-only, so every read threw and the whole run aborted).
// Probe the bytes to separate the real causes and always name the file.
async function decodeFailure(file){
  const nm=(file&&file.name)||'קובץ';
  const mb=file?` (${(file.size/1024/1024).toFixed(1)}MB)`:'';
  if(!file||!file.size)
    return new Error(`הקובץ «${nm}» ריק (0 בתים) — כנראה לא ירד מהענן למחשב.`);
  try{await file.slice(0,8).arrayBuffer();}
  catch(e){
    return new Error(`לא ניתן לקרוא את «${nm}»${mb} — הקובץ יושב בענן (Google Drive / iCloud) ולא הורד למחשב. `+
      `סמן את התיקייה «זמינה גם במצב לא מקוון», או העתק אותה לדיסק המקומי, ונסה שוב. (${e.name||e.message})`);
  }
  if(/\.tiff?$/i.test(nm))
    return new Error(`«${nm}» הוא TIFF — כרום לא מפענח TIFF. המר את הסריקות ל-JPG/PNG, או הרץ מה-CLI (yv doc describe).`);
  return new Error(`«${nm}»${mb} — לא ניתן לפענח את התמונה (קובץ פגום או פורמט לא נתמך).`);
}
async function loadImg(file){
  const url=URL.createObjectURL(file);
  try{return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=url;});}
  catch(e){throw await decodeFailure(file);}
  finally{URL.revokeObjectURL(url);}
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
 "names_index": [ {"name": "", "name_original": "", "role": "", "birth": "", "death": "", "place": "", "fate": "", "source_pages": "", "confidence": ""} ],
 "timeline": [ {"date": "", "event": "", "place": "", "source_pages": "", "confidence": ""} ],
 "subjects_he": [ "" ],
 "subjects_en": [ "" ]
}`;

/* ---------- מסלול "מקורות פרטיים" — נוהל הרישום המחמיר ---------- */
// בורר #tik-source: "מקורות פרטיים" (ברירת-מחדל — זיכרונות, עדויות, יומנים)
// מוסיף את הכללים המחמירים לפרומפט הסינתזה ואת רשימות-הוודאות לרשומה;
// "מקורות מוסדיים" = הרישום הרגיל (צורת הרישום תותאם כשיגיעו דוגמאות).
function tikSource(){const el=document.getElementById('tik-source');const v=(el&&el.value)||'';return (v==='institutional'||v==='isa'||v==='eliach')?v:'private';}
const PRIVATE_SOURCE_RULES=`── תוספת מחייבת — תיק ממקורות פרטיים (זיכרונות, עדויות, יומנים; נוהל רישום מחמיר) ──
הכללים הבאים מצטרפים לכל הכללים לעיל וגוברים עליהם בכל סתירה:
1. הסתמך אך ורק על המופיע במפורש בתיק. אין ידע חיצוני, אין השלמת פרטים, אין הסקת מסקנות שאינן כתובות.
2. title — כותר תיאורי של הפריט כולו: "<סוג הפריט: חוברת/אוגדן/תיק> ובה/ובו <החומר המרכזי> של <שם בעברית>, יליד <מקום בלטינית> <שנה>, המתעד את קורותיו בשואה ב-<מקומות>, <רכיבים נוספים> הקשור/ים ל<קהילה/מקום>". שמות אנשים בכותר — עברית בלבד; מקומות — לטינית.
3. "מידע נוסף" (additional_info_paragraphs) — **קבוצות-חומר**, קבוצה=פסקה עם heading משלה, רק לפי מה שקיים בתיק, בלי פסקת-פתיחה ובלי טקסט מחוץ לקבוצות; טווח תאריכי יומן — לפי הרשומה הראשונה והאחרונה שלו; יומן מתורגם → "תרגום יומנו של…":
   · heading ליומן/זיכרונות: "יומן שניהל <שם בעברית> מ-<תאריך> עד <תאריך>"; body = ראשי-פרקים כרונולוגיים מופרדים בנקודה-פסיק (;), בשמות-פעולה ("הוצאה להורג של…", "בריחה מ-…"), בלי משפטי קישור, בלי פרשנות, בלי קשר סיבתי שלא במקור.
   · heading "ניצולים שזיכרונותיהם מובאים בחוברת:"; body = שמות בעברית עם הכתיב המקורי/שם-עכשווי בסוגריים, מופרדים ב-";".
   · heading "מסמכים המובאים בחוברת:" / "רשימות המובאות בחוברת:"; body = פריט לכל שורה בתחילית "--- ", תיאור נומינלי; מונחי-מקור בלטינית עם באור עברי בסוגריים: Attestato Scolastico (תעודת לימודים).
4. דעה, התרשמות או השערה של הכותב אינן עובדה — מושמטות מהתקציר; אם מהותיות → review_flags עם ייחוס ("לדברי הכותב").
5. אסור מילות סיוג: "ככל הנראה", "ייתכן", "כנראה", "אפשר להניח", "ניתן להסיק", "כפי הנראה". קביעה לא-ודאית מושמטת ועוברת ל-review_flags עם ציטוט קצר כשקיים.
6. בכל ספק — העדף השמטה. שם, מקום, תאריך או קרבה נכללים רק אם כתובים במפורש.
7. ב-names_index מלא לכל אדם "confidence": "✓"/"~"/"?" (ודאות קריאת השם); ב-timeline אירוע מסופק מקבל "?".`;
const privateRulesBlock=()=>tikSource()==='private'?'\n\n'+PRIVATE_SOURCE_RULES:'';

/* ---------- מסלול "תיעוד לארכיון המדינה" — נוסח רשומות archives.gov.il ---------- */
// נלמד מרשומות-תיק חיות באתר ארכיון המדינה (details/<id>, אומת 3.8.2026):
// שם-פריט קצר, "תיאור התיק" תמציתי, תקופת-חומר של התיק כולו. ההמרה המלאה לשדות
// ISA (תגיות, סטטוס חשיפה, מזהים, 01/01–31/12) נעשית בדף-ההזנה שהמנוע מפיק
// אוטומטית בסוף "תיאור מהיר" (cli/exporters/isa.py) — לא כאן.
const ISA_SOURCE_RULES=`── תוספת מחייבת — תיק המיועד לרישום בארכיון המדינה ──
בנוסף לכל הכללים לעיל:
1. title — "שם הפריט" בנוסח רשומות ארכיון המדינה: שם תיק קצר וענייני, לא משפט תיאורי ארוך (כדוגמת רשומותיהם: "ארגון שארית הפליטה, רחוב יהודה הלוי 143 תל-אביב.", "תלמוד תורה שארית הפליטה בחליסה").
2. "תיאור התיק" — הפסקה הראשונה ב-additional_info_paragraphs, עם heading בדיוק "תיאור התיק": פסקה תמציתית אחת בגוף שלישי על תוכן התיק; מה שכלול בתיק נמנה במפורש ("התיק כולל: התכתבויות, תקנון, קטעי עיתונות…"); בלי פרשנות ובלי חזרה על הכותר.
3. date_range — "תקופת החומר" של התיק כולו: מהמסמך המוקדם ביותר עד המאוחר ביותר.
4. כל שאר השדות — לפי הנוסח הרגיל; ההמרה לשדות ארכיון המדינה נעשית אוטומטית בדף-ההזנה שנוצר בסוף הריצה.`;
const isaRulesBlock=()=>tikSource()==='isa'?'\n\n'+ISA_SOURCE_RULES:'';

/* ---------- מסלול "אוסף יפה אליאך" — קטלוג תיקים בשדות ספיר ---------- */
// מפרט הארכיונאית (4.8.2026): כותר של משפט–שניים, עשיר בתאריכים ובמקומות
// מדויקים — תמצית ה"מידע נוסף"; מידע-נוסף = תיאור מפורט (שמות, מקומות,
// תאריכים, תוכן). ההמרה לשדות דף-ההזנה של ספיר (צורה/אופי חומר/שפה/מקומות
// קשורים) נעשית בדף שהמנוע מפיק בסוף "תיאור מהיר" (cli/exporters/eliach.py).
const ELIACH_SOURCE_RULES=`── תוספת מחייבת — קטלוג תיקים של אוסף יפה אליאך (שדות ספיר) ──
בנוסף לכל הכללים לעיל:
1. title — "כותר" ספיר: משפט אחד עד שניים, לא יותר, שהם תמצית המידע-הנוסף — עם התאריכים והמקומות המדויקים ככל שכתוב בתיק ("עדות של רחל X על גטו Eishyshok ועל מחנה Y, 1941–1944" — לא "עדות על השואה"). שמות אנשים — עברית בלבד; מקומות — בכתיב הלטיני/האנגלי המקובל בספיר. בלי פרט שאינו כתוב בתיק.
2. additional_info_paragraphs — "מידע נוסף" ספיר: תיאור מפורט של החומר — השמות הנזכרים (ומה שנאמר על גורלם), המקומות, התאריכים ותוכן הדברים, בפסקאות לפי מרכיבי התיק. הכותר הוא תקציר של שדה זה.
3. date_range — טווח תאריכי החומר כולו; languages — שמות שפות בעברית (ערכי שדה "שפה" בספיר).
4. כל השאר — לפי הנוסח הרגיל; דף-ההזנה בשדות ספיר (צורה, אופי חומר, שפה, מקומות קשורים) נוצר אוטומטית בסוף הריצה.`;
const eliachRulesBlock=()=>tikSource()==='eliach'?'\n\n'+ELIACH_SOURCE_RULES:'';

// "פריטים מושחרים" — צנזורת ארכיון המדינה שזוהתה בסריקה (שלב-1). רשומה מלפני
// הוספת הזיהוי (אין מפתח redactions) מוצגת עם הערה, לא עם "לא זוהו".
function isaRedactionsField(rec){
  if(rec.redactions===undefined&&!String(rec.redactions_he||'').trim())
    return fieldBlock('פריטים מושחרים','f-isa-redact','<span class="none">— הרשומה נוצרה לפני הוספת זיהוי ההשחרות; הרץ תיאור מחדש לבדיקה —</span>');
  const reds=(rec.redactions||[]).filter(r=>r&&String(r.pages||'').trim());
  if(!reds.length)
    return fieldBlock('פריטים מושחרים','f-isa-redact','אין — לא זוהו קטעים מושחרים בסריקה');
  const txt=String(rec.redactions_he||'').trim()||
    (`בתיק ${reds.length} קטעים מושחרים: `+reds.map(r=>`עמ' ${String(r.pages)}`+(String(r.extent_he||'').trim()?` — ${String(r.extent_he)}`:'')).join('; '));
  return fieldBlock('פריטים מושחרים','f-isa-redact',esc(txt));
}

// דף-ההזנה נוצר על-ידי המנוע לצד הרשומה בריצת "תיאור מהיר" — ‎<שם>.isa.html
// כשנבחר ארכיון המדינה, ‎<שם>.eliach.html כשנבחר אוסף יפה אליאך; כאן רק
// מוצעת הורדתו כשקיים בשרת.
const ENTRY_SHEETS={
  isa:{suffix:'.isa.html',bg:'#8a6a1f',label:'🏛 דף-הזנה לארכיון המדינה',
       title:'הרשומה במבנה רשומת ארכיון המדינה — שם הפריט, תיאור התיק, תקופת החומר, תגיות, סטטוס חשיפה — כפתור העתקה לכל שדה. נוצר אוטומטית בסוף הריצה'},
  eliach:{suffix:'.eliach.html',bg:'#6b4b8a',label:'📗 דף-הזנה לספיר — אוסף יפה אליאך',
       title:'הרשומה בשדות ספיר — כותר, מידע נוסף, צורה, אופי חומר, שפה, מקומות קשורים — כפתור העתקה לכל שדה. נוצר אוטומטית בסוף הריצה'}};
async function maybeOfferEntrySheet(){
  const old=document.getElementById('entry-sheet-btn');if(old)old.remove();
  const bar=document.getElementById('tik-export-bar');
  const sheet=ENTRY_SHEETS[tikSource()];
  if(!sheet||!state.outputName||!bar)return;
  const name=state.outputName.replace(/\.html$/,sheet.suffix);
  try{
    const r=await fetch(serverBase()+'/api/output/'+encodeURIComponent(name));
    if(!r.ok)return;
    const blob=await r.blob();
    const b=document.createElement('button');
    b.type='button';b.id='entry-sheet-btn';b.className='copy-btn';
    b.style.cssText=`background:${sheet.bg};color:#fff`;
    b.textContent=sheet.label;
    b.title=sheet.title;
    b.addEventListener('click',()=>downloadBlob(blob,name));
    bar.insertBefore(b,bar.firstElementChild?bar.firstElementChild.nextSibling:null);
  }catch(e){/* אין דף — אין כפתור */}
}

/* ---------- מקורות מוסדיים · סוג "עדות" (חפ"ן / TR.11, נוסח פולינה אידלסון) ---------- */
// נלמד מרשומות-הדוגמה 17404545/17415302 (עדות) ו-17404618/17415050 (מסמך-רשימה)
// ומהנחיות הרושמת: כותר נוסחתי, פרטי מוסר-העדות, תקציר בנקודה-פסיק עם שמות-פעולה,
// שמות/מקומות בלטינית, דרגות וארגונים בלטינית עם הסבר, מסמך-רשימה החל מ-5 נרדפים.
function tikKind(){const el=document.getElementById('tik-kind');return (el&&el.value)||'testimony';}
function isInstTestimony(){return tikSource()==='institutional'&&tikKind()==='testimony';}
const TESTIMONY_SCHEMA_RULES=`אתה מקטלג תיעוד מוסדי בארכיון — חטיבת TR.11 (חפ"ן — משטרת ישראל): תיעוד משפטי שנגבה עבור התביעה הגרמנית בנושא פשעי נאצים. לפניך דפי עדות אחת (או מסמך-רשימה) מתוך תיק כזה. הפק **רשומת-פריט אחת** בנוסח הרישום המוסדי.

עקרונות מחייבים:
- אסור לנחש; כל פרט — אך ורק מהמסמך. דף לא קריא — ציין זאת.
- שמות אנשים ומקומות גיאוגרפיים נשארים **בשפת המקור בכתיב לטיני**, באות ראשונה גדולה (Adam Krakowski, Brzezany) — גם בתוך טקסט עברי. מונחים בקירילית/יוונית — תעתיק לטיני.
- דרגות, שמות ארגונים ועיטורים — בלטינית, עם הסבר עברי קצר בסוגריים במידת הצורך: SS-Obersturmführer (דרגת קצונה ב-SS).
- title — נוסחת הכותר המוסדית: "עדות של <שם>, יליד/ילידת <שנה או מקום ושנה>, שניתנה ב<בית המשפט/מקום> ב-<תאריך>", ובמידת הצורך "לפי בקשת <בית המשפט המבקש>". למסמך-רשימה: "רשימת <עדים/ניצולים/נספים>... מ<הקשר> מה-<תאריך>".
- summary ("מידע נוסף"): משפטים מופרדים ב-**נקודה-פסיק (;)** ולא בנקודה; **שמות-פעולה במקום פעלים** ("הוצאה להורג של קבוצת יהודים מהגטו", לא "הנאצים הוציאו להורג"); קדימות ל**סיפור היהודי** — אקציות, גירושים, הקמת גטאות, משלוחים למחנות, בריחה והסתתרות; מידע על הפושעים בקצרה בלבד; **אין לחזור על הכותר**.
- **צירי-החובה של תקציר עדות**: כשהעדות עוסקת במחנות, בגטאות, ברדיפת יהודים או ברצח — התקציר **קצר** ובנוי סביבם לפי הסדר: (א) **מחנות וגטאות** — כל אחד בשמו ובכתיב לטיני, כרונולוגית; (ב) **רדיפה** — סימון ואות קלון, החרמת רכוש, עבודות כפייה, ריכוז בגטו, רעב, גירוש; (ג) **רצח** — אקציה, סלקציה, הוצאה להורג, תא גזים, חיסול גטו, צעדת-מוות: מה, היכן, מתי, ובאיזה היקף; (ד) **הנרדפים** — הקהילה/המשפחה/השמות שהעד נוקב, וגורלם. פרוצדורה משפטית, נסיבות גביית העדות וזהות החוקרים יורדים לשוליים או נשמטים. לשון ארכיונית מאופקת, בלי הגזמה ובלי פרט שהעד לא מסר.
- מסמך-רשימה: רשימה של 5 יהודים נרדפים או יותר → record_type="מסמך-רשימה", מלא names_in_list, וקבע designate_name_typing=true (הקלדת השמות — תפקיד היכל השמות; אל תעתיק את כל הרשימה לתקציר). אחרת record_type="עדות".
- accession_number ("מספר נכנסות"): אינו מופיע במסמך — העתק מהמידע-המוקדם אם סופק; אחרת "".
- related_places: לכל מקום name בלטינית, country_he בעברית (למשל "פולין"), type_he="גטו"/"מחנה"/"" ו-region ("נפה/מחוז" אם ידוע, לטינית).

החזר אך ורק JSON תקין בסכימה:
{
 "record_type": "עדות",
 "title": "",
 "summary": "",
 "witness": {"first_name": "", "last_name": "", "gender": "", "birth_date_authentic": "", "birth_date_reconstructed": "", "birth_place": "", "maiden_name": "", "father_name": "", "father_surname": "", "mother_name": "", "mother_maiden_name": "", "alias": "", "spouse_name": "", "spouse_maiden_name": "", "residence_before_war": "", "residence_address": "", "aliyah_year": "", "place_after_war": "", "address_after_war": "", "testimony_nature": "", "testimony_place": "", "testimony_type": "", "interviewer": ""},
 "material": {"material_type": "עדויות/יומנים/זכרונות", "material_kinds": ["עדות"], "language": "", "form": "", "original": "כן", "pages_count": "", "creation_date_start": "", "creation_date_end": "", "names_in_list": 0, "ethnic": ""},
 "collection": {"division": "TR.11 - חפ\\"ן - משטרת ישראל", "subdivision": "", "file_number": "", "accession_number": "", "prev_file_symbol": "", "parent_item": ""},
 "related_places": [ {"name": "", "region": "", "country_he": "", "type_he": ""} ],
 "languages": [ "" ],
 "designate_name_typing": false, "name_typing_reason": "",
 "classification": "בלתי מסווג", "classification_reason": "",
 "names_index": [ {"name": "", "name_original": "", "category": "jew|perpetrator|other", "role": "", "crimes": "", "birth": "", "death": "", "place": "", "fate": "", "source_pages": "", "confidence": ""} ],
 "timeline": [ {"date": "", "event": "", "place": "", "source_pages": "", "confidence": ""} ],
 "document_inventory": [ {"pages": "", "doc_type": "", "date": "", "languages": "", "description": ""} ],
 "subjects_he": [ "" ],
 "subjects_en": [ "" ]
}`;
const schemaRules=()=>isInstTestimony()?TESTIMONY_SCHEMA_RULES:TIK_SCHEMA_RULES;
const testimonyChunkExtra=()=>isInstTestimony()
  ?'\n- **פרטי העד/ה** — בדפי פתיחת/סיום העדות: שם מלא, מין, תאריך ומקום לידה, שמות ההורים ושם נעורים, מגורים לפני/אחרי המלחמה, שנת עליה, מקום ומועד מסירת העדות, בית המשפט, שם המראיין, מספר עמודים.'
  :'';

/* ---------- chunk extraction (Claude reads every page) & synthesis prompts ---------- */
const CHUNK_EXTRACT_RULES = `אתה מקטלג ארכיוני בארכיון הקורא **חלק** מתיק (טווח דפים שיצוין). הקבצים הם סריקות אמיתיות מתקופת השואה — קרא בעיון. אלו לא כל דפי התיק. הסיכום ישמש אחר כך לסינתזת רשומת-תיק אחת.

⚠ זו **נקודת ביניים** — היה **טלגרפי**. סך הכול **עד ~500 מילים**. בלי משפטי רקע/ניתוח, בלי חזרות, בלי הקדמה/סיכום. רק עובדות, בשורות קצרות.

החזר טקסט קצר תחת הכותרות (דלג על כותרת שאין לה תוכן):
- **מסמכים** — שורה לכל מסמך/טווח-דפים: דפים · סוג (פרוטוקול/תעודה/מכתב/רשימה/שער…) · תאריך · שפה · תיאור ב-5-8 מילים.
- **שמות** — שורה לכל אדם (פעם אחת בלבד): שם + כתיב מקורי בסוגריים · קרבה/תפקיד · תאריכים · מקום · גורל · דף.
- **תאריכים/אירועים** — שורה לכל אחד: אירוע · תאריך · מקום.
- **יהלומים** — עדות/מכתב-ניצול/יומן/רשימת-נספים/תעודת-מחנה-גטו/זהות-בדויה — אם יש; אחרת "אין".

אסור לנחש. דף לא קריא → "[לא קריא: דף X]". ישר לעובדות.`;

const synthRules = () => `אתה מקטלג ארכיוני בכיר בארכיון. לפניך סיכומי-טקסט שכתבת קודם אחרי שקראת את **כל דפי התיק** (מנה אחר מנה, לפי טווחי דפים). תפקידך עכשיו: לסנתז מהם **${isInstTestimony()?'רשומת-פריט אחת בנוסח הרישום המוסדי':'רשומת-תיק אחת לפי נהלי ספיר'}** — לאחד כפילויות, לזהות סתירות בין מנות, ולסמן ודאות. הסתמך על הסיכומים; אם משהו חסר/לא ברור סמן זאת.
${schemaRules()}

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
  const synthPrompt=`${synthRules()}${privateRulesBlock()}${isaRulesBlock()}${eliachRulesBlock()}\n\n## הסיכומים שלך מכל מנות התיק (טקסט חופשי, לפי טווחי דפים)\n${findingsText}${contextBlock()}${thesaurusBlock()}\n\nהחזר JSON סופי בלבד.`;
  onStage&&onStage(`<span class="spinner"></span>שלב 2 · Claude מסנתז את רשומת התיק…`);
  return await claudeSynthesize(synthPrompt,s=>onStage&&onStage(`<span class="spinner"></span>שלב 2 · Claude מסנתז את רשומת התיק… (${s} שׄ)`));
}

/* ---------- render ---------- */
/* clone `el` minus rows whose .row-pick is UNCHECKED (read from the LIVE
   checkboxes — cloneNode copies the checked attribute, not the live property)
   and minus control cells/buttons. Every copy path goes through this. */
/* סימוני-ודאות (V✓/H~/✓/~/?) הם שכבת-בדיקה על המסך — לעולם אינם חלק מהטקסט
   שהמקטלג מעתיק לספיר (החלטת משתמש 23.7.2026). כל נתיב העתקה/ייצוא מנקה אותם. */
const stripCertMarks=s=>String(s||'').replace(/[VH][✓~?]/g,'').replace(/\(\s*\)/g,'').replace(/[ \t]{2,}/g,' ');
function cleanRecForExport(rec){ // עותק-ייצוא נקי; התצוגה עצמה שומרת את הסימונים
  try{return JSON.parse(stripCertMarks(JSON.stringify(rec)));}catch(e){return rec;}
}
function copyCloneOf(el){
  const c=el.cloneNode(true);
  const live=[...el.querySelectorAll('.row-pick')];
  [...c.querySelectorAll('.row-pick')].forEach((cb,i)=>{
    if(live[i]&&!live[i].checked){const tr=cb.closest('tr');if(tr)tr.remove();}
  });
  c.querySelectorAll('th.rp,td.rp,th.act,td.act,button,select').forEach(x=>x.remove());
  c.querySelectorAll('.cv,.ch,.cmark').forEach(x=>x.remove());
  return c;
}
/* innerText needs layout — attach the filtered clone off-screen briefly */
function copyTextOf(el){
  const c=copyCloneOf(el);
  c.style.cssText='position:absolute;left:-9999px;top:0;direction:rtl';
  document.body.appendChild(c);
  const t=c.innerText.trim();
  c.remove();
  return stripCertMarks(t).trim();
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

/* ---------- רשומת עדות מוסדית (TR.11): פרטי מוסר-העדות, שיוך ונתוני-חומר ---------- */
function testimonySectionsHtml(rec){
  if(!rec||rec._tik_kind!=='testimony')return '';
  const w=Object.assign({},rec.witness||{}),m=rec.material||{},c=rec.collection||{};
  // גישור מבנה-המנוע (תור-השרת / ☁): רשומת המנוע נושאת את פרטי-העד ב-
  // testimonies[].witness (name/birth/prewar_residence…), לא ב-rec.witness
  // (first_name/birth_date_authentic…) של מסלול-הדפדפן — בלעדיו הטופס יצא
  // ריק גם כשהעדות חולצה במלואה (10.8). ממלאים רק שדות שריקים בטופס,
  // ורק ממה שנכתב בעדות — never-invent.
  // בוחרים את העד העשיר-בפרטים (העד המרכזי; בתיק משפטי מופיעים גם עדים אגביים
  // כ-"Mr. X" בלי ביוגרפיה) — לא סתם את הראשון.
  const _wScore=x=>x?Object.values(x).filter(s=>String(s||'').trim()).length:0;
  const ew=(rec.testimonies||[]).map(t=>t&&t.witness).sort((a,b)=>_wScore(b)-_wScore(a))[0]||{};
  const fill=(key,val)=>{if(!String(w[key]||'').trim()&&String(val||'').trim())w[key]=String(val).trim();};
  const nm=String(ew.name||ew.name_original||'').trim();
  if(nm&&!String(w.first_name||'').trim()&&!String(w.last_name||'').trim()){
    const parts=nm.split(/\s+/);
    if(parts.length>1){w.first_name=parts.slice(0,-1).join(' ');w.last_name=parts[parts.length-1];}
    else w.last_name=nm;   // מילה בודדת ("Rosenberg") = שם-משפחה, לא שם פרטי
  }
  fill('gender',ew.gender);fill('birth_date_authentic',ew.birth);fill('birth_place',ew.birth_place);
  fill('maiden_name',ew.maiden_name);fill('father_name',ew.father_name);fill('mother_name',ew.mother_name);
  fill('spouse_name',ew.spouse_name);fill('residence_before_war',ew.prewar_residence);
  fill('place_after_war',ew.postwar_residence);fill('aliyah_year',ew.aliyah_year);
  fill('testimony_place',ew.testimony_place);fill('interviewer',ew.interviewer);
  const t0=(rec.testimonies||[]).find(t=>t&&t.witness===ew)||{};
  fill('testimony_type',t0.kind_he);
  const nTst=(rec.testimonies||[]).filter(t=>t&&t.witness&&Object.values(t.witness).some(s=>String(s||'').trim())).length;
  const multiNote=nTst>1?`<div class="diamond">בתיק ${nTst} עדויות — הטופס מציג את הראשונה; פירוט כולן בבלוק «שכבת העדות» של הרשומה.</div>`:'';
  const v=x=>{const s=String(x==null?'':x).trim();return s?esc(s):'—';};
  const tbl=rows=>`<table class="tbl"><tbody>`+
    rows.map(r=>`<tr><th style="width:34%">${esc(r[0])}</th><td>${r[1]}</td></tr>`).join('')+`</tbody></table>`;
  const witnessRows=[
    ['שם פרטי',v(w.first_name)],['שם משפחה',v(w.last_name)],['מין',v(w.gender)],
    ['תאריך לידה (אותנטי)',v(w.birth_date_authentic)],['תאריך לידה משוחזר',v(w.birth_date_reconstructed)],
    ['מקום לידה',v(w.birth_place)],['שם נעורים',v(w.maiden_name)],
    ['שם האב',v(w.father_name)],['שם משפחת האב',v(w.father_surname)],
    ['שם האם',v(w.mother_name)],['שם הנעורים של האם',v(w.mother_maiden_name)],
    ['שם בדוי / כינוי',v(w.alias)],['שם בן/בת הזוג',v(w.spouse_name)],['שם נעורים של בת-הזוג',v(w.spouse_maiden_name)],
    ['מגורים לפני המלחמה',v(w.residence_before_war)],['כתובת מקום מגורים',v(w.residence_address)],
    ['שנת עליה',v(w.aliyah_year)],['מקום אחרי המלחמה',v(w.place_after_war)],['כתובת אחרי המלחמה',v(w.address_after_war)],
    ['אופי העדות',v(w.testimony_nature)],['סוג עדות',v(w.testimony_type)],
    ['מקום מסירת העדות',v(w.testimony_place)],['שם מראיין',v(w.interviewer)],
  ];
  const materialRows=[
    ['סוג רשומה',v(rec.record_type)],['סוג חומר',v(m.material_type)],
    ['אופי החומר',v((m.material_kinds||[]).filter(Boolean).join(', '))],
    ['שפה',v(m.language)],['צורה',v(m.form)],['מקורי',v(m.original)],
    ['מספר העמודים/מסגרות',v(m.pages_count)],
    ['ת.ת. יצירת החומר',v(m.creation_date_start)],['ת.ס. יצירת החומר',v(m.creation_date_end)],
    ['מס׳ שמות ברשימה',v(m.names_in_list||'')],['השתייכות אתנית',v(m.ethnic)],
  ];
  const collectionRows=[
    ['חטיבה',v(c.division)],['תת-חטיבה',v(c.subdivision)],['מספר תיק',v(c.file_number)],
    ['מספר נכנסות',v(c.accession_number)],['סימול תיק קודם',v(c.prev_file_symbol)],
    ['שייך לפריט',v(c.parent_item)],
  ];
  // מסמך-רשימה (הנחיית הרושמת): 5+ נרדפים → הקלדת השמות בהיכל השמות.
  const nList=Number(m.names_in_list)||0;
  const listBanner=(String(rec.record_type||'')==='מסמך-רשימה'||nList>=5)
    ?`<div class="diamond"><b>מסמך-רשימה</b> — ${nList?`${nList} שמות ברשימה; `:''}רישום השמות הוא תפקיד היכל השמות (מיועד להקלדת שמות: ${rec.designate_name_typing?'כן':'לבדיקה'}).</div>`
    :'';
  return `<div class="section-bar">רשומת עדות מוסדית — חפ"ן / TR.11</div>`+
    listBanner+multiNote+
    fieldBlock('פרטי מוסר העדות','f-witness',tbl(witnessRows))+
    fieldBlock('נתוני חומר','f-material',tbl(materialRows))+
    fieldBlock('שיוך ארכיוני','f-collection',tbl(collectionRows));
}

/* בקרת-עקיבות (מערכת-הפיקוח) — רצה על *כל* רשומה: הרשומה מול הנתונים של
   עצמה. נולדה משלוש טעויות-אמת (תיק Vela Luka): טווח-יומן חלקי ומקום מרכזי
   שנשמט מהכותר. הממצאים מוצגים בתיבת "נקודות לבדיקה" של כל רשומה. */
function consistencyFindings(rec){
  if(!rec||typeof rec!=='object')return [];
  const out=[];
  const tl=(rec.timeline||[]).filter(t=>t&&(t.event||t.date));
  const proseAll=[rec.title,...(rec.additional_info_paragraphs||[]).map(p=>[p&&p.heading,p&&p.body].filter(Boolean).join(' '))].join(' ');
  const diaryPages=new Set();
  (rec.document_inventory||[]).forEach(d=>{
    const k=String((d&&(d.type_key||d.doc_type))||'').toLowerCase();
    if(/diary|testimony|יומן|עדות|זיכרונות/.test(k))parsePagesSpec(d.pages).forEach(p=>diaryPages.add(p));
  });
  const diaryYears=[];
  tl.forEach(t=>{
    if(!parsePagesSpec(t.source_pages).some(p=>diaryPages.has(p)))return;
    (String(t.date||'').match(/\b1[89]\d\d\b/g)||[]).forEach(y=>diaryYears.push(+y));
  });
  const mRange=proseAll.match(/מ[-־]?\s*[^;\n]{0,14}?(1[89]\d\d)\s*(?:עד|-|–)\s*[^;\n]{0,14}?(1[89]\d\d)/);
  if(mRange&&diaryYears.length){
    const y1=+mRange[1],y2=+mRange[2],lo=Math.min(...diaryYears),hi=Math.max(...diaryYears);
    if(lo<Math.min(y1,y2)||hi>Math.max(y1,y2))
      out.push(`הטקסט טוען טווח ${mRange[1]}–${mRange[2]}, אך אירועי החומר היומני משתרעים ${lo}–${hi} — ודא את הרשומה הראשונה והאחרונה`);
  }
  const plCount={};
  tl.forEach(t=>{(String(t.place||'').match(/[A-Za-zĀ-žÀ-ÿ][A-Za-zĀ-žÀ-ÿ'’-]{3,}/g)||[]).forEach(w=>{plCount[w]=(plCount[w]||0)+1;});});
  Object.keys(plCount).filter(w=>plCount[w]>=3&&!String(rec.title||'').toLowerCase().includes(w.toLowerCase()))
    .sort((a,b)=>plCount[b]-plCount[a]).slice(0,3)
    .forEach(w=>out.push(`מקום מרכזי שאינו בכותר: ${w} (${plCount[w]} אירועים בציר-הזמן)`));
  return out;
}

/* ---------- מסלול "מקורות פרטיים": תקציר כרונולוגי + רשימות-הוודאות ----------
   נגזרים דטרמיניסטית מהרשומה המובנית (timeline / names_index / review_flags /
   unreadable_pages) — קוד, לא מודל — באותה רוח של רינדור-המנוע ב-CLI. */
function privateSectionsHtml(rec){
  if(!rec||rec._tik_source!=='private')return '';
  const CAP=40; // דף הקטלוג נשאר קריא — רשימות ארוכות נקטעות בהצהרה (המלא ב-JSON/קובץ השמות)
  const norm=c=>{c=String(c||'').trim().toLowerCase();return ({'✓':'high','~':'mid','?':'low'})[c]||c;};
  const pg=v=>v?esc(String(v)).replace(/,(?=\S)/g,', '):'';
  const ul=items=>{
    if(!items.length)return '<ul><li><span class="none">— אין —</span></li></ul>';
    const cut=items.slice(0,CAP);
    if(items.length>CAP)cut.push(`(+${items.length-CAP} פריטים נוספים — הרשימה קוצרה)`);
    return '<ul>'+cut.map(x=>`<li>${x}</li>`).join('')+'</ul>';
  };
  const PF=[['role','תפקיד/קרבה'],['birth','לידה'],['death','פטירה'],['place','מקום'],['fate','גורל']];
  const nm=(rec.names_index||[]).filter(p=>p&&(p.name||p.name_original));
  const tl=(rec.timeline||[]).filter(t=>t&&(t.event||t.date));
  const nmLabel=p=>{const s=esc(p.name||p.name_original||'');const g=pg(p.source_pages);return s+(g?` (עמ' ${g})`:'');};
  const sure=nm.filter(p=>['','high'].includes(norm(p.confidence)));
  const shaky=nm.filter(p=>['mid','low'].includes(norm(p.confidence)));
  const tlSure=tl.filter(t=>['','high'].includes(norm(t.confidence)));
  const tlShaky=tl.filter(t=>['mid','low'].includes(norm(t.confidence)));
  const evLine=t=>{const seg=[esc(t.date||''),esc(t.event||'')].filter(Boolean).join(' — ');
    return seg+(t.place?` (${esc(t.place)})`:'')+(t.source_pages?` [עמ' ${pg(t.source_pages)}]`:'');};

  // (א) מופיע בוודאות: שמות בקריאה ודאית + מה שנאמר עליהם, אירועים מתוארכים, מקומות.
  const certain=[];
  sure.forEach(p=>{const a=PF.filter(([k])=>String(p[k]||'').trim()).map(([k,l])=>`${l}: ${esc(String(p[k]).trim())}`);
    certain.push(nmLabel(p)+(a.length?' — '+a.join('; '):''));});
  tlSure.forEach(t=>certain.push(evLine(t)));
  (rec.related_places||[]).filter(Boolean).forEach(x=>certain.push('מקום: '+esc(x)));

  // (ב) "לא נאמר בטקסט": שדות-ליבה ריקים אצל שמות ודאיים + פערים ברמת התיק.
  const missing=[];
  sure.forEach(p=>{const g=PF.filter(([k])=>!String(p[k]||'').trim()).map(([,l])=>l);
    if(g.length)missing.push(nmLabel(p)+' — לא נאמר בטקסט: '+g.join(', '));});
  if(!tl.length&&!String(rec.date_authentic_start||'').trim())missing.push('תאריכים — לא נאמר בטקסט');
  if(!(rec.related_places||[]).filter(Boolean).length)missing.push('מקומות — לא נאמר בטקסט');

  // (ג) לא ניתן לקבוע בוודאות: קריאות מסופקות, אירועים בספק, דפים לא-קריאים, דגלי-בדיקה.
  const unsure=[];
  shaky.forEach(p=>unsure.push(nmLabel(p)+(norm(p.confidence)==='low'?' — קריאה מסופקת':' — קריאה סבירה, מומלץ אימות')));
  tlShaky.forEach(t=>unsure.push('אירוע בסימן שאלה: '+evLine(t)));
  const unread=(rec.unreadable_pages||[]).map(String).filter(s=>s.trim());
  if(unread.length)unsure.push('עמודים שאינם קריאים: '+esc(unread.join(', ')));
  (rec.review_flags||[]).filter(f=>f&&f.issue&&f.field!=='מקור הרשומה').forEach(f=>unsure.push(`${esc(f.field||'')} — ${esc(f.issue)}`));

  // בקרת-לינטר (שכבה א): מילות-סיוג אסורות + שנים ללא עיגון בשדות-הפרוזה.
  const HEDGE=['ככל הנראה','ייתכן','כנראה','אפשר להניח','ניתן להסיק','כפי הנראה'];
  const proseFields=[['כותר',rec.title],['הערת תוכן',rec.content_note]]
    .concat((rec.additional_info_paragraphs||[]).map((p,i)=>['מידע נוסף '+(i+1),[p&&p.heading,p&&p.body].filter(Boolean).join(' ')]));
  const knownYears=new Set();
  const addYears=s=>{(String(s||'').match(/\b1[89]\d\d\b/g)||[]).forEach(y=>knownYears.add(y));};
  tl.forEach(t=>addYears(t.date));
  (rec.document_inventory||[]).forEach(d=>addYears(d&&d.date));
  nm.forEach(p=>{addYears(p.birth);addYears(p.death);});
  addYears(rec.date_authentic_start);addYears(rec.date_authentic_end);
  proseFields.forEach(([lbl,txt])=>{
    const s=String(txt||'');
    HEDGE.forEach(w=>{if(s.includes(w))unsure.push(`בקרת-סיוג: "${esc(w)}" ב${esc(lbl)} — הנוהל אוסר מילות-סיוג; נסח מחדש או העבר לבדיקה`);});
    (s.match(/\b1[89]\d\d\b/g)||[]).forEach(y=>{
      if(!knownYears.has(y))unsure.push(`בקרת-עיגון: שנה ${esc(y)} ב${esc(lbl)} ללא עיגון בציר-הזמן/באינוונטר`);
    });
  });

  // "תיאור התיק" — סוגי החומר ותוכנם, מקובץ מהאינוונטר (של מי היומן ועל מה;
  // במה עוסקת ההתכתבות) — דטרמיניסטי, מתמציות המסמכים.
  const grp={},gOrder=[];
  (rec.document_inventory||[]).filter(d=>d&&(d.doc_type||d.description)).forEach(d=>{
    const k=String(d.type_key||d.doc_type||'אחר');
    if(!grp[k]){grp[k]={label:String(d.doc_type||'אחר'),pages:[],descs:[],n:0};gOrder.push(k);}
    grp[k].n++;
    if(String(d.pages||'').trim())grp[k].pages.push(String(d.pages).trim());
    if(String(d.description||'').trim())grp[k].descs.push(String(d.description).trim());
  });
  const matHtml=gOrder.length
    ? '<ul>'+gOrder.map(k=>{const g=grp[k];
        const more=g.descs.length>3?` ועוד ${g.descs.length-3} פריטים`:'';
        return `<li><b>${esc(g.label)}</b>${g.n>1?` (${g.n} פריטים)`:''} — עמ' ${esc(g.pages.join(', ')||'—')}: ${esc(g.descs.slice(0,3).join('; ')||'—')}${esc(more)}</li>`;
      }).join('')+'</ul>'
    : '<span class="none">— אין אינוונטר לקיבוץ —</span>';

  const chrono=tlSure.length
    ? esc(tlSure.map(t=>[t.date,t.event].filter(Boolean).join(' — ')+(t.place?` (${t.place})`:'')).join('; '))
    : '<span class="none">— אין אירועים מתוארכים ודאיים —</span>';

  // שדות-בקרה פנימיים: חיים בדף הקטלוג (העשיר) אך אינם חלק מדף-המקטלג הסופי —
  // תיבת-הסימון שלהם כבויה כברירת-מחדל (המקטלגת יכולה להדליק ידנית).
  return `<div class="section-bar">בקרה פנימית — מקורות פרטיים (לא לדף המקטלג; הרשימות נגזרות מהנתונים, לא מהמודל)</div>`+
    fieldBlock('תיאור התיק — סוגי החומר ותוכנם · פנימי','f-materials',matHtml)+
    fieldBlock('תקציר כרונולוגי — ראשי פרקים · פנימי','f-chrono',chrono)+
    fieldBlock('א. פרטים המופיעים בוודאות בטקסט · פנימי','f-cert-a',ul(certain))+
    fieldBlock('ב. פרטים שאינם מופיעים בטקסט — לא נאמר בטקסט · פנימי','f-cert-b',ul(missing))+
    fieldBlock('ג. פרטים שלא ניתן לקבוע בוודאות מן הטקסט · פנימי','f-cert-c',ul(unsure));
}
const PRIVATE_INTERNAL_FIDS=['f-materials','f-chrono','f-cert-a','f-cert-b','f-cert-c'];

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

/* ---------- "צור פריט ממקטע" (TR.15 — פגישת 17.8.2026) ----------
   כל שורת אינוונטר יכולה להפוך לפריט-משנה: כותר בנוסחת "כותר-על: תוכן המקטע
   [כרך N]", טווח דפים ושיוך לפריט-הכרך. המקטלגת מחליטה מה ראוי להיות פריט;
   הכותר ניתן לעריכה במקום, והפריטים רוכבים על הרשומה (שרידות-רענון). */
function subItemTitleFor(rec,row){
  const full=String(rec.title||'').trim();
  const over=(full.split(/[::]/)[0]||'').trim()||full;   // מה שלפני הנקודתיים = כותר-העל
  let content=String(row.description||row.doc_type||'').trim();
  content=(content.split(/[.;\n]/)[0]||'').trim();       // הכותר קצר — המשפט הראשון בלבד
  const vol=String((rec._cover&&rec._cover.volume)||'').trim();
  const volTag=vol?(/^\d+$/.test(vol)?` [כרך ${vol}]`:` [${vol}]`):'';
  return (over&&content?over+': ':'')+(content||over)+volTag;
}
function persistTikRecord(){
  // שמירה שקטה (עריכת כותר במקום) — בלי renderRecord, כדי לא לאבד פוקוס
  try{
    const payload={rec:state.lastRecord,savedAt:Date.now()};
    const notes=JSON.stringify(state.chunkNotes||[]);
    if(notes.length<1500000)payload.notes=state.chunkNotes||[];
    localStorage.setItem('yv_tik_last_record',JSON.stringify(payload));
  }catch(e){}
}
function hierarchyTreeHtml(rec){
  // עץ שלוש הרמות של הפגישה: תת-אוסף (התיק המשפטי) ← פריט-הכרך ← פריטי-משנה.
  // מוצג רק כשיש מה להראות (kind=tr15 או פריטי-משנה) — לא רועש בתיק רגיל.
  const subs=rec.sub_items||[];
  if(rec._tik_kind!=='tr15'&&!subs.length)return '';
  const full=String(rec.title||'').trim();if(!full)return '';
  const over=(full.split(/[::]/)[0]||'').trim()||full;
  const vol=String((rec._cover&&rec._cover.volume)||'').trim();
  let h=`<div class="hier"><div>📁 ${esc(over)} <small>— תת-אוסף (התיק המשפטי כולו)</small></div>`;
  h+=`<div class="h-i1">└ 📄 ${esc(full)}${vol?` [כרך ${esc(vol)}]`:''} <small>— פריט-הכרך (הרשומה הזו)</small></div>`;
  subs.forEach((s,i)=>{
    h+=`<div class="h-i2">${i===subs.length-1?'└':'├'} ▪ ${esc(s.title||('פריט-משנה '+(i+1)))} <small>— דפים ${esc(s.pages||'?')}${Number.isInteger(s.related)?` · 🔗 נלווה לפריט-משנה ${s.related+1}`:''}</small></div>`;
  });
  return h+'</div>';
}
function createSubItem(idx){
  const rec=state.lastRecord;if(!rec)return;
  const row=(rec.document_inventory||[])[idx];if(!row)return;
  (rec.sub_items=rec.sub_items||[]).push({
    pages:String(row.pages||''),tik_pages:String(row.tik_pages||''),
    doc_type:String(row.doc_type||''),date:String(row.date||''),
    languages:String(row.languages||''),source_desc:String(row.description||''),
    title:subItemTitleFor(rec,row)});
  renderRecord(rec,false);
  showStatus(`✓ נוצר פריט-משנה מדפים ${row.pages||'?'} — מופיע אחרי האינוונטר; הכותר ניתן לעריכה במקום.`,'ok');
}
function createTypeItems(){
  // "פריט לכל סוג חומר" (בקשת 17.8): פריט-משנה אחד לכל סוג-מסמך בתיק — כל
  // הפרוטוקולים יחד, כל הטפסים יחד — עם איחוד טווחי-הדפים, השפות והתאריכים.
  // המקטלגת מוחקת את המיותר ועורכת כותרים; לא נוגע בפריטים שכבר קיימים.
  const rec=state.lastRecord;if(!rec)return;
  const inv=(rec.document_inventory||[]).filter(d=>d&&(d.doc_type||d.description||d.pages));
  if(!inv.length)return;
  const groups=new Map();
  inv.forEach(d=>{
    const t=String(d.doc_type||'').trim()||'אחר';
    if(!groups.has(t))groups.set(t,[]);
    groups.get(t).push(d);
  });
  const full=String(rec.title||'').trim();
  const over=(full.split(/[::]/)[0]||'').trim()||full;
  const vol=String((rec._cover&&rec._cover.volume)||'').trim();
  const volTag=vol?(/^\d+$/.test(vol)?` [כרך ${vol}]`:` [${vol}]`):'';
  const uniq=a=>[...new Set(a.map(s=>String(s||'').trim()).filter(Boolean))];
  rec.sub_items=rec.sub_items||[];
  let made=0;
  groups.forEach((rows,type)=>{
    rec.sub_items.push({
      pages:uniq(rows.map(d=>d.pages)).join(', '),
      tik_pages:uniq(rows.map(d=>d.tik_pages)).join(', '),
      doc_type:type,
      date:uniq(rows.map(d=>d.date)).join(', ').slice(0,60),
      languages:uniq(rows.flatMap(d=>String(d.languages||'').split(/[,;·]+/))).join(', '),
      source_desc:`${rows.length} מסמכים מסוג ${type}`,
      title:(over?over+': ':'')+type+(rows.length>1?` — ${rows.length} מסמכים`:'')+volTag});
    made++;
  });
  renderRecord(rec,false);
  showStatus(`✓ נוצרו ${made} פריטי-משנה — אחד לכל סוג חומר בתיק. הכותרים ניתנים לעריכה; ✕ להסרת סוג מיותר.`,'ok');
}

function renderRecord(rec,restored){
  state.lastRecord=rec;
  // רשומת עדות מוסדית: התאמות-תצוגה — מקומות-עשירים ({name,region,country,type})
  // הופכים לשורות טקסט, והתקציר המוסדי נכנס לבלוק "מידע נוסף" (להעתקה לספיר).
  if(rec&&rec._tik_kind==='testimony'){
    if(Array.isArray(rec.related_places)&&rec.related_places.some(p=>p&&typeof p==='object')){
      rec._places_rich=rec.related_places;
      rec.related_places=rec.related_places.map(p=>(p&&typeof p==='object')
        ?[p.name,[p.region,p.country_he,p.type_he].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')
        :p).filter(Boolean);
    }
    if(String(rec.summary||'').trim()&&!(rec.additional_info_paragraphs||[]).length){
      rec.additional_info_paragraphs=[{heading:'',body:String(rec.summary).trim(),contains_diamond:false}];
    }
  }
  const fc=rec.field_confidence||{};
  // review flags — points Claude marked as needing human verification before Sapir,
  // ובקרת-העקיבות האוטומטית (רצה על כל רשומה) מצטרפת אליהן.
  const dz=$('disagree-box'); dz.innerHTML='';
  const allFlags=[...(rec.review_flags||[]),
                  ...consistencyFindings(rec).map(t=>({field:'בקרת-עקיבות (אוטומטי)',issue:t}))];
  if(allFlags.length){
    dz.innerHTML=`<div class="disagree"><h3>⚠ נקודות לבדיקת המקטלג לפני הדבקה לספיר</h3>`+
      allFlags.map(d=>`<div class="d"><b>${esc(d.field)}</b><br>`+
        `${esc(d.issue)}`+
        (d.note?`<br><small>${esc(d.note)}</small>`:'')+`</div>`).join('')+`</div>`;
  }
  // additional info (assembled). "הקשר היסטורי" (ידע-רקע H) מופרד לשדה משלו —
  // בדף-המקטלג הסופי של תיק פרטי הוא כבוי כברירת-מחדל (נוהל מיכאל: המידע-הנוסף
  // נושא רק את קבוצות-החומר מהתיק עצמו).
  let info='', infoHist='', isaDesc='';
  // מצב ארכיון המדינה: פסקת "תיאור התיק" נשלפת לשדה-הרישום הראשי (במבנה
  // רשומות archives.gov.il) ולא נכפלת גם במידע-הנוסף.
  // גם רשומה מוסדית שנוצרה לפני חתימת-isa (או עם חותמת ישנה) מוצגת במבנה ארכיון
  // המדינה כשהבורר עומד על isa — הבורר משקף את כוונת המקטלג; פרטי/עדות לא נגררים.
  const isIsa=rec._tik_source==='isa'||
    (tikSource()==='isa'&&rec._tik_source!=='private'&&rec._tik_source!=='eliach'&&rec._tik_kind!=='testimony');
  // מצב אוסף יפה אליאך: הרשומה מוצגת בשדות ספיר (כותר, מידע נוסף, צורה, אופי
  // חומר, שפה, מקומות קשורים). חותמת מפורשת גוברת על הבורר — כמו ב-isa.
  const isEliach=!isIsa&&(rec._tik_source==='eliach'||
    (tikSource()==='eliach'&&rec._tik_source!=='private'&&rec._tik_kind!=='testimony'));
  const _paras=(rec.additional_info_paragraphs||[]);
  let _isaDescIdx=-1;
  if(isIsa){
    _isaDescIdx=_paras.findIndex(p=>/תיאור התיק/.test(String((p&&p.heading)||'')));
    if(_isaDescIdx<0)_isaDescIdx=_paras.findIndex(p=>p&&String(p.body||'').trim()&&!/היסטורי/.test(String(p.heading||'')));
    if(_isaDescIdx>=0)isaDesc=String(_paras[_isaDescIdx].body||'').trim();
  }
  _paras.forEach((p,i)=>{
    if(i===_isaDescIdx)return;
    const body=esc(p.body);
    if(/היסטורי/.test(String(p.heading||''))){infoHist+=`${body}\n\n`;return;}
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
    ? `<div class="inv-actions"><button class="deep-btn type-items-btn" title="צור פריט-משנה אחד לכל סוג-מסמך בתיק — איחוד הדפים, השפות והתאריכים של כל סוג">➕ פריט לכל סוג חומר</button></div>`+
      `<table class="tbl"><thead><tr><th class="rp"></th>${hasTikPages?'<th>עמוד בתיק</th>':''}<th>דפי מקור</th><th>סוג</th><th>תאריך</th><th>שפות</th><th>תיאור</th><th class="act"></th></tr></thead><tbody>`+
        inv.map((d,i)=>`<tr><td class="rp"><input type="checkbox" class="row-pick" checked title="כלול שורה זו בהעתקה ובדף-ההעתקה"></td>${hasTikPages?`<td>${pgs(d.tik_pages||'—')}</td>`:''}<td>${pgs(d.pages)}</td><td>${esc(d.doc_type||'—')}</td><td>${esc(d.date||'—')}</td><td>${esc(d.languages||'—')}</td><td>${esc(d.description||'')}</td>`+
          `<td class="act">${isTestimony(d)?`<button class="deep-btn" data-pages="${esc(String(d.pages||''))}" data-desc="${esc(String(d.description||d.doc_type||''))}">🔎 תיאור מפורט</button>`:''}`+
          `<button class="deep-btn item-btn" data-idx="${i}" title="פתח פריט-משנה מהמקטע הזה — כותר משלו, כפוף לפריט הכרך (TR.15)">➕ פריט</button></td></tr>`).join('')+
      `</tbody></table>`
    : '<span class="none">— לא נרשם אינוונטר —</span>';
  // deep descriptions from previous button runs ride the record (refresh-safe)
  const deepBlocks=(rec.deep_descriptions||[]).map((d,i)=>
    fieldBlock(`תיאור מפורט — עדות (דפים ${d.pages||'?'})`,`f-deep-${i}`,d.html||esc(d.text||''))).join('');
  // פריטי-משנה שנוצרו מהאינוונטר (TR.15) — רוכבים על הרשומה (שרידות-רענון);
  // כפתורים ובוררים אינם מועתקים (copyCloneOf מסיר button+select) — ההעתקה נקייה לספיר.
  const _subs=rec.sub_items||[];
  const _shortT=t=>{t=String(t||'').trim();return t.length>48?t.slice(0,48)+'…':t;};
  const subItemBlocks=_subs.map((s,i)=>
    fieldBlock(`פריט-משנה ${i+1} — דפים ${s.pages||'?'}`,`f-subitem-${i}`,
      `<div><b>כותר:</b> <span class="subitem-title" contenteditable="true" data-si="${i}" title="הכותר ניתן לעריכה — נשמר אוטומטית">${esc(s.title||'')}</span></div>`+
      `<div><b>שיוך:</b> פריט שייך ל-«${esc(rec.title||'')}»</div>`+
      `<div><b>דפים:</b> ${esc(s.pages||'—')}${s.tik_pages?` (עמוד בתיק ${esc(s.tik_pages)})`:''} · <b>סוג:</b> ${esc(s.doc_type||'—')}`+
      `${s.date?` · <b>תאריך:</b> ${esc(s.date)}`:''}${s.languages?` · <b>שפות:</b> ${esc(s.languages)}`:''}</div>`+
      // פריטים נלווים (החלטת הפגישה): עדות ותרגומה — אותו אדם, אותו כרך בלבד.
      // הקישור דו-כיווני; שורת-הטקסט נכנסת להעתקה, הבורר עצמו לא.
      (Number.isInteger(s.related)&&_subs[s.related]
        ?`<div><b>פריט נלווה:</b> פריט-משנה ${s.related+1} — ${esc(_subs[s.related].title||'')}</div>`:'')+
      (_subs.length>1
        ?`<div class="rel-row"><label>🔗 נלווה ל:</label> <select class="subitem-rel" data-si="${i}">`+
          `<option value="">— ללא —</option>`+
          _subs.map((o,j)=>j===i?'':`<option value="${j}"${s.related===j?' selected':''}>פריט-משנה ${j+1} — ${esc(_shortT(o.title))}</option>`).join('')+
          `</select></div>`:'')+
      `<button class="deep-btn subitem-del" data-si="${i}">✕ הסר פריט</button>`)).join('');
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
  // הרשימה המלאה אינה חיה בדף הקטלוג (מעמיסה; החלטת משתמש 23.7.2026) —
  // תצוגה מקדימה בלבד כאן, והמלאה בקובץ CSV נפרד (כפתור ⬇ / קובץ השרת).
  const NM_PREVIEW=15;
  const nmShown=nm.slice(0,NM_PREVIEW);
  let nmHtml;
  if(!nm.length){ nmHtml='<span class="none">— לא זוהו שמות —</span>'; }
  else{
    if(!nmShown.some(p=>(p.category||'').trim())){ nmHtml=nmTable(nmShown,legacyCols); }
    else{
      const SECT=[['jew','יהודים וגורלם / Jews & their fate'],['perpetrator','גרמנים ומשתפי פעולה / Germans & collaborators'],['other','אנשים נוספים / Additional people']];
      nmHtml=SECT.map(([k,title])=>{
        const g=nmShown.filter(p=>((p.category||'other').trim().toLowerCase()===k)||(k==='other'&&!['jew','perpetrator'].includes((p.category||'').trim().toLowerCase())));
        return g.length?`<div class="names-section"><div class="names-sub">${title} <span class="names-count">(${g.length})</span></div>${nmTable(g,COLS[k])}</div>`:'';
      }).join('');
    }
    if(nm.length>NM_PREVIEW)nmHtml+=`<p class="names-count">מוצגים ${nmShown.length} מתוך ${nm.length} שמות — דף הקטלוג נושא תצוגה מקדימה בלבד; הרשימה המלאה בקובץ.</p>`;
    const srvCsv=rec._names_csv?` <a class="mini-btn" style="text-decoration:none" href="${esc(serverBase()+'/api/output/'+encodeURIComponent(String(rec._names_csv).replace(/^output\//,'')))}" download>⬇ קובץ השמות מהשרת</a>`:'';
    nmHtml+=`<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="mini-btn" id="names-csv-btn">⬇ הורד קובץ שמות מלא (CSV · ${nm.length})</button>${srvCsv}</div>`;
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

  // שער אנושי (שכבה ה): הרשומה נולדת «טיוטה»; אישור מפורש לפני רישום בספיר.
  const appr=rec._approved;
  const apprBar=`<div class="pick-bar" style="gap:12px;margin-bottom:6px">`+
    `<span style="font-weight:700;font-size:13px;color:${appr?'var(--good)':'var(--warn)'}">${appr?('✔ אושר לרישום · '+esc(new Date(appr.at).toLocaleString('he-IL'))):'⚠ טיוטה — טרם אושר לרישום'}</span>`+
    `<button class="mini-btn" id="approve-rec" type="button">${appr?'בטל אישור':'✔ אשר לרישום'}</button>`+
    (!isIsa&&rec._trust!==''&&rec._trust!==undefined&&rec._trust!==null?`<span class="chip" title="ציון-אמינות מצרפי מהמנוע: שמות ודאיים, כיסוי-עמודים, ממצאי-בקרה">🎯 אמינות: ${esc(String(rec._trust))}/100</span>`:'')+
    `<span style="flex:1"></span>`+
    `<span class="pick-count">העתקה וייצוא מרשומת-טיוטה מציגים אזהרה</span>`+
  `</div>`;
  // ── רשומה במבנה ארכיון המדינה (tik_source=isa): שמות-שדות ומבנה כברשומות
  // archives.gov.il — שם הפריט, רמה, סוג הפריט, תיאור התיק, תקופת החומר
  // (DD/MM/YYYY, ‏01/01–31/12 כשידועה שנה בלבד), מזהים, סטטוס חשיפה ותגיות.
  const isaDateFmt=(d,end)=>{const s=String(d||'').trim();if(!s)return '';
    let m=s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if(m){const y=m[1],mo=m[2]?String(+m[2]).padStart(2,'0'):null,da=m[3]?String(+m[3]).padStart(2,'0'):null;
      if(da&&mo)return `${da}/${mo}/${y}`;
      if(mo){const last=new Date(+y,+mo,0).getDate();return end?`${last}/${mo}/${y}`:`01/${mo}/${y}`;}
      return end?`31/12/${y}`:`01/01/${y}`;}
    m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if(m)return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`;
    return s;};
  const _isaS=isaDateFmt(rec.date_authentic_start,false), _isaE=isaDateFmt(rec.date_authentic_end||rec.date_authentic_start,true);
  const isaRange=_isaS?`<span dir="ltr" style="unicode-bidi:isolate">${esc(_isaS===_isaE?_isaS:`${_isaS} - ${_isaE}`)}</span>`:'';
  const CORP_HE=/ארגון|אגוד|משרד|ממשלת|ועד|מועצ|חברת|בית[- ]ספר|תלמוד תורה|קופת|בית[- ]כנסת|יודנראט|תיאטרון|בנק|עיריי|קהיל/;
  // תגית "אישים" ברשומת ארכיון המדינה = נקודות-גישה מובחרות (אצלם ~3 לתיק שלם),
  // לא מפתח. לכן מדורגות לפי מרכזיות (מספר העמודים) ומוגבלות; הרשימה המלאה
  // נשארת במפתח השמות ובקובץ ה-CSV.
  const ISA_MAX_PERSON_TAGS=10,ISA_MAX_ORG_TAGS=10;
  const pageCount=p=>{const raw=String(p.source_pages||p.pages||'').replace(/\s/g,'');
    if(!raw)return 0;
    return raw.split(',').filter(Boolean).reduce((n,part)=>{
      const m=part.match(/^(\d+)-(\d+)$/);
      return n+(m&&+m[2]>=+m[1]?(+m[2]-+m[1]+1):1);},0);};
  const _isaEntries=nm.filter(p=>String(p.name||p.name_original||'').trim());
  // גופים: הרשימה הייעודית משלב-1 היא המקור הסמכותי; שמות "ארגוניים" שנקלטו
  // בטעות למפתח השמות מצטרפים אליה (רשומות ישנות שאין להן רשימה כזו).
  const _isaOrgsAll=[...new Set([
    ...(rec.organizations||[]).slice().sort((a,b)=>pageCount(b||{})-pageCount(a||{}))
        .map(o=>String((o&&o.name)||'').trim()).filter(Boolean),
    ..._isaEntries.map(p=>String(p.name||p.name_original).trim()).filter(n=>CORP_HE.test(n))])];
  const _isaOrgs=_isaOrgsAll.slice(0,ISA_MAX_ORG_TAGS);
  const _isaOrgsOmitted=Math.max(0,_isaOrgsAll.length-_isaOrgs.length);
  const _isaPeople=_isaEntries.filter(p=>!CORP_HE.test(String(p.name||p.name_original).trim()))
    .map(p=>({n:String(p.name||p.name_original).trim(),c:pageCount(p)}))
    .sort((a,b)=>b.c-a.c);
  let _isaCentral=[...new Set(_isaPeople.filter(p=>p.c>=2).map(p=>p.n))].slice(0,ISA_MAX_PERSON_TAGS);
  if(!_isaCentral.length)_isaCentral=[...new Set(_isaPeople.map(p=>p.n))].slice(0,ISA_MAX_PERSON_TAGS);
  const _isaOmitted=Math.max(0,new Set(_isaPeople.map(p=>p.n)).size-_isaCentral.length);
  const chipList=(a,hint)=>(a.length?a.map(x=>`<span class="chip">${esc(x)}</span>`).join(''):'<span class="none">—</span>')+
    (hint?`<div class="hint" style="margin-top:5px">${esc(hint)}</div>`:'');
  const isaMain=
    `<div class="section-bar">רשומת התיק — במבנה ארכיון המדינה</div>`+
    fieldBlock('שם הפריט'+conf(rec,'title'),'f-title',esc(rec.title))+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('רמה','f-isa-level','תיק')+
      fieldBlock('סוג הפריט','f-isa-itype','טקסטואלי')+
    `</div>`+
    fieldBlock('תיאור התיק','f-isa-desc',esc(isaDesc)||'<span class="none">—</span>')+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('תקופת החומר','f-isa-dates',isaRange||'<span class="none">— לא זוהה טווח מבוסס —</span>')+
      fieldBlock('מקור החומר (גוף מפקיד)','f-isa-depositor','<span class="none">— להשלמה על-ידי הארכיון —</span>')+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('מזהה פיזי','f-isa-physid','<span class="none">— סימול פיזי (למשל גל-1704/10) — להשלמה —</span>')+
      fieldBlock('מזהה לציטוט','f-isa-citeid','<span class="none">— מוקצה על-ידי ארכיון המדינה בעת הקליטה —</span>')+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('סטטוס חשיפה','f-isa-status','טרם נבדק')+
      fieldBlock('שפות','f-lang',langs)+
    `</div>`+
    isaRedactionsField(rec)+
    `<div class="section-bar">תגיות</div>`+
    fieldBlock('נושאים','f-subjects',subjHtml)+
    fieldBlock('אישים','f-isa-persons',chipList(_isaCentral,
      _isaOmitted?`הדמויות המרכזיות בתיק (לפי מספר העמודים שבהם הן מופיעות); ${_isaOmitted} שמות נוספים במפתח השמות המלא ובקובץ ה-CSV`
                 :'שנות חיים מופיעות רק כשנרשמו בתיק במפורש'))+
    fieldBlock('ארגונים','f-isa-orgs',chipList(_isaOrgs,
      _isaOrgsOmitted?`הגופים המרכזיים בתיק; ${_isaOrgsOmitted} גופים נוספים ברשומה המלאה`:''))+
    fieldBlock('מקומות','f-places',chipList((rec.related_places||[]).filter(Boolean)));
  const sapirMain=
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
    fieldBlock('הערת תוכן','f-cnote',esc(rec.content_note||'—'));
  // ── רשומה בשדות ספיר לאוסף יפה אליאך (tik_source=eliach): כותר, צורה, אופי
  // חומר, שפה, מקומות קשורים — וה"מידע נוסף" (התיאור המפורט) בשדה המשותף שמתחת.
  // צורה: רק אם המקטלגת ציינה במידע-המוקדם ("צורה: קסרוקס"); אחרת ערכי הרשימה
  // הסגורה מוצעים בלבד (never-invent). אופי חומר: מהאינוונטר, הדומיננטי תחילה.
  const elForm=(()=>{const t=(($('context').value||'')+'\n'+(state.intakeText||''));
    const m=t.match(/(?:^|[^א-ת])צורה\s*:\s*([^\n;.]+)/);return m?m[1].trim():'';})();
  const elNature=(()=>{const cnt={};
    inv.forEach(d=>{const ty=String(d.doc_type||'').trim();if(!ty)return;
      cnt[ty]=(cnt[ty]||0)+Math.max(1,pageCount(d));});
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).map(([ty])=>ty);})();
  const eliachMain=
    `<div class="section-bar">רשומת התיק — אוסף יפה אליאך (שדות ספיר)</div>`+
    fieldBlock('כותר'+conf(rec,'title'),'f-title',esc(rec.title))+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('צורה','f-el-form',elForm?esc(elForm):chipList(['קסרוקס','תצלום'],
        'לא נקבע אוטומטית — בספיר נבחר מהרשימה הסגורה; ניתן לקבוע מראש במידע-המוקדם: "צורה: קסרוקס"'))+
      fieldBlock('אופי חומר','f-el-nature',chipList(elNature,
        'לפי מפת המסמכים, הדומיננטי תחילה — בספיר נבחר מהרשימה הסגורה (יומן/עדות/כרזה וכו\')'))+
    `</div>`+
    `<div class="row2" style="gap:10px">`+
      fieldBlock('שפה','f-lang',langs)+
      fieldBlock('מקומות קשורים','f-places',chipList((rec.related_places||[]).filter(Boolean),
        'בספיר נבחרים מרשימת המקומות הסגורה (אנגלית, גבולות 1.9.1939)'))+
    `</div>`;
  $('record').innerHTML=
    apprBar+
    `<div class="pick-bar">`+
      `<button class="btn" id="copy-picked" type="button">📋 העתק את השדות המסומנים</button>`+
      `<span class="pick-count" id="pick-count"></span>`+
      `<span style="flex:1"></span>`+
      `<button class="mini-btn" id="pick-all" type="button">סמן הכל</button>`+
      `<button class="mini-btn" id="pick-none" type="button">נקה הכל</button>`+
    `</div>`+
    (isEliach?eliachMain:isIsa?isaMain:sapirMain)+

    testimonySectionsHtml(rec)+

    `<div class="section-bar">${isIsa?'מידע פנימי נוסף (לא חלק מרשומת ארכיון המדינה)':'מידע נוסף'}</div>`+
    fieldBlock(isIsa?'מידע נוסף · פנימי':'מידע נוסף (להדבקה לספיר)','f-info',info.trim()||'<span class="none">—</span>')+
    (infoHist.trim()?fieldBlock(rec._tik_source==='private'?'הקשר היסטורי · פנימי (ידע-רקע — לא מהתיק)':'הקשר היסטורי','f-info-hist',infoHist.trim()):'')+

    privateSectionsHtml(rec)+

    `<div class="section-bar">יהלומים — מסמכים לרישום פרטני</div>`+
    `<div class="field"><div class="body">${dia}</div></div>`+

    `<div class="section-bar">אינוונטר מסמכים — מפת התיק</div>`+
    fieldBlock('אינוונטר מסמכים','f-inv',invHtml)+
    deepBlocks+
    subItemBlocks+
    (hierarchyTreeHtml(rec)?`<div class="section-bar">היררכיית הפריט — תת-אוסף ← כרך ← פריטי-משנה</div>`+
      fieldBlock('היררכיה','f-hier',hierarchyTreeHtml(rec)):'')+

    `<div class="section-bar">מפתח שמות — להזנת מאגר שמות הקורבנות</div>`+
    fieldBlock('מפתח שמות','f-names',nmHtml)+

    `<div class="section-bar">ציר זמן ביוגרפי</div>`+
    fieldBlock('ציר זמן','f-timeline',tlHtml)+

    (isIsa?'':`<div class="section-bar">נושאים — תזאורוס</div>`+
    fieldBlock('נושאים','f-subjects',subjHtml));
  const apBtn=document.getElementById('approve-rec');
  if(apBtn)apBtn.onclick=()=>{
    const r=state.lastRecord||rec;
    if(r._approved)delete r._approved;else r._approved={at:new Date().toISOString()};
    renderRecord(r,false); // הסטטוס נשמר עם הרשומה (שרידות-רענון)
  };
  const ncb=document.getElementById('names-csv-btn');
  if(ncb)ncb.onclick=()=>{
    const r=state.lastRecord||rec;
    downloadBlob(new Blob([buildNamesCsv(r.names_index||[])],{type:'text/csv;charset=utf-8'}),tikStem()+'_names.csv');
  };
  // דף-המקטלג הסופי נקי כברירת-מחדל: שדות-הבקרה הפנימיים אינם מסומנים,
  // ולכן אינם נכנסים לדף-ההעתקה ול"העתק מסומנים" (הדף עצמו מציג אותם כרגיל).
  // בתיק פרטי גם "הקשר היסטורי" פנימי — נוהל מיכאל אוסר ידע-רקע במידע-הנוסף.
  (rec._tik_source==='private'?[...PRIVATE_INTERNAL_FIDS,'f-info-hist']:PRIVATE_INTERNAL_FIDS).forEach(fid=>{
    const cb=document.querySelector(`.field-pick[data-fid="${fid}"]`);
    if(cb)cb.checked=false;
    const f=document.querySelector(`.field[data-field="${fid}"]`);
    if(f)f.classList.add('unpicked');
  });

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
  document.querySelectorAll('.deep-btn:not(.item-btn):not(.subitem-del):not(.type-items-btn)').forEach(b=>{
    b.addEventListener('click',()=>deepDescribeTestimony(b));
  });
  // bind "צור פריט ממקטע" + "פריט לכל סוג חומר" + עריכת/הסרת פריטי-משנה (TR.15)
  document.querySelectorAll('.item-btn').forEach(b=>{
    b.addEventListener('click',()=>createSubItem(+b.getAttribute('data-idx')));
  });
  document.querySelector('.type-items-btn')?.addEventListener('click',createTypeItems);
  document.querySelectorAll('.subitem-del').forEach(b=>{
    b.addEventListener('click',()=>{
      const r=state.lastRecord;if(!r||!Array.isArray(r.sub_items))return;
      const del=+b.getAttribute('data-si');
      r.sub_items.splice(del,1);
      // קישורי "נלווה" מוחזקים באינדקסים — מתקנים אחרי ההסרה: קישור אל
      // הפריט שנמחק מתבטל, קישור אל פריט מאוחר ממנו זז אחורה.
      r.sub_items.forEach(s=>{
        if(!Number.isInteger(s.related))return;
        if(s.related===del)delete s.related;
        else if(s.related>del)s.related--;
      });
      renderRecord(r,false);
    });
  });
  // קישור "פריט נלווה" (עדות↔תרגום — אותו אדם, אותו כרך): דו-כיווני
  document.querySelectorAll('.subitem-rel').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const r=state.lastRecord,i=+sel.getAttribute('data-si');
      if(!r||!r.sub_items||!r.sub_items[i])return;
      const old=r.sub_items[i].related;
      if(Number.isInteger(old)&&r.sub_items[old]&&r.sub_items[old].related===i)delete r.sub_items[old].related;
      if(sel.value===''){delete r.sub_items[i].related;}
      else{const j=+sel.value;r.sub_items[i].related=j;if(r.sub_items[j])r.sub_items[j].related=i;}
      renderRecord(r,false);
    });
  });
  document.querySelectorAll('.subitem-title').forEach(el=>{
    el.addEventListener('blur',()=>{
      const r=state.lastRecord,i=+el.getAttribute('data-si');
      if(r&&r.sub_items&&r.sub_items[i]){r.sub_items[i].title=el.innerText.trim();persistTikRecord();}
    });
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
  // refresh-survival: a synthesized record is 15-40 min of model work, so it is
  // persisted here (with the chunk notes when they fit) and a refresh restores
  // it. This is the tik screen's OWN localStorage copy — the generic autosave
  // was removed 2026-07-26 and never covered this div anyway (no [id] fields).
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
    clone.querySelectorAll('.cv,.ch,.cmark').forEach(el=>el.remove());
    fields.push({label:lb.innerText.trim(), html:stripCertMarks(clone.innerHTML), hasTable:!!clone.querySelector('table')});
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
/* שער אנושי (שכבה ה): כפתורי הייצוא והעתקת-המסומנים מזהירים כשרשומה בטיוטה.
   מאזין בשלב-capture כדי לעצור את ה-handler הרגיל אם המקטלגת ביטלה. */
const draftGuard=ev=>{
  const b=ev.target.closest('button'); if(!b)return;
  if(b.id==='approve-rec'||b.classList.contains('deep-btn'))return;
  const rec=state.lastRecord;
  if(rec&&!rec._approved&&!confirm('הרשומה בסטטוס «טיוטה» — טרם אושרה לרישום (כפתור «אשר לרישום» מעל הרשומה). להמשיך בכל זאת?')){
    ev.stopImmediatePropagation();ev.preventDefault();
  }
};
const exBar=document.getElementById('tik-export-bar');
if(exBar)exBar.addEventListener('click',draftGuard,true);
$('record').addEventListener('click',ev=>{
  if(ev.target.closest('#copy-picked'))draftGuard(ev);
},true);

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
/* קובץ-השמות הנפרד: הרשימה המלאה יוצאת מדף הקטלוג לקובץ CSV (החלטת משתמש
   23.7.2026) — UTF-8-BOM ל-Excel + מגן-נוסחאות (=+-@) עבור הקלדנית. */
function buildNamesCsv(names){
  const safe=v=>{let s=String(v==null?'':v).replace(/<[^>]+>/g,'').trim();
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const CAT={jew:'יהודי/ה',perpetrator:'גרמני/משתף-פעולה',other:'אחר'};
  const L=[['שם','כתיב מקורי','סיווג','תפקיד/קרבה','פשעים','לידה','פטירה','מקום','גורל','דפים','ודאות קריאה'].join(',')];
  (names||[]).filter(p=>p&&(p.name||p.name_original)).forEach(p=>L.push([
    p.name,p.name_original,CAT[(p.category||'').trim().toLowerCase()]||p.category||'',
    p.role,p.crimes,p.birth,p.death,p.place,p.fate,p.source_pages,p.confidence
  ].map(safe).join(',')));
  return '﻿'+L.join('\n');
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
    const r=await fetch(serverBase()+'/api/export-xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record:cleanRecForExport(rec),filename:stem})});
    if(!r.ok){let e={};try{e=await r.json();}catch{}throw new Error(e.error||('שרת HTTP '+r.status));}
    downloadBlob(await r.blob(),stem+'.xlsx');
    showStatus(`✓ הורד Excel: ${stem}.xlsx`,'ok');
  }catch(err){
    // No server (e.g. Pages) or endpoint down → CSV fallback that opens in Excel.
    downloadBlob(new Blob([recordToCsv(cleanRecForExport(rec))],{type:'text/csv;charset=utf-8'}),stem+'.csv');
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
    let img;
    try{img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('decode'));im.src=url;});}
    catch(e){throw await decodeFailure(file);}
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
  // Overlaps file reads — the dominant cost on cloud-mounted scans (3.8.2026:
  // measured ~60s PER PAGE off the Google Drive mount, and throughput scaled
  // ~linearly with concurrency, so the pool is the only lever). Full-quality
  // pages hold bigger bitmaps than the describe path, hence 8 and not 12.
  const pages=new Array(imgs.length);
  let built=0;
  const POOL=Math.min(8,imgs.length);
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
      return `${CHUNK_EXTRACT_RULES}${testimonyChunkExtra()}${coverage}${tilingNote}${contextBlock()}`;
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
    if(final&&typeof final==='object'){final._tik_source=tikSource();final._tik_kind=(tikSource()==='institutional'?tikKind():'');} // הרשומה זוכרת את סוגה (שרידות-רענון)
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
      // decode/encode. Order is preserved via index assignment. Decode runs on
      // the main thread anyway, so a wider pool only overlaps READS — which is
      // the whole cost off a cloud mount (3.8.2026: ~60s/page via Google Drive,
      // 12 concurrent reads gave ~11x throughput). 12 bitmaps at 1100px is cheap.
      const pages=new Array(imgs.length);
      let built=0;
      const POOL=Math.min(12,imgs.length);
      const t0=Date.now();
      await Promise.all(Array.from({length:POOL},async(_,k)=>{
        for(let i=k;i<imgs.length;i+=POOL){
          pages[i]=await pdfPageFor(imgs[i],1100,0.55);
          built++;
          // Reading off a cloud mount is orders of magnitude slower than local
          // disk; say so instead of letting a 90-minute build look like a hang.
          const perPage=(Date.now()-t0)/built/1000;
          const slow=perPage>3?` · ⚠ ${perPage.toFixed(1)} שנ׳ לעמוד — הקבצים כנראה נקראים מהענן; העתקת התיקייה לדיסק המקומי תקצר את זה מאוד`:'';
          showStatus(`<span class="spinner"></span>תיאור מהיר · בונה PDF מוקטן לתיאור… ${built}/${imgs.length}${slow}`,'info');
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
    const prompt=`${schemaRules()}${privateRulesBlock()}${isaRulesBlock()}${eliachRulesBlock()}\n\n⚠ Gemini כבר קרא את **כל דפי התיק** וחילץ עובדות גולמיות (יצורפו בהמשך ההודעה). תפקידך כהיסטוריון ארכיוני: לסנתז מהן **רשומת-תיק אחת ברמת תיאור** — מפת המסמכים, היקף, מקומות ותקופה, אנשים מרכזיים, ויהלומים — עם **הקשר היסטורי מעמיק ומדויק**. עגן כל קביעה בעובדות בלבד (אל תמציא), והבחן בבירור בין מה שמתועד בתיק לבין ידע היסטורי כללי. החזר field_confidence (✓/~/?) לכל שדה, ו-review_flags לכל הסקה/אי-ודאות/פער שדורש אימות ארכיונאי. **לא** תמלול דף-דף ולא רשימת כל שם בכל דף.${contextBlock()}${thesaurusBlock()}\n\nהחזר JSON סופי בלבד.`;
    // shared non-file fields — the finalize of a chunked upload sends them without the blob.
    // context is written server-side as the standard <pdf>.context.txt sidecar.
    const fields={prompt,context:[$('context').value.trim(),(state.intakeText||'').trim()].filter(Boolean).join('\n\n')};
    fields.tik_source=tikSource();   // מוסדי/פרטי — עובר למנוע (YV_TIK_SOURCE)
    fields.tik_kind=tikSource()==='institutional'?tikKind():'';   // סוג-החומר המוסדי (YV_TIK_KIND)
    if(window.yvFlow)fields.reader=yvFlow.current('documents-tik');   // אוטומטי / Claude / Gemini
    if(window.yvFlow&&yvFlow.backend)fields.backend=yvFlow.backend('documents-tik');   // Claude: מנוי / API
    const t=Date.now();
    // XHR (not fetch) so the archivist sees upload progress — a big tik through the
    // Cloudflare tunnel uploads at ~0.5MB/s, and a silent spinner reads as a hang.
    const xhrPost=(url,body,onPct)=>new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST',url);
      // Session header (CSRF, review 2026-07-23): XHR bypasses the yv-client-log
      // fetch wrapper, so set it here or production 403s the tik/upload-chunk POST.
      try{const sid=sessionStorage.getItem('yvSessionId');if(sid)xhr.setRequestHeader('x-yv-session',sid);}catch(e){}
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
    // Persist the running job so a tab-freeze / reload can RESUME it (26.7.2026:
    // Chrome froze the background tab 17 min before the job finished — the ✓
    // never reached the screen and the run looked stuck forever).
    try{localStorage.setItem('yv-tik-last-job',JSON.stringify({id:jobId,at:Date.now()}));}catch(e){}
    return await pollTikJob(jobId,t);
  }catch(err){console.error(err);showStatus('שגיאה בתיאור מהיר: '+esc(err.message),'err');}
  finally{$('run').disabled=false;$('describe-fast').disabled=false;}
  return false;
}

// Poll until the SERVER resolves the job (done/error). The server self-resolves
// via its own watchdogs (idle-based engine kill + bounded model calls), so we
// keep waiting as long as the job shows PROGRESS: the 90-min window slides —
// it resets whenever a new engine event arrives, and only a genuinely silent
// stretch aborts (a huge tik legitimately runs hours). Each poll is a quick
// GET, so the Cloudflare ~100s limit never bites. Shared by fastDescribe AND
// the resume-on-load path (tab-freeze recovery, 26.7.2026).
async function pollTikJob(jobId,t){
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
        try{localStorage.removeItem('yv-tik-last-job');}catch(e){}
        const fastRec=parseJson(j.text,'Claude');
        if(fastRec&&!fastRec._tik_source)fastRec._tik_source=tikSource(); // רשומת מנוע ישן — חתום מהבורר
        if(fastRec&&!fastRec._tik_kind)fastRec._tik_kind=(tikSource()==='institutional'?tikKind():'');
        renderRecord(fastRec);
        maybeOfferEntrySheet();
        const split=(j.geminiSec&&j.claudeSec)?`Gemini ${j.geminiSec}שׄ + Claude ${j.claudeSec}שׄ`:(j.model||'Gemini+Claude');
        showStatus(`✓ תיאור הושלם תוך ${j.elapsedSec||Math.round((Date.now()-t)/1000)} שׄ (${split}). בדוק את נקודות הבדיקה ו-review_flags לפני הדבקה לספיר.`,'ok');
        $('results').scrollIntoView({behavior:'smooth'});
        return true;
      }
      if(j.status==='error'){
        try{localStorage.removeItem('yv-tik-last-job');}catch(e){}
        if(j.prohibited){showStatus('⚠ Gemini סירב לקרוא את התיק (חומר רגיש). עבור למצב "Claude בלבד" והרץ "קטלג תיק".','err');return false;}
        throw new Error(j.error||'תיאור נכשל');
      }
    }
    throw new Error('לא התקבלה שום התקדמות מהשרת במשך 90 דקות — ייתכן שהשרת נתקע או שהחיבור נותק. בדוק את מסך ההפעלות (logs.html) לפני ניסיון חוזר.');
}

// Resume after a reload / tab-freeze (26.7.2026): if the last launched tik job is
// still running — keep following it; if it finished while the tab was frozen —
// load the finished record from the server instead of showing a dead spinner.
(async()=>{
  let last=null;
  try{last=JSON.parse(localStorage.getItem('yv-tik-last-job')||'null');}catch(e){}
  if(!last||!last.id||Date.now()-(last.at||0)>6*60*60*1000)return;
  let j=null;
  try{const pr=await fetch(serverBase()+'/api/tik-describe/'+last.id);if(pr.ok)j=await pr.json();}catch(e){}
  if(!j||!j.status){return;}
  if(j.status==='done'){
    try{localStorage.removeItem('yv-tik-last-job');}catch(e){}
    const rec=parseJson(j.text,'Claude');
    if(rec){
      state.outputName=j.outputName||null;
      if(!rec._tik_source)rec._tik_source=tikSource();
      if(!rec._tik_kind)rec._tik_kind=(tikSource()==='institutional'?tikKind():'');
      renderRecord(rec);
      maybeOfferEntrySheet();
      showStatus('✓ הקטלוג הושלם בזמן שהמסך לא היה פעיל — הרשומה נטענה מהשרת. בדוק את נקודות הבדיקה לפני הדבקה לספיר.','ok');
    }
  }else if(j.status==='running'||j.status==='queued'){
    showStatus('<span class="spinner"></span>ממשיך לעקוב אחרי קטלוג-תיק שכבר רץ בשרת…','info');
    try{await pollTikJob(last.id,last.at||Date.now());}
    catch(err){showStatus('שגיאה בקטלוג שחודש: '+esc(err.message),'err');}
  }else{
    try{localStorage.removeItem('yv-tik-last-job');}catch(e){}
  }
})();

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
const PERSIST=['engine-mode','key-gemini','model-gemini','model-claude','server-url','chunk-size','img-edge','tiling','tik-source','tik-kind'];
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
  syncTikSourceUI();
  setSaveState('🔒 הגדרות נטענו מהמכשיר','var(--good)');
}
/* בורר סוג-החומר המוסדי מוצג רק כשנבחרו "מקורות מוסדיים" */
function syncTikSourceUI(){
  const w=document.getElementById('tik-kind-wrap');
  if(w)w.style.display=tikSource()==='institutional'?'block':'none';
}
{const ts=document.getElementById('tik-source');if(ts)ts.addEventListener('change',syncTikSourceUI);}
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
// Direct multi-PDF selection (drag or file picker, no folder): ≥2 PDFs = a
// BATCH of tiks — route to the queue (one tik per PDF, processed sequentially),
// mirroring the CLI semantics of a folder of PDFs. A single PDF or a set of
// page scans keeps the classic single-tik flow.
function addFilesOrEnqueue(list){
  const pdfs=Array.from(list).filter(f=>/\.pdf$/i.test(f.name));
  if(pdfs.length>=2)enqueueFolderSelection(list);
  else addFiles(list);
}
const drop=$('drop');
$('file-input').addEventListener('change',e=>{addFilesOrEnqueue(e.target.files);e.target.value='';});
$('folder-input').addEventListener('change',e=>{
  if(!e.target.files.length){alert('לא נבחרו קבצים.');return;}
  enqueueFolderSelection(e.target.files);e.target.value='';
});
$('clear-files').addEventListener('click',()=>{state.files=[];renderFiles();});
$('chunk-size').addEventListener('change',renderFiles);
$('tiling').addEventListener('change',renderFiles);
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');addFilesOrEnqueue(e.dataTransfer.files);});

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
/* ---------- ☁ tik straight off Google Drive (server downloads, then catalogs) ---------- */
// Reading scans through the Drive mount costs ~60s PER FILE (measured 3.8.2026),
// so a 193-page tik spent 45 minutes just being read into this page before the
// engine saw anything. Here the SERVER fetches the folder with rclone (~15x
// faster, straight off the API) and hands the folder to the engine — no mount
// reads, no client-side PDF build, no upload. The job polls exactly like the
// upload path, so results render identically.
state.drivePath='';
async function driveLoad(sub){
  const list=$('drive-list');
  list.innerHTML='<div style="padding:8px;color:var(--muted)"><span class="spinner"></span> טוען מהדרייב…</div>';
  $('drive-path').textContent=sub?`/${sub}`:'(שורש)';
  try{
    const r=await fetch(`${serverBase()}/api/drive-tiks?path=${encodeURIComponent(sub)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||`שרת HTTP ${r.status}`);
    state.drivePath=sub;
    $('drive-up').style.display=sub?'':'none';
    if(!d.folders.length&&!d.scanCount){list.innerHTML='<div style="padding:8px;color:var(--muted)">התיקייה ריקה.</div>';return;}
    const rows=d.folders.map((f,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px dashed color-mix(in srgb, var(--muted) 30%, transparent);font-size:12.5px;flex-wrap:wrap">
      <button type="button" class="copy-btn" data-into="${i}" style="padding:2px 9px;font-size:11.5px;background:transparent;color:var(--fg);border:1px solid var(--muted)" title="כניסה לתיקייה">📂</button>
      <b style="unicode-bidi:isolate">${esc(f.name)}</b>
      <span style="margin-inline-start:auto;display:flex;gap:6px">
        <button type="button" class="copy-btn" data-run="${i}" style="padding:2px 9px;font-size:11.5px;background:var(--good);color:#06210f" title="הורדת התיקייה לדיסק וקטלוגה">קטלג תיק זה</button>
        <button type="button" class="copy-btn" data-q="${i}" style="padding:2px 9px;font-size:11.5px" title="הכנסת כל תת-התיקיות שבתוכה לתור התיקים">הוסף הכל לתור</button>
      </span></div>`).join('');
    const here=d.scanCount?`<div style="padding:6px;font-size:12.5px;border-bottom:1px solid color-mix(in srgb, var(--muted) 30%, transparent)">
      📄 ${d.scanCount} סריקות ישירות בתיקייה הזו
      <button type="button" class="copy-btn" data-run-here="1" style="padding:2px 9px;font-size:11.5px;background:var(--good);color:#06210f;margin-inline-start:8px">קטלג את התיקייה הזו</button></div>`:'';
    list.innerHTML=here+rows;
    const at=i=>sub?`${sub}/${d.folders[i].name}`:d.folders[i].name;
    list.querySelectorAll('[data-into]').forEach(b=>b.addEventListener('click',()=>driveLoad(at(+b.dataset.into))));
    list.querySelectorAll('[data-run]').forEach(b=>b.addEventListener('click',()=>driveRunOne(at(+b.dataset.run))));
    list.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>driveEnqueueAll(at(+b.dataset.q))));
    list.querySelectorAll('[data-run-here]').forEach(b=>b.addEventListener('click',()=>driveRunOne(sub)));
  }catch(e){list.innerHTML=`<div style="padding:8px;color:var(--error)">${esc(e.message)}</div>`;}
}
// Catalog ONE Drive folder now. Returns true when a record was produced — same
// contract as fastDescribe(), so the queue can drive it.
async function driveDescribe(drivePath){
  try{serverBase();}catch(e){showStatus(esc(e.message),'err');return false;}
  const t=Date.now();
  try{
    showStatus(`<span class="spinner"></span>☁ ${esc(drivePath)} — השרת מוריד מהדרייב…`,'info');
    const body={path:drivePath,
      context:[$('context').value.trim(),(state.intakeText||'').trim()].filter(Boolean).join('\n\n'),
      tik_source:tikSource(),tik_kind:tikSource()==='institutional'?tikKind():''};
    if(window.yvFlow)body.reader=yvFlow.current('documents-tik');
    if(window.yvFlow&&yvFlow.backend)body.backend=yvFlow.backend('documents-tik');
    const r=await fetch(`${serverBase()}/api/drive-tiks/catalog`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok||!d.jobId)throw new Error(d.error||`שרת HTTP ${r.status}`);
    try{localStorage.setItem('yv-tik-last-job',JSON.stringify({id:d.jobId,at:Date.now()}));}catch(e){}
    return await pollTikJob(d.jobId,t);
  }catch(err){console.error(err);showStatus('שגיאה בקטלוג מהדרייב: '+esc(err.message),'err');return false;}
}
async function driveRunOne(drivePath){
  if(state.queueRunning){showStatus('התור רץ כרגע — המתן לסיומו.','err');return;}
  $('drive-panel').style.display='none';
  await driveDescribe(drivePath);
}
// A parent folder (e.g. M46) → every tik inside it joins the existing queue.
async function driveEnqueueAll(parent){
  try{
    const r=await fetch(`${serverBase()}/api/drive-tiks?path=${encodeURIComponent(parent)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||`שרת HTTP ${r.status}`);
    if(!d.folders.length){showStatus(`אין תת-תיקיות ב-«${esc(parent)}» — השתמש ב«קטלג תיק זה».`,'err');return;}
    d.folders.forEach(f=>state.queue.push({name:f.name,files:[],drivePath:`${parent}/${f.name}`,status:'pending'}));
    $('drive-panel').style.display='none';
    renderQueue();
    showStatus(`נוספו ${d.folders.length} תיקים מהדרייב לתור (${state.queue.length} סה״כ) — לחץ «⚡ תיאור מהיר» או «קטלג תיק» כדי להריץ.`,'ok');
  }catch(e){showStatus('שגיאה בקריאת הדרייב: '+esc(e.message),'err');}
}
$('pick-drive').addEventListener('click',()=>{
  const p=$('drive-panel');
  if(p.style.display==='block'){p.style.display='none';return;}
  p.style.display='block';driveLoad('');
});
$('drive-close').addEventListener('click',()=>{$('drive-panel').style.display='none';});
$('drive-up').addEventListener('click',()=>driveLoad(state.drivePath.split('/').slice(0,-1).join('/')));

function enqueueFolderSelection(list){
  const groups=tikGroupsOf(list);
  if(!groups.length){alert('לא נמצאו קבצים נתמכים (PDF / JPG / PNG / TIFF / WEBP).');return;}
  // תור משוחזר ממתין לקבצים → הבחירה הזו מתאחה אליו במקום להוסיף כפילויות.
  if(state.queue.some(q=>q.needsFiles)){
    const hit=reattachFiles(groups);
    if(hit){
      renderQueue();
      const left=state.queue.filter(q=>q.needsFiles).length;
      showStatus(`אוחו ${hit} תיקים לתור המשוחזר`+(left?` · ${left} עדיין ממתינים לקבצים.`:' — התור מוכן להרצה, ומה שכבר קוטלג לא ירוץ שוב.'),'ok');
      return;
    }
  }
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
  // ⏸ בזמן ריצה · ▶ כשיש ממתינים ואינו רץ · מוסתר כשאין מה לעשות איתו
  const pb=$('tik-queue-pause');
  if(state.queueRunning){
    pb.style.display='';pb.textContent=state.queuePaused?'⏸ ייעצר בתום התיק…':'⏸ עצור אחרי התיק הנוכחי';
    pb.disabled=!!state.queuePaused;
  }else{
    pb.disabled=false;pb.style.display=c.pending?'':'none';pb.textContent='▶ המשך התור';
  }
  saveQueue();
  let base='';try{base=serverBase();}catch(e){}
  const icon=q=>q.status==='running'?'<span class="spinner"></span>'
    :q.status==='done'?'<span style="color:var(--good)">✓</span>'
    :q.status==='error'?'<span style="color:var(--error)">✗</span>':'⏳';
  // מצב-השרת (מוזן מפס-«☁»): שם-שורה בדפדפן הוא <סריקה>_<תיק> — היפוך של
  // שם תיקיית-הדרייב — לכן בודקים את שני הכיוונים. שורה שקוטלגה בשרת מקבלת
  // ✓ וקישור במקום "צריך בחירה מחדש"; שורה שרצה עכשיו מקבלת שעון-ריצה חי.
  const srv=window.__serverTikStatus||{doneBy:{},runFolder:'',runStart:0};
  const srvKey=n=>{const p=String(n||'').trim().split('_');
    const rev=p.length===2?`${p[1]}_${p[0]}`:'';
    return srv.doneBy[n]?n:(rev&&srv.doneBy[rev]?rev:'');};
  const srvRunning=n=>{const p=String(n||'').trim().split('_');
    const rev=p.length===2?`${p[1]}_${p[0]}`:'';
    return srv.runFolder&&(srv.runFolder===n||srv.runFolder===rev);};
  $('tik-queue-list').innerHTML=state.queue.map((q,i)=>{
    // A Drive item carries no File objects — the server fetches it — so describe
    // it by origin instead of by local byte count.
    const sk=srvKey(q.name);
    const what=srvRunning(q.name)?`<span style="color:var(--brand)"><span class="spinner"></span> רץ בשרת עכשיו · <span class="srv-clock" data-start="${srv.runStart}">—</span></span>`
      :sk?`<span style="color:var(--good)">✓ קוטלג בשרת · <a href="#" class="srv-open-cat" data-out="${esc(srv.doneBy[sk].out)}" data-name="${esc(sk)}" style="color:var(--good);font-weight:700">⚙ פתח בקטלוג</a> · <a href="/api/output/${encodeURIComponent(srv.doneBy[sk].out)}" target="_blank" style="color:var(--good)">רשומה</a> · <a href="#" class="srv-xlsx" data-out="${esc(srv.doneBy[sk].out)}" data-stem="${esc(sk)}" style="color:var(--good)">📊 Excel</a> · <a href="#" class="srv-print" data-out="${esc(srv.doneBy[sk].out)}" style="color:var(--good)">🖨 PDF</a></span>`
      :q.drivePath?'☁ מהדרייב'
      :q.needsFiles?`<span style="color:var(--error)">⚠ צריך בחירה מחדש (${(q.savedNames||[]).length} קבצים)</span>`
      :(q.files.length===1&&/\.pdf$/i.test(q.files[0].name))?'PDF':`${q.files.length} דפים`;
    const mb=(q.drivePath||q.needsFiles)?'':` · ${(q.files.reduce((s,f)=>s+f.size,0)/1024/1024).toFixed(1)}MB`;
    const acts=[];
    if(q.status==='done'&&q.rec)acts.push(`<button type="button" class="copy-btn" data-show="${i}" style="padding:2px 9px;font-size:11.5px" title="הצגת רשומת התיק הזה במסך (הרשומות של שאר התיקים נשארות שמורות בתור)">הצג</button>`);
    if(q.status==='done'&&q.outputName&&base)acts.push(`<a href="${base}/api/output/${encodeURIComponent(q.outputName)}" style="font-size:11.5px" title="הורדת קובץ הרשומה שנשמר בשרת">⬇ קובץ</a>`);
    // ✕ ליד כל תיק שאינו רץ (בקשת משתמש 10.8) — גם שנכשל וגם שהסתיים; הסרת
    // שורה מהתור אינה מוחקת רשומה שנשמרה בשרת.
    if(q.status!=='running')acts.push(`<button type="button" class="copy-btn" data-del="${i}" style="padding:2px 9px;font-size:11.5px;background:var(--error);color:#fff" title="הסרה מהתור (רשומה שנשמרה בשרת אינה נמחקת)">✕</button>`);
    const err=q.status==='error'?` <span style="color:var(--error);font-size:11px" title="${esc(q.error||'')}">— ${esc(String(q.error||'נכשל').slice(0,90))}</span>`:'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px dashed color-mix(in srgb, var(--muted) 30%, transparent);font-size:12.5px;flex-wrap:wrap">
      <span style="width:18px;text-align:center;flex:none">${icon(q)}</span>
      <b>${i+1}. ${esc(q.name)}</b>
      <span style="color:var(--muted)">${what}${mb}</span>${err}
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
  state.files=(q.files||[]).slice();renderFiles();
  state.chunkNotes=Array.isArray(q.notes)?q.notes:[];
  state.outputName=q.outputName||null;
  renderRecord(q.rec,true);   // restored=true: don't overwrite the refresh-survival snapshot
  showStatus(`מוצגת רשומת התיק «${esc(q.name)}» מהתור — שאר הרשומות נשארות שמורות ברשימת התור.`,'ok');
  $('results').scrollIntoView({behavior:'smooth'});
}
/* ---------- עצירה ושמירה של התור ----------
   התור חי בדפדפן, אז עד היום רענון/סגירה איבדו אותו, ולא הייתה דרך לעצור
   באמצע בלי להרוג את התיק הרץ. שתי היכולות משלימות זו את זו:
   ⏸ עוצר *אחרי* התיק הנוכחי (התיק הרץ ממשיך בשרת עד סופו — לא מאבדים עבודה),
   והרשימה נשמרת ל-localStorage כדי שאפשר יהיה להמשיך מחר.
   מה נשמר: שם, מצב, נתיב-דרייב, ושמות הקבצים. תוכן הקבצים לא — אובייקטי File
   של הדפדפן לא שורדים רענון, ואחסון מאות מגה-בייט של סריקות היה מנפח את
   המכשיר. פריט-דרייב חוזר מוכן-לריצה; פריט-העלאה מסומן «צריך בחירה מחדש»
   ומתאחה לפי שם הקובץ ברגע שבוחרים את אותה תיקייה — עם המצב שלו, כך שמה
   שכבר קוטלג לא ירוץ שוב. */
const QUEUE_KEY='yv-tik-queue-v1';
function saveQueue(){
  try{
    if(!state.queue.length){localStorage.removeItem(QUEUE_KEY);return;}
    localStorage.setItem(QUEUE_KEY,JSON.stringify({
      at:Date.now(),mode:state.lastQueueMode||'fast',
      items:state.queue.map(q=>({
        name:q.name,drivePath:q.drivePath||null,
        // 'running' never survives — a reload means that run is no longer ours.
        status:q.status==='running'?'pending':q.status,
        fileNames:(q.files||[]).map(f=>f.name),
        outputName:q.outputName||null,error:q.error||null}))}));
  }catch(e){/* מכסת אחסון / מצב פרטי — התור פשוט לא נשמר */}
}
function restoreQueue(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(QUEUE_KEY)||'null');}catch(e){}
  if(!saved||!Array.isArray(saved.items)||!saved.items.length)return;
  state.lastQueueMode=saved.mode||'fast';
  state.queue=saved.items.map(it=>({
    name:it.name,drivePath:it.drivePath||undefined,files:[],
    status:it.status,needsFiles:!it.drivePath&&it.status==='pending',
    savedNames:it.fileNames||[],outputName:it.outputName||null,error:it.error||null}));
  renderQueue();
  const need=state.queue.filter(q=>q.needsFiles).length;
  showStatus(`שוחזר תור שמור מ-${new Date(saved.at).toLocaleString('he-IL')} — ${state.queue.length} תיקים`
    +(need?`. ${need} מהם הועלו מהמחשב: בחר שוב את אותה תיקייה («📁 העלה תיקייה שלמה») והקבצים יתאחו לפי שם, בלי להריץ מחדש את מה שכבר קוטלג.`:'.'),'ok');
}
// Re-attach uploaded files to a restored queue: match by the saved file names,
// so a restored item keeps its status (done stays done → never re-catalogued).
function reattachFiles(groups){
  let hit=0;
  for(const g of groups){
    const q=state.queue.find(x=>x.needsFiles&&(x.name===g.name
      ||(x.savedNames||[]).join('|')===g.files.map(f=>f.name).join('|')));
    if(q){q.files=g.files;delete q.needsFiles;hit++;}
  }
  return hit;
}
async function runQueue(mode){
  if(state.queueRunning)return;
  const blocked=state.queue.find(q=>q.status==='pending'&&q.needsFiles);
  if(blocked){showStatus(`«${esc(blocked.name)}» שוחזר מתור שמור אך קבציו אינם בדפדפן — בחר שוב את התיקייה שלו לפני ההרצה.`,'err');return;}
  state.queuePaused=false;
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
    state.files=(item.files||[]).slice();renderFiles();
    state.chunkNotes=null;state.outputName=null;
    let good=false;
    // A Drive item has no local files: the server downloads and catalogs it, so
    // it bypasses the file-based runner entirely (both modes land on the same
    // engine anyway — the describe engine reads the folder).
    try{good=(item.drivePath?await driveDescribe(item.drivePath):await runner())===true;}catch(e){console.error(e);}
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
    // ⏸ נלחץ בזמן שהתיק הזה רץ: הוא הושלם ונשמר, והתור נעצר כאן — הממתינים
    // נשארים ברשימה (ובאחסון), כך שאפשר להמשיך אחר כך בלי לאבד דבר.
    if(state.queuePaused)break;
    if(state.queue.some(q=>q.status==='pending'))await new Promise(r=>setTimeout(r,800));
  }
  state.queueRunning=false;renderQueue();   // state.files keeps the last tik's pages (צ'אט / תיאור מפורט / PDF)
  const failTxt=fail?` · ${fail} נכשלו — «🔄 נסה כושלים מחדש» יריץ אותם שוב`:'';
  if(state.queuePaused){
    state.queuePaused=false;renderQueue();
    const left=state.queue.filter(q=>q.status==='pending').length;
    showStatus(`⏸ התור נעצר לבקשתך — ${ok} תיקים קוטלגו${failTxt} · ${left} ממתינים ונשמרו. «▶ המשך התור» ימשיך מכאן, וגם אחרי סגירת הדפדפן הרשימה תחזור.`,'info');
    return;
  }
  showStatus(`✓ התור הסתיים — ${ok} תיקים קוטלגו${failTxt}. כל הרשומות שמורות בתור: «הצג» מחזיר רשומה למסך, «⬇ קובץ» מוריד את מה שנשמר בשרת.`,fail?'info':'ok');
}
$('tik-queue-clear').addEventListener('click',()=>{
  if(state.queueRunning){showStatus('התור רץ — עצור אותו ב-«⏸ עצור אחרי התיק הנוכחי», ואז אפשר לנקות.','err');return;}
  state.queue=[];renderQueue();
});
// ⏸ / ▶ — עצירה אחרי התיק הנוכחי, והמשך מאותה נקודה.
$('tik-queue-pause').addEventListener('click',()=>{
  if(state.queueRunning){
    state.queuePaused=true;renderQueue();
    showStatus('⏸ ייעצר בתום התיק הנוכחי — הוא ממשיך בשרת עד סופו ורשומתו תישמר. הממתינים יישארו ברשימה.','info');
    return;
  }
  if(!state.queue.some(q=>q.status==='pending')){showStatus('אין תיקים ממתינים בתור.','err');return;}
  runQueue(state.lastQueueMode||'fast');
});
$('tik-queue-retry').addEventListener('click',()=>{
  if(state.queueRunning)return;
  state.queue.forEach(q=>{if(q.status==='error'){q.status='pending';delete q.error;}});
  renderQueue();runQueue(state.lastQueueMode||'fast');
});
// תור שנשמר בריצה קודמת חוזר למסך (אחרי שכל פונקציות התור הוגדרו).
restoreQueue();

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


/* ---------- פתיחת תיק שקוטלג-בשרת בקטלוג המלא של המסך ----------
   ה-sidecar על הדיסק הוא רשומת-המנוע (TITLE_HE, doc_map...); המסך עובד על
   רשומת-הדשבורד. הממפה משכפל את engineRecordToDashboard של השרת — ובנוסף
   מעביר את שכבת-העדות (testimonies) שהממפה של השרת עדיין לא מעביר, כך
   שטופס-העד מתמלא. */
function engineSidecarToDashboard(f){
  f=f||{};
  const _clean=x=>String(x==null?'':x).trim();
  const _split=x=>_clean(x)?_clean(x).split(/[,;·]+/).map(t=>t.trim()).filter(Boolean):[];
  const docMap=Array.isArray(f.doc_map)?f.doc_map.filter(d=>d&&typeof d==='object'):[];
  const names=Array.isArray(f.names_index)?f.names_index.filter(n=>n&&typeof n==='object'):[];
  const events=Array.isArray(f.timeline)?f.timeline.filter(t=>t&&typeof t==='object'):[];
  const dr=_clean(f.DATE_RANGE);const drm=dr.split(/\s*[–—-]\s*/);
  const paragraphs=[];
  if(_clean(f.SUMMARY_HE))paragraphs.push({heading:'',body:_clean(f.SUMMARY_HE),contains_diamond:false});
  if(_clean(f.INFO_HE))paragraphs.push({heading:'הקשר היסטורי',body:_clean(f.INFO_HE),contains_diamond:false});
  const reviewFlags=[];
  // סימוני V/H ברשומת-המנוע הם HTML — מנוקים לתצוגת-טקסט (ולעולם לא מועתקים לספיר)
  const _txt=x=>_clean(x).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  if(_txt(f.NOTES_HE))reviewFlags.push({field:'הערות המנוע',issue:_txt(f.NOTES_HE)});
  reviewFlags.push({field:'מקור הרשומה',issue:'נטען מרשומת-שרת שמורה (output/) — תור-הדרייב.'});
  return {
    title:_clean(f.TITLE_HE),
    related_places:_split(f.PLACES_HE),
    languages:_split(f.LANGUAGES_HE),
    date_authentic_start:drm[0]||'',date_authentic_end:drm[drm.length-1]||drm[0]||'',
    date_reconstructed_start:'',date_reconstructed_end:'',
    originality:'',creator_person:'',creator_org:'',
    designate_name_typing:names.length>0,
    name_typing_reason:names.length?`זוהו ${names.length} שמות במפתח — לבדיקת המקטלג`:'',
    classification:'בלתי מסווג',classification_reason:'',
    content_note:_clean(f.DOC_TYPES_HE)?`סוגי מסמכים בתיק: ${_clean(f.DOC_TYPES_HE)}`:'',
    additional_info_paragraphs:paragraphs,also_in_file:[],
    donor_notes:_clean(f.CONTEXT_HE).includes('ללא מידע מוקדם')?'':_clean(f.CONTEXT_HE),
    diamonds:[],
    document_inventory:docMap.map(d=>({pages:String(d.pages||''),tik_pages:String(d.tik_pages||''),
      doc_type:String(d.type_he||''),type_key:String(d.type_key||''),date:String(d.date||''),
      languages:String(d.language_he||''),description:String(d.summary_he||d.summary||'')})),
    names_index:names.map(p=>({name:String(p.name||''),name_original:String(p.name_original||''),
      category:String(p.category||'').trim().toLowerCase(),crimes:String(p.crimes||''),
      role:String(p.role||p.context||''),birth:String(p.birth||''),death:String(p.death||''),
      place:String(p.place||''),fate:String(p.fate||''),source_pages:String(p.pages||p.page||''),
      confidence:String(p.confidence||'').trim().toLowerCase()})),
    timeline:events.map(t=>({date:String(t.date||''),event:String(t.event||''),
      place:String(t.place||''),source_pages:String(t.pages||t.page||'')})),
    subjects_he:_split(f.SUBJECTS_HE),subjects_en:_split(f.SUBJECTS_EN),
    field_confidence:{},review_flags:reviewFlags,
    _tik_source:String(f.tik_source||''),
    redactions:Array.isArray(f.redactions)?f.redactions:undefined,
    redactions_he:String(f.REDACTIONS_HE||''),
    organizations:Array.isArray(f.organizations)?f.organizations:[],
    _tik_kind:String(f.tik_kind||''),
    // כריכה (TR.15): כותר מקורי/סיגנטורה/כרך — מזין את נוסחת הכותר של פריטי-המשנה
    _cover:(f.cover&&typeof f.cover==='object')?f.cover:undefined,
    _trust:(f.trust_score===undefined||f.trust_score===null)?'':String(f.trust_score),
    _names_csv:String(f.names_csv||''),
    unreadable_pages:Array.isArray(f.unreadable_pages)?f.unreadable_pages:[],
    // שכבת-העדות — מוזנת לטופס-העד ולדפיות-הסיכום (חסרה בממפה של השרת)
    testimonies:Array.isArray(f.testimonies)?f.testimonies:[],
    deceased_index:Array.isArray(f.deceased_index)?f.deceased_index:[],
    _engine:{html:'',json:''},
  };
}
async function openServerRecordInCatalog(outName,dispName){
  try{
    showStatus('<span class="spinner"></span> טוען את רשומת «'+esc(dispName)+'» מהשרת…','info');
    const r=await fetch('/api/output/'+encodeURIComponent(outName.replace(/\.html$/,'.json')));
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rec=engineSidecarToDashboard(await r.json());
    state.files=[];state.chunkNotes=null;state.outputName=outName;
    renderRecord(rec,true);
    showStatus('מוצגת רשומת «'+esc(dispName)+'» מקטלוג-השרת — כל השדות, ההעתקות והייצוא זמינים.','ok');
    $('results').scrollIntoView({behavior:'smooth'});
  }catch(err){showStatus('טעינת הרשומה נכשלה: '+esc(err.message),'err');}
}
/* ---------- פס-מצב של תור-השרת: ריצות ☁ שמנוהלות בשרת, לא מהטאב הזה ----------
   קורא את זרם-הג'ובים (אדמין בלבד; 403 → הפס נשאר מוסתר) ומציג תמונת-מצב חיה
   של אצוות-הדרייב: התיק שרץ, התקדמות האוסף, והרשומות האחרונות עם קישורים.
   מתעדכן כל 30 ש׳ — "לראות מה עובד" בלי לעזוב את מסך העבודה (בקשת משתמש 11.8). */
(function serverQueueStrip(){
  const el=document.getElementById('server-queue-strip');
  if(!el)return;
  let denied=false,expanded=false;
  const COL=window.TIK_COLLECTION||[],LEG=window.TIK_LEGACY||{};
  const day=o=>{const d=new Date(Date.now()-o*864e5);return d.toISOString().slice(0,10).replace(/-/g,'');};
  async function tick(){
    if(denied)return;
    try{
      const evs=[];
      for(const off of [2,1,0]){
        const r=await fetch(`/api/admin/logs/job/${day(off)}?tail=5000&q=${encodeURIComponent('"kind":"tik"')}`);
        if(r.status===403){denied=true;return;}          // לא-אדמין — הפס לא רלוונטי
        if(r.ok){const j=await r.json();evs.push(...(j.records||[]));}
      }
      const open={},doneBy={};let failedRecent=0;const failsToday=[];
      for(const e of evs){
        if(e.kind!=='tik')continue;
        if(e.phase==='running')open[e.jobId]=e;
        if(e.phase==='done'){delete open[e.jobId];
          const m=String(e.outputName||'').match(/^tik_(.+?)_\d{8}\.html$/);
          if(m&&COL.includes(m[1]))doneBy[m[1]]={out:e.outputName,ts:e.ts,sec:e.elapsedSec};}
        if(e.phase==='error'){delete open[e.jobId];
          if(String(e.ts||'').slice(0,10).replace(/-/g,'')===day(0)){failedRecent++;
            failsToday.push({ts:String(e.ts||'').slice(11,16),err:String(e.error||'שגיאה לא מפורטת')});}}
      }
      for(const f in LEG)if(!doneBy[f])doneBy[f]={out:LEG[f],ts:'2026-08-09',sec:null};
      const doneN=Object.keys(doneBy).length,pendN=Math.max(0,COL.length-doneN-(Object.keys(open).length?1:0));

      const run=Object.values(open).sort((a,b)=>String(b.ts).localeCompare(a.ts))[0];
      let runTxt='<b>☁ תור-השרת</b> · אין תיק רץ כרגע';
      let runFolder='',stagesHtml='';
      if(run){
        const mins=Math.max(0,Math.round((Date.now()-Date.parse(run.ts))/60000));
        let pct='',ev='',modelTxt='',etaTxt='';
        try{
          const r=await fetch(`/api/tik-describe/${run.jobId}`);
          if(r.ok){const j=await r.json();
            const pctN=(j.progressPct!=null)?Number(j.progressPct):null;
            pct=(pctN!=null)?` · ${pctN}%`:'';
            if(j.progressModel)modelTxt=` · מנוע: <b>${esc(j.progressModel)}</b>`;
            // זמן נשאר לתיק — אקסטרפולציה מאחוז-ההתקדמות (יציב מ-10% ומעלה)
            if(pctN&&pctN>=10&&pctN<100&&mins>=2)
              etaTxt=` · נותרו ~${Math.max(1,Math.round(mins*(100-pctN)/pctN))} דק׳`;
            const evs2=j.events||[];const last=evs2.slice(-1)[0];ev=last?` — ${String(last.text||'').slice(0,60)}`:'';
            // שם התיק הרץ — מאירוע-ההורדה «מוריד את "X" מהדרייב»
            for(const e2 of evs2){const mm=String(e2.text||'').match(/«([^»]+)»/);if(mm){runFolder=mm[1];break;}}
            // שלבי-הפעילות: אירועים ייחודיים (חלונות-קריאה חוזרים נצברים לשלב אחד עם מונה)
            const seen=[];let winCount=0;
            for(const e2 of evs2){
              const t=String(e2.text||'').trim();if(!t)continue;
              if(/⇡ מעלה \d+ דפים/.test(t)){winCount++;continue;}
              seen.push(t.slice(0,84));
            }
            if(winCount)seen.push(`⇡ קריאת חלונות — ${winCount} חלונות עד כה`);
            stagesHtml=seen.slice(-6).map((t,ix,arr)=>`<div style="padding:1px 0;${ix===arr.length-1?'font-weight:600':'color:var(--muted)'}">${ix===arr.length-1?'▶':'✓'} ${esc(t)}</div>`).join('');
          }
        }catch(e){}
        runTxt=`<b>☁ רץ עכשיו</b>${runFolder?` · <b>${esc(runFolder)}</b>`:''} · <span class="srv-clock" data-start="${Date.parse(run.ts)}">${mins} דק׳</span>${pct}${modelTxt}${etaTxt}${ev}`;
      }
      // הזנת מצב-השרת לרינדור התור: שורות הרשימה מציגות ✓/⏳ לפי זה.
      window.__serverTikStatus={doneBy,runFolder,runStart:run?Date.parse(run.ts):0};
      if(typeof renderQueue==='function'&&(state.queue||[]).length)try{renderQueue();}catch(e){}
      // הערכת סיום לאוסף כולו: ממוצע זמן-תיק מהרשומות שנמדדו × הממתינים.
      const secs=Object.values(doneBy).map(d=>Number(d.sec)||0).filter(s=>s>0);
      let colEta='';
      if(pendN>0&&secs.length>=2){
        const avg=secs.reduce((a,b)=>a+b,0)/secs.length;
        const fin=new Date(Date.now()+pendN*avg*1000+(run?avg*500:0));
        colEta=` · סיום משוער: <b>${fin.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}${fin.getDate()!==new Date().getDate()?' מחר':''}</b>`;
      }
      const recent=Object.entries(doneBy).sort((a,b)=>String(b[1].ts).localeCompare(String(a[1].ts))).slice(0,6);
      const detail=expanded?`<div style="margin-top:7px;border-top:1px dashed color-mix(in srgb, var(--brand) 35%, transparent);padding-top:6px;font-size:12px">
        ${stagesHtml?`<div style="margin-bottom:6px"><b>שלבי הפעילות של התיק הרץ:</b>${stagesHtml}</div>`:''}
        ${failsToday.length?`<div style="margin-bottom:6px"><b style="color:var(--error)">הכשלים של היום (${failsToday.length}):</b>
          ${failsToday.slice(-8).map(f=>`<div style="padding:1px 0;color:var(--error)">✗ ${esc(f.ts)} — ${esc(f.err.slice(0,130))}</div>`).join('')}
          <div style="color:var(--muted)">תיק שנכשל אינו אבוד — הוא ירוץ שוב אוטומטית בהרצה הבאה של התור.</div></div>`:''}
        ${recent.map(([f,d])=>`<div style="padding:2px 0">✓ <b>${esc(f)}</b>${d.sec?` · ${Math.round(d.sec/60)} דק׳`:''} · <a href="/api/output/${encodeURIComponent(d.out)}" target="_blank" style="color:var(--brand)">פתח רשומה</a></div>`).join('')}
        </div>`:'';
      el.innerHTML=`${runTxt}<br><span style="color:var(--muted);font-size:12px">האוסף: <b>${doneN}</b>/${COL.length} קוטלגו · ${pendN} ממתינים${colEta}${failedRecent?` · <a href="#" class="sqs-open" style="color:var(--error)">${failedRecent} כשלים היום ←</a>`:''}</span>
        · <a href="#" id="sqs-toggle" style="color:var(--brand);font-size:12px">${expanded?'הסתר פירוט':'הצג שלבים ורשומות'}</a>
        · <a href="tik-queue-monitor.html" target="_blank" style="color:var(--brand);font-size:12px">מסך המעקב המלא ←</a>${detail}`;
      el.style.display='';
      const tg=document.getElementById('sqs-toggle');
      if(tg)tg.addEventListener('click',e=>{e.preventDefault();expanded=!expanded;tick();});
      el.querySelectorAll('.sqs-open').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();if(!expanded){expanded=true;tick();}}));
    }catch(e){/* שרת לא זמין — ננסה בסבב הבא */}
  }
  // הורדות מתוך שורות-התור: Excel (דרך ה-JSON של הרשומה) והדפסה/PDF.
  const ql=document.getElementById('tik-queue-list');
  if(ql&&!ql.__srvDl){ql.__srvDl=true;
    ql.addEventListener('click',async e=>{
      const oc=e.target.closest('.srv-open-cat');
      if(oc){e.preventDefault();openServerRecordInCatalog(oc.dataset.out,oc.dataset.name);return;}
      const x=e.target.closest('.srv-xlsx');
      if(x){e.preventDefault();x.textContent='📊 מכין…';
        try{
          const jr=await fetch('/api/output/'+encodeURIComponent(x.dataset.out.replace(/\.html$/,'.json')));
          if(!jr.ok)throw new Error('HTTP '+jr.status);
          const rec=await jr.json();
          const r=await fetch('/api/export-xlsx',{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({record:rec,filename:'tik_'+x.dataset.stem})});
          if(!r.ok)throw new Error('HTTP '+r.status);
          const blob=await r.blob();const u=URL.createObjectURL(blob);
          const a2=document.createElement('a');a2.href=u;a2.download='tik_'+x.dataset.stem+'.xlsx';a2.click();
          setTimeout(()=>URL.revokeObjectURL(u),5000);
        }catch(err){alert('יצוא Excel נכשל: '+err.message);}
        x.textContent='📊 Excel';return;}
      const pr=e.target.closest('.srv-print');
      if(pr){e.preventDefault();
        const w=window.open('/api/output/'+encodeURIComponent(pr.dataset.out),'_blank');
        if(w)setTimeout(()=>{try{w.print();}catch(err){/* ידפיס ידנית */}},1500);
      }
    });}
  tick();setInterval(tick,30000);
  // שעון-הריצה החי: כל שנייה, כל היכן שמוצג תיק רץ (הפס + שורות התור).
  setInterval(()=>{
    document.querySelectorAll('.srv-clock').forEach(s=>{
      const t0=Number(s.dataset.start)||0;if(!t0)return;
      const sec=Math.max(0,Math.floor((Date.now()-t0)/1000));
      s.textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
    });
  },1000);
})();
