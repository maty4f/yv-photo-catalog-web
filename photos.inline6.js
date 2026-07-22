yvFlow.init({ screen: 'photos', backend: true, label: 'זרימת עיבוד:', options: [
  { value: 'tiered', label: 'מדורג (מומלץ)', hint: 'Gemini לכולם + Claude לעוגני-זיהוי' },
  { value: 'fast', label: 'מהיר', hint: 'Gemini בלבד — הכי מהיר וזול' },
  { value: 'free', label: 'מעמיק', hint: 'Claude תמיד — הכי יסודי, איטי' },
] });
