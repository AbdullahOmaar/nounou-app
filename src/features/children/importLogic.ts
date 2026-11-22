/**
 * منطق استيراد الأطفال النقي (قابل للاختبار): تحويل صفوف جدول خام
 * (Excel/CSV) لسجلات أطفال + أخطاء بمواضعها. الأعمدة تُقبل بالعربي أو
 * الإنجليزي: اسم الطفل/الاسم، تاريخ الميلاد، الفصل، اسم ولي الأمر، الموبايل.
 */

export interface ImportRow {
  rowNumber: number
  full_name: string
  birth_date: string | null
  class_name: string | null
  guardian_name: string
  guardian_phone: string
}

export interface ImportRowError {
  rowNumber: number
  code: 'missingName' | 'missingGuardian' | 'badPhone' | 'unknownClass'
}

const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, 'rowNumber'>> = {
  'اسم الطفل': 'full_name',
  'الاسم': 'full_name',
  'name': 'full_name',
  'child name': 'full_name',
  'تاريخ الميلاد': 'birth_date',
  'الميلاد': 'birth_date',
  'birth date': 'birth_date',
  'birthdate': 'birth_date',
  'الفصل': 'class_name',
  'class': 'class_name',
  'اسم ولي الأمر': 'guardian_name',
  'ولي الأمر': 'guardian_name',
  'guardian': 'guardian_name',
  'guardian name': 'guardian_name',
  'الموبايل': 'guardian_phone',
  'رقم الموبايل': 'guardian_phone',
  'الهاتف': 'guardian_phone',
  'phone': 'guardian_phone',
  'mobile': 'guardian_phone',
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  return String(v).trim()
}

export function parseImportRows(
  rawRows: unknown[][],
  knownClassNames: Set<string>,
): { rows: ImportRow[]; errors: ImportRowError[] } {
  const rows: ImportRow[] = []
  const errors: ImportRowError[] = []
  if (rawRows.length < 2) return { rows, errors }

  const header = rawRows[0].map((h) => cellText(h).toLowerCase())
  const colFor = (field: string): number =>
    header.findIndex((h) => HEADER_ALIASES[h] === field)
  const cols = {
    full_name: colFor('full_name'),
    birth_date: colFor('birth_date'),
    class_name: colFor('class_name'),
    guardian_name: colFor('guardian_name'),
    guardian_phone: colFor('guardian_phone'),
  }
  for (let i = 1; i < rawRows.length; i++) {
    const raw = rawRows[i]
    if (!raw || raw.every((c) => cellText(c) === '')) continue
    const rowNumber = i + 1
    const get = (idx: number) => (idx >= 0 ? cellText(raw[idx]) : '')
    const full_name = get(cols.full_name)
    const guardian_name = get(cols.guardian_name)
    const guardian_phone = get(cols.guardian_phone).replace(/[\s-]/g, '')
    const class_name = get(cols.class_name) || null
    const birthRaw = get(cols.birth_date)
    const birth_date = /^\d{4}-\d{2}-\d{2}$/.test(birthRaw) ? birthRaw : null

    if (!full_name) {
      errors.push({ rowNumber, code: 'missingName' })
      continue
    }
    if (!guardian_name || !guardian_phone) {
      errors.push({ rowNumber, code: 'missingGuardian' })
      continue
    }
    if (!/^\+?\d{10,15}$/.test(guardian_phone)) {
      errors.push({ rowNumber, code: 'badPhone' })
      continue
    }
    // نفس الموبايل لعدة أطفال مسموح ومقصود: وصيّ واحد لإخوات
    if (class_name && !knownClassNames.has(class_name)) {
      errors.push({ rowNumber, code: 'unknownClass' })
      continue
    }
    rows.push({
      rowNumber,
      full_name,
      birth_date,
      class_name,
      guardian_name,
      guardian_phone,
    })
  }
  return { rows, errors }
}
