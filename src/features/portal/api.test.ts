import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitPortalPayment } from './api'

// ترتيب دفع البوابة (3A-395 بند 2): أي فشل بعد إنشاء الدفعة يُلغى
// تعويضياً فلا تبقى دفعة pending بمسار إثبات بلا ملف — عبر محاكاة
// عميل Supabase القائم (rpc + storage) بنفس نمط InstallButton.test
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
const removed: string[] = []
let uploadError: { message: string } | null = null
let confirmError: { message: string } | null = null
let cancelError: { message: string } | null = null

vi.mock('../../lib/supabase', () => ({
  requireSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'nursery_portal_submit_payment')
        return {
          data: { payment_id: 'pay-1', proof_path: 'nur-1/pay-1.jpg' },
          error: null,
        }
      if (fn === 'nursery_portal_confirm_proof')
        return { data: null, error: confirmError }
      if (fn === 'nursery_portal_cancel_payment')
        return { data: null, error: cancelError }
      return { data: null, error: new Error(`unexpected rpc ${fn}`) }
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: uploadError }),
        remove: async (paths: string[]) => {
          removed.push(...paths)
          return { data: null, error: null }
        },
      }),
    },
  }),
}))

function file(): File {
  return new File(['x'], 'proof.jpg', { type: 'image/jpeg' })
}

function rpcNames(): string[] {
  return rpcCalls.map((c) => c.fn)
}

describe('submitPortalPayment — إلغاء تعويضي (3A-395)', () => {
  beforeEach(() => {
    rpcCalls.length = 0
    removed.length = 0
    uploadError = null
    confirmError = null
    cancelError = null
  })

  it('المسار السعيد: إنشاء → رفع → تأكيد، بلا إلغاء وبلا حذف ملف', async () => {
    await submitPortalPayment('tok', 'child-1', 500, 'instapay', file())
    expect(rpcNames()).toEqual([
      'nursery_portal_submit_payment',
      'nursery_portal_confirm_proof',
    ])
    expect(removed).toEqual([])
  })

  it('فشل الرفع: تُلغى الدفعة المنشأة ويُرمى خطأ الرفع، بلا تأكيد', async () => {
    uploadError = { message: 'storage down' }
    await expect(
      submitPortalPayment('tok', 'child-1', 500, 'instapay', file()),
    ).rejects.toMatchObject({ message: 'storage down' })
    expect(rpcNames()).toEqual([
      'nursery_portal_submit_payment',
      'nursery_portal_cancel_payment',
    ])
    expect(rpcCalls[1].args).toEqual({ p_token: 'tok', p_payment_id: 'pay-1' })
  })

  it('فشل التأكيد بعد رفع ناجح: تُلغى الدفعة ويُحذف الملف ويُرمى خطأ التأكيد', async () => {
    confirmError = { message: 'confirm failed' }
    await expect(
      submitPortalPayment('tok', 'child-1', 500, 'instapay', file()),
    ).rejects.toMatchObject({ message: 'confirm failed' })
    expect(rpcNames()).toEqual([
      'nursery_portal_submit_payment',
      'nursery_portal_confirm_proof',
      'nursery_portal_cancel_payment',
    ])
    expect(removed).toEqual(['nur-1/pay-1.jpg'])
  })

  it('فشل الإلغاء نفسه لا يخفي خطأ الرفع الأصلي', async () => {
    uploadError = { message: 'storage down' }
    cancelError = { message: 'cancel failed' }
    await expect(
      submitPortalPayment('tok', 'child-1', 500, 'instapay', file()),
    ).rejects.toMatchObject({ message: 'storage down' })
    expect(rpcNames()).toContain('nursery_portal_cancel_payment')
  })
})
