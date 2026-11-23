import { describe, expect, it } from 'vitest'
import { planMonthlyIssue, round2, type IssueChildInput } from './issuePlan'

function child(partial: Partial<IssueChildInput> & { childId: string }): IssueChildInput {
  return {
    childName: partial.childId,
    className: 'KG1',
    baseFee: 800,
    hasPrice: true,
    payerGuardianId: null,
    busLines: [],
    ...partial,
  }
}

describe('planMonthlyIssue — قلب إصدار الفواتير (قرار ق١٤)', () => {
  it('طفل وحيد: سطر أساس فقط بالمبلغ الكامل', () => {
    const { plans, skipped } = planMonthlyIssue([child({ childId: 'a' })], 10, new Set())
    expect(skipped).toEqual([])
    expect(plans).toHaveLength(1)
    expect(plans[0].lines).toHaveLength(1)
    expect(plans[0].total).toBe(800)
  })

  it('خصم الإخوات: الأول كامل وكل إضافي −١٠٪ من أساسه فقط', () => {
    const kids = [
      child({ childId: 'b', childName: 'ليان', payerGuardianId: 'g1', busLines: [{ routeName: 'خط أ', fee: 150 }] }),
      child({ childId: 'a', childName: 'آدم', payerGuardianId: 'g1' }),
      child({ childId: 'c', childName: 'نور', payerGuardianId: 'g1' }),
    ]
    const { plans } = planMonthlyIssue(kids, 10, new Set())
    const byId = Object.fromEntries(plans.map((p) => [p.childId, p]))
    // الترتيب الأبجدي: آدم أولاً (بلا خصم)، ليان ونور بخصم ٨٠ من الأساس فقط
    expect(byId['a'].total).toBe(800)
    expect(byId['b'].total).toBe(800 + 150 - 80)
    expect(byId['c'].total).toBe(720)
    const discountLine = byId['b'].lines.find((l) => l.type === 'discount')
    expect(discountLine?.amount).toBe(-80)
    expect(discountLine?.labelKey).toBe('discountSibling')
  })

  it('أولاد بدافعين مختلفين: لا خصم لأحد', () => {
    const kids = [
      child({ childId: 'a', payerGuardianId: 'g1' }),
      child({ childId: 'b', payerGuardianId: 'g2' }),
    ]
    const { plans } = planMonthlyIssue(kids, 10, new Set())
    expect(plans.every((p) => p.total === 800)).toBe(true)
  })

  it('نسبة صفر أو دافع غائب: لا سطر خصم أبداً', () => {
    const kids = [
      child({ childId: 'a', payerGuardianId: 'g1' }),
      child({ childId: 'b', payerGuardianId: 'g1' }),
      child({ childId: 'c', payerGuardianId: null }),
      child({ childId: 'd', payerGuardianId: null }),
    ]
    const { plans } = planMonthlyIssue(kids, 0, new Set())
    expect(plans.every((p) => p.lines.every((l) => l.type !== 'discount'))).toBe(true)
  })

  it('المُصدَر له فاتورة يُتخطى ويُبلَّغ في skipped', () => {
    const kids = [child({ childId: 'a' }), child({ childId: 'b' })]
    const { plans, skipped } = planMonthlyIssue(kids, 10, new Set(['a']))
    expect(skipped).toEqual(['a'])
    expect(plans.map((p) => p.childId)).toEqual(['b'])
  })

  it('حتمية الترتيب: نفس المدخلات بأي ترتيب تعطي نفس «الأول»', () => {
    const kids = [
      child({ childId: 'x', childName: 'سامي', payerGuardianId: 'g' }),
      child({ childId: 'y', childName: 'سامي', payerGuardianId: 'g' }),
    ]
    const r1 = planMonthlyIssue(kids, 10, new Set())
    const r2 = planMonthlyIssue([...kids].reverse(), 10, new Set())
    expect(r1.plans).toEqual(r2.plans)
    // عند تساوي الاسم يحسم المعرّف: x قبل y
    expect(r1.plans[0].childId).toBe('x')
    expect(r1.plans[0].total).toBe(800)
    expect(r1.plans[1].total).toBe(720)
  })

  it('round2: تقريب لقروش صحيحة عند المصدر', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(799.999)).toBe(800)
    expect(round2(80.125)).toBe(80.13)
  })

  it('X4: طفل بلا باقة سعر يُستثنى ويُبلَّغ عنه بالاسم — بلا فاتورة 0 جنيه', () => {
    const kids = [
      child({ childId: 'a', childName: 'آدم' }),
      child({ childId: 'b', childName: 'ليان', hasPrice: false, baseFee: 0 }),
    ]
    const { plans, skipped, noPrice } = planMonthlyIssue(kids, 10, new Set())
    expect(plans.map((p) => p.childId)).toEqual(['a'])
    expect(skipped).toEqual([])
    expect(noPrice).toEqual(['ليان'])
  })

  it('X4: سعر صفر صريح (فصل مجاني) يُصدَر — الاستثناء للغياب لا للقيمة', () => {
    const kids = [child({ childId: 'a', baseFee: 0, hasPrice: true })]
    const { plans, noPrice } = planMonthlyIssue(kids, 10, new Set())
    expect(plans).toHaveLength(1)
    expect(plans[0].total).toBe(0)
    expect(noPrice).toEqual([])
  })

  it('X4: المستثنى بلا سعر لا يحجز مكان «الأول» في خصم الإخوات', () => {
    const kids = [
      child({ childId: 'a', childName: 'آدم', payerGuardianId: 'g1', hasPrice: false, baseFee: 0 }),
      child({ childId: 'b', childName: 'ليان', payerGuardianId: 'g1' }),
      child({ childId: 'c', childName: 'نور', payerGuardianId: 'g1' }),
    ]
    const { plans, noPrice } = planMonthlyIssue(kids, 10, new Set())
    const byId = Object.fromEntries(plans.map((p) => [p.childId, p]))
    expect(noPrice).toEqual(['آدم'])
    expect(byId['b'].total).toBe(800)
    expect(byId['c'].total).toBe(720)
  })
})
