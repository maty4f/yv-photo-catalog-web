yvFlow.init({ screen: 'documents-tik', backend: true, label: 'קורא התיק:', options: [
  { value: 'auto', label: 'אוטומטי (מומלץ)', hint: 'Gemini קורא → גיבוי Claude → Mistral' },
  { value: 'claude', label: 'קורא Claude', hint: 'לתיקים גדולים / כשמכסת Gemini אזלה' },
  { value: 'gemini', label: 'Gemini בלבד', hint: 'ללא גיבוי לקורא' },
] });
