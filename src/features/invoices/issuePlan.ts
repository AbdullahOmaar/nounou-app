import type { InvoiceLineType } from '../../types/database'

/**
 * مخطط إصدار الفواتير الشهري — منطق نقي قابل للاختبار (قلب المرحلة ١):
 * لكل طفل نشط: سطر أساس (سعره الخاص أو باقة فصله) + سطر باص لكل اشتراك
 * نشط + سطر خصم إخوات صريح. قواعد الخصم (قرار ق١٤): يُجمَّع الأطفال
 * بصاحب الدفع (is_payer)؛ الأول بالترتيب الأبجدي يدفع كاملاً، وكل إضافي
 * يأخذ خصماً = نسبة الإعداد × سطر أساسه فقط (لا باص ولا إضافات).
 * التقريب: لقروش صحيحة عند المصدر (درس المعايير v1.2).
 */

export interface IssueChildInput {
  childId: string
  childName: string
  className: string
  baseFee: number
  payerGuardianId: string | null
  busLines: { routeName: string; fee: number }[]
}

export interface PlannedLine {
  type: InvoiceLineType
  labelKey: 'base' | 'bus' | 'discountSibling'
  labelParams: Record<string, string | number>
  amount: number
}

export interface PlannedInvoice {
  childId: string
  lines: PlannedLine[]
  total: number
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function planMonthlyIssue(
  children: IssueChildInput[],
  siblingDiscountPercent: number,
  alreadyInvoiced: Set<string>,
): { plans: PlannedInvoice[]; skipped: string[] } {
  const plans: PlannedInvoice[] = []
  const skipped: string[] = []

  // ترتيب ثابت حتمي: بالاسم ثم المعرّف — «الأول» في مجموعة الإخوات محدد
  const sorted = [...children].sort((a, b) =>
    a.childName === b.childName
      ? a.childId.localeCompare(b.childId)
      : a.childName.localeCompare(b.childName),
  )
  const seenPayers = new Set<string>()

  for (const child of sorted) {
    if (alreadyInvoiced.has(child.childId)) {
      skipped.push(child.childId)
      continue
    }
    const lines: PlannedLine[] = []
    lines.push({
      type: 'base',
      labelKey: 'base',
      labelParams: { class: child.className },
      amount: round2(child.baseFee),
    })
    for (const bus of child.busLines) {
      lines.push({
        type: 'bus',
        labelKey: 'bus',
        labelParams: { route: bus.routeName },
        amount: round2(bus.fee),
      })
    }
    if (child.payerGuardianId && siblingDiscountPercent > 0) {
      if (seenPayers.has(child.payerGuardianId)) {
        const discount = round2((child.baseFee * siblingDiscountPercent) / 100)
        if (discount > 0) {
          lines.push({
            type: 'discount',
            labelKey: 'discountSibling',
            labelParams: { percent: siblingDiscountPercent },
            amount: -discount,
          })
        }
      } else {
        seenPayers.add(child.payerGuardianId)
      }
    }
    plans.push({
      childId: child.childId,
      lines,
      total: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    })
  }
  return { plans, skipped }
}
