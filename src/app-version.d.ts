/**
 * رقم إصدار التطبيق — يُحقن وقت البناء من package.json عبر define في
 * vite.config.ts (مصدر واحد: 3A-312 بند ٥). لا تُعرّف القيمة في أي مكان آخر.
 */
declare const __APP_VERSION__: string

/** وقت بناء/نشر هذه النسخة (ISO) — يُحقن وقت البناء من vite.config.ts */
declare const __BUILD_TIME__: string
