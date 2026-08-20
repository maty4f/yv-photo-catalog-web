# העברת נתוני קטלוג מ-IDEA → yv-photo-catalog

כלי המרה שמעביר רשומות קטלוג מבסיס הנתונים של IDEA אל פורמט הרשומה של
המערכת (ראו `catalog_schema.json`), ואז מזרים אותן למסך הקיטלוג בדפדפן.

> **חשוב:** סשן הענן של Claude לא רואה את המחשב שלך — לכן שלב א׳ (החילוץ
> מ-IDEA) רץ **מקומית אצלך**, והתוצר (`catalog.json`) נטען בדפדפן בשלב ב׳.

## שלב א׳ — חילוץ מ-IDEA (על המחשב שלך)

1. דרישות: Python 3.8+. לחיבור DB חי: `pip install SQLAlchemy` + דרייבר
   (`pyodbc` ל-Access/SQL Server). לקריאת xlsx: `pip install openpyxl`.
   לחלופין — ייצאו מ-IDEA קובץ CSV/Excel ואין צורך בכלום.
2. העתיקו `mapping.example.json` → `mapping.json` וערכו:
   - `source` — או `type:"db"` עם `db_url` (SQLAlchemy URL) ו-`query`,
     או `type:"file"` עם נתיב ל-CSV/TSV/XLSX/JSON שייצאתם מ-IDEA.
   - `fields` — לכל שדה יעד, שם העמודה האמיתי אצלכם (`column`).
     אפשר גם `const` (ערך קבוע) או `template` (`"{City}, {Country}"`).
     `split` הופך עמודה לרשימה (למשל `places`).
   - `subjects` — עמודת הנושאים; `"thesaurus":"match"` מצליב מול
     `data/thesaurus_photo_archive.json` להשלמת זוגות עברית/אנגלית.
   - `people` — `inline` (עמודת שמות אחת) או `join` (טבלת אנשים נפרדת).
3. הרצה:

   ```bash
   # בדיקה — מדפיס 3 רשומות ממופות בלי לכתוב כלום
   python idea_to_catalog.py --mapping mapping.json --dry-run --limit 3

   # המרה מלאה
   python idea_to_catalog.py --mapping mapping.json --out catalog.json
   ```

## שלב ב׳ — טעינה למערכת (בדפדפן)

1. פתחו את **`import-idea.html`** (מ-github.io או מקומית).
2. גררו את `catalog.json` — תוצג רשימת הרשומות עם סינון.
3. בחרו רשומה → **"📤 שלח למסך הקיטלוג"** — `photos.html` נפתח ומציע
   "💾 שחזר"; לחיצה ממלאת את כל שדות הרשומה אוטומטית.

הנושאים (subjects) וטבלת הזיהוי מוזרמים כטקסט לשדות ההערות/אישים —
מנגנון השחזור ממלא רק שדות קלט סטטיים; הוסיפו את הצ׳יפים ידנית לפי הטקסט.

## קבצים

| קובץ | תפקיד |
|---|---|
| `idea_to_catalog.py` | ה-CLI — קורא DB/קובץ, ממפה, כותב `catalog.json` |
| `mapping.example.json` | תבנית מיפוי עמודות → שדות רשומה |
| `catalog_schema.json` | הגדרת פורמט הרשומה (JSON Schema) |
| `../../import-idea.html` | דף הייבוא בדפדפן |
