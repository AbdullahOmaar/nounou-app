import { requireSupabase } from '../../lib/supabase'
import type { PaymentRow, PendingApprovalRow } from '../../types/database'
import * as financeApi from '../finance/api'
import * as invoicesApi from '../invoices/api'
import * as proofsApi from '../proofs/api'
import { markDecided } from './api'

/**
 * منفّذ الاعتماد الثاني: عند الاعتماد يُنفَّذ الفعل الأصلي بمساراته
 * الداخلية غير المحروسة (حتى لا يطلب اعتماداً جديداً)، ثم يُختم
 * الطلب. عند الرفض لا يُنفَّذ شيء. فشل التنفيذ يترك الطلب معلّقاً.
 */
export async function decideApproval(
  nurseryId: string,
  actorId: string | null,
  row: PendingApprovalRow,
  approved: boolean,
): Promise<void> {
  if (!approved) {
    await markDecided(nurseryId, actorId, row, false)
    return
  }
  const p = row.payload
  switch (row.action_kind) {
    case 'proof_approve': {
      const db = requireSupabase()
      const { data, error } = await db
        .from('payments')
        .select('*')
        .eq('id', String(p.paymentId))
        .single()
      if (error) throw error
      await proofsApi.approveProofInternal(actorId, data as PaymentRow)
      break
    }
    case 'cashbox_close_diff':
      await financeApi.closeCashbox(
        nurseryId,
        actorId,
        String(p.date),
        Number(p.expected),
        Number(p.counted),
        String(p.handover),
        p.note ? String(p.note) : null,
      )
      break
    case 'invoice_cancel_paid':
      await invoicesApi.cancelInvoiceInternal(String(p.invoiceId))
      break
    case 'expense_large':
      await financeApi.addExpenseRecord(nurseryId, actorId, {
        expense_date: String(p.expense_date),
        category: p.category as never,
        title: String(p.title),
        amount: Number(p.amount),
        note: p.note ? String(p.note) : null,
      })
      break
  }
  await markDecided(nurseryId, actorId, row, true)
}
