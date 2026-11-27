import { describe, expect, it } from 'vitest'
import { parseImportRows } from './importLogic'

const HEADER_AR = ['اسم الطفل', 'تاريخ الميلاد', 'الفصل', 'اسم ولي الأمر', 'الموبايل']
const HEADER_EN = ['Name', 'Birth Date', 'Class', 'Guardian Name', 'Phone']
const CLASSES = new Set(['KG1', 'KG2'])

describe('parseImportRows — استيراد الأطفال', () => {
  it('ترويسات عربية: صف سليم يُقرأ كاملاً', () => {
    const { rows, errors } = parseImportRows(
      [HEADER_AR, ['يوسف أحمد', '2022-03-04', 'KG1', 'أحمد سمير', '0100 123 4567']],
      CLASSES,
    )
    expect(errors).toEqual([])
    expect(rows).toEqual([
      {
        rowNumber: 2,
        full_name: 'يوسف أحمد',
        birth_date: '2022-03-04',
        class_name: 'KG1',
        guardian_name: 'أحمد سمير',
        guardian_phone: '01001234567',
      },
    ])
  })

  it('ترويسات إنجليزية تعمل بنفس الطريقة', () => {
    const { rows, errors } = parseImportRows(
      [HEADER_EN, ['Laila Omar', '2021-11-02', 'KG2', 'Omar Adel', '+201001234567']],
      CLASSES,
    )
    expect(errors).toEqual([])
    expect(rows[0].guardian_phone).toBe('+201001234567')
  })

  it('أخطاء بمواضعها: اسم غائب/وصي غائب/موبايل فاسد/فصل مجهول', () => {
    const { rows, errors } = parseImportRows(
      [
        HEADER_AR,
        ['', '2022-01-01', 'KG1', 'أب', '01001234567'],
        ['طفل', '2022-01-01', 'KG1', '', ''],
        ['طفل', '2022-01-01', 'KG1', 'أب', '123'],
        ['طفل', '2022-01-01', 'XYZ', 'أب', '01001234567'],
      ],
      CLASSES,
    )
    expect(rows).toEqual([])
    expect(errors).toEqual([
      { rowNumber: 2, code: 'missingName' },
      { rowNumber: 3, code: 'missingGuardian' },
      { rowNumber: 4, code: 'badPhone' },
      { rowNumber: 5, code: 'unknownClass' },
    ])
  })

  it('إخوات بنفس الموبايل: صفّان سليمان بلا خطأ (قصود)', () => {
    const { rows, errors } = parseImportRows(
      [
        HEADER_AR,
        ['أخ أول', '2020-05-01', 'KG2', 'الأب', '01001234567'],
        ['أخ تاني', '2022-05-01', 'KG1', 'الأب', '01001234567'],
      ],
      CLASSES,
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
  })

  it('صفوف فارغة تُتخطى وتاريخ ميلاد غير صيغي يصير null بلا خطأ', () => {
    const { rows, errors } = parseImportRows(
      [HEADER_AR, [], ['طفل', 'مش تاريخ', '', 'الأب', '01001234567']],
      CLASSES,
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].birth_date).toBeNull()
    expect(rows[0].class_name).toBeNull()
  })

  it('ملف بلا صفوف بيانات: نتيجة فارغة نظيفة', () => {
    expect(parseImportRows([HEADER_AR], CLASSES)).toEqual({ rows: [], errors: [] })
    expect(parseImportRows([], CLASSES)).toEqual({ rows: [], errors: [] })
  })

  it('سعة الفصل (420-T2): الصف الذي يتجاوز السعة يُرفض overCapacity بموضعه', () => {
    const limits = new Map([
      ['KG1', { capacity: 2, enrolled: 1 }],
      ['KG2', { capacity: null, enrolled: 0 }],
    ])
    const { rows, errors } = parseImportRows(
      [
        HEADER_AR,
        ['طفل أول', '2022-01-01', 'KG1', 'ولي أ', '01001234567'],
        ['طفل ثانٍ', '2022-01-01', 'KG1', 'ولي ب', '01001234568'],
        ['طفل ثالث', '2022-01-01', 'KG2', 'ولي ج', '01001234569'],
      ],
      CLASSES,
      limits,
    )
    // KG1: مسجّل 1 + سعة 2 → أول صف يدخل، الثاني يتجاوز فيُرفض (سطر 3)
    expect(rows.map((r) => r.full_name)).toEqual(['طفل أول', 'طفل ثالث'])
    expect(errors).toEqual([{ rowNumber: 3, code: 'overCapacity' }])
  })

  it('سعة الفصل (420-T2): فصل ممتلئ أصلاً يرفض الكل، وبلا حدود لا رفض', () => {
    const full = new Map([['KG1', { capacity: 20, enrolled: 20 }]])
    const r1 = parseImportRows(
      [HEADER_AR, ['طفل', '2022-01-01', 'KG1', 'ولي', '01001234567']],
      CLASSES,
      full,
    )
    expect(r1.rows).toEqual([])
    expect(r1.errors).toEqual([{ rowNumber: 2, code: 'overCapacity' }])
    const r2 = parseImportRows(
      [HEADER_AR, ['طفل', '2022-01-01', 'KG1', 'ولي', '01001234567']],
      CLASSES,
    )
    expect(r2.rows).toHaveLength(1)
    expect(r2.errors).toEqual([])
  })
})
