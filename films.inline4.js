yvFlow.init({ screen: 'films', backend: true, label: 'זרימת עיבוד:', options: [
  { value: 'auto', label: 'אוטומטי (מומלץ)', hint: 'Gemini לפריימים + גיבוי Qwen' },
  { value: 'nofallback', label: 'Gemini בלבד', hint: 'ללא גיבוי Qwen' },
  { value: 'consensus', label: 'אימות דו-מודלי', hint: 'Gemini + Claude קוראים כיתובים ומפייסים (איטי/יקר יותר)' },
] });
