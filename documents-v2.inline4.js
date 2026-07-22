yvFlow.init({ screen: 'documents-v2', backend: true, label: 'זרימת עיבוד:', options: [
  { value: 'auto', label: 'אוטומטי (מומלץ)', hint: 'Gemini מבין את המסמך + גיבוי' },
  { value: 'smart', label: 'חכם (זיהוי שפה)', hint: 'מסווג שפה+סוג: מודפס לא-עברי → Mistral (מהיר/זול), אחרת → Gemini' },
  { value: 'mistral', label: 'OCR מהיר (מודפס)', hint: 'Mistral OCR — מהיר לטקסט מודפס נקי' },
  { value: 'consensus', label: 'אימות דו-מודלי', hint: 'Gemini + Claude קוראים בנפרד ומפייסים — לכתב-יד קשה (איטי/יקר יותר)' },
] });
