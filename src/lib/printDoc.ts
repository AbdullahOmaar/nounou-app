/**
 * محرك المستندات القابلة للطباعة/PDF الواحد (4.16): قالب هوية واحد
 * (شعار + اسم + شريط لون العلامة) تُبنى عليه كل المخرجات الورقية:
 * الإيصالات (من 1.6، هُجّرت هنا) وتقارير اليوم، وبعدهما ملف
 * الترخيص (4.11) وملف النمو (4.5) — لا قالب ثانٍ بعد اليوم.
 * التنفيذ: نافذة طباعة بمستند HTML مستقل؛ «حفظ كـPDF» من متصفح
 * المستخدم نفسه — لا مكتبة PDF ولا خادم. كل القيم تُهرَّب HTML.
 */

export type PrintSection =
  | { type: 'kv'; rows: { label: string; value: string }[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'text'; text: string }
  | { type: 'images'; urls: string[] }

export interface PrintDocOptions {
  nurseryName: string
  logoUrl?: string | null
  brandColor?: string | null
  title: string
  meta?: string
  sections: PrintSection[]
  footerNote?: string
  lang?: 'ar' | 'en'
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sectionHtml(s: PrintSection): string {
  if (s.type === 'kv') {
    return `<table class="kv">${s.rows
      .map(
        (r) =>
          `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`,
      )
      .join('')}</table>`
  }
  if (s.type === 'table') {
    return `<table class="grid"><thead><tr>${s.head
      .map((h) => `<th>${esc(h)}</th>`)
      .join('')}</tr></thead><tbody>${s.rows
      .map(
        (r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody></table>`
  }
  if (s.type === 'images') {
    return `<div class="imgs">${s.urls
      .map((u) => `<img src="${esc(u)}" alt="" />`)
      .join('')}</div>`
  }
  return `<p class="txt">${esc(s.text)}</p>`
}

/** يفتح مستند الطباعة؛ يعيد false إن حجب المتصفح النافذة. */
export function openPrintDocument(opts: PrintDocOptions): boolean {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return false
  const brand = opts.brandColor ?? '#0ea5a4'
  const dir = opts.lang === 'en' ? 'ltr' : 'rtl'
  const lang = opts.lang ?? 'ar'
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8" />
<title>${esc(opts.title)} — ${esc(opts.nurseryName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 0; padding: 28px; color: #1f2937; }
  .band { height: 8px; border-radius: 4px; background: ${brand}; margin-bottom: 18px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  header img { width: 56px; height: 56px; object-fit: cover; border-radius: 12px; }
  header .name { font-size: 20px; font-weight: 700; }
  h1 { font-size: 22px; margin: 14px 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 14px; }
  table.kv th { text-align: ${dir === 'rtl' ? 'right' : 'left'}; color: #6b7280; font-weight: 500; padding: 7px 10px; width: 34%; border-bottom: 1px solid #e5e7eb; }
  table.kv td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600; }
  table.grid th, table.grid td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
  table.grid th { background: #f3f4f6; }
  .txt { font-size: 14px; line-height: 1.9; white-space: pre-wrap; margin: 8px 0 16px; }
  .imgs { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 16px; }
  .imgs img { width: 220px; height: 220px; object-fit: cover; border-radius: 10px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; display: flex; justify-content: space-between; }
  @media print { body { padding: 12px; } }
</style></head>
<body>
  <div class="band"></div>
  <header>
    ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="" />` : ''}
    <div class="name">${esc(opts.nurseryName)}</div>
  </header>
  <h1>${esc(opts.title)}</h1>
  ${opts.meta ? `<div class="meta">${esc(opts.meta)}</div>` : ''}
  ${opts.sections.map(sectionHtml).join('')}
  <footer><span>${esc(opts.footerNote ?? '')}</span><span>${esc(opts.nurseryName)}</span></footer>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 120));</script>
</body></html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
  return true
}
