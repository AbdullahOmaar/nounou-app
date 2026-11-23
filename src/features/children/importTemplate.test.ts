/**
 * اختبار قالب الاستيراد الرسمي (3A-339): القالب المسلَّم للحضانات في
 * docs/pilot/import-template.csv يجب أن يظل مقروءاً من منطق الاستيراد
 * الفعلي دائماً — أي انحراف بين القالب والمستورد (ترويسة/صيغة تاريخ/
 * قاعدة موبايل) يكسر هذا الاختبار قبل أن يكسر تهيئة حضانة حقيقية.
 * واختبار حجم: 150 طفلاً مولّدين (بإخوات يتشاركون موبايل الوصي)
 * يمرون بلا أي خطأ وبنفس تجميع الأوصياء.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { parseImportRows } from './importLogic'

const DEMO_CLASSES = new Set(['البراعم', 'الزهور', 'الفراشات'])

function readTemplateRawRows(): unknown[][] {
  // vitest يعمل من جذر الريبو دائماً (بيئة jsdom لا تعطي URL ملفات صالحاً)
  const path = join(process.cwd(), 'docs/pilot/import-template.csv')
  const text = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  return parsed.data as unknown[][]
}

describe('قالب استيراد البايلوت الرسمي', () => {
  it('صفوف القالب المثال تُستورد كلها بلا أخطاء', () => {
    const { rows, errors } = parseImportRows(readTemplateRawRows(), DEMO_CLASSES)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0].full_name).toBe('يوسف تجريبي')
    // الأخوان في القالب يتشاركان موبايل الوصي — أساس خصم الإخوات
    expect(rows[0].guardian_phone).toBe(rows[1].guardian_phone)
    expect(rows[0].birth_date).toBe('2023-06-15')
  })

  it('حجم بايلوت كامل: 150 طفلاً بلا أخطاء وتجميع إخوات سليم', () => {
    const header = ['اسم الطفل', 'تاريخ الميلاد', 'الفصل', 'اسم ولي الأمر', 'الموبايل']
    const classes = ['البراعم', 'الزهور', 'الفراشات']
    const raw: unknown[][] = [header]
    // 60 وصياً: أول 30 لهم 3 أطفال، والباقون لهم طفلان = 90 + 60 = 150
    let childNo = 0
    for (let g = 1; g <= 60; g++) {
      const kids = g <= 30 ? 3 : 2
      const phone = `0100${String(1000000 + g).slice(1)}`
      for (let k = 0; k < kids; k++) {
        childNo++
        raw.push([
          `طفل تجريبي ${childNo}`,
          '2022-05-10',
          classes[childNo % 3],
          `وصي تجريبي ${g}`,
          phone,
        ])
      }
    }
    expect(childNo).toBe(150)
    const { rows, errors } = parseImportRows(raw, DEMO_CLASSES)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(150)
    const uniqueGuardians = new Set(rows.map((r) => r.guardian_phone))
    expect(uniqueGuardians.size).toBe(60)
  })
})
