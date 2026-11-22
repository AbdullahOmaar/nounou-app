import { useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Chip, ChipRow, Field, FormError, TextInput } from '../../components/ui/form'
import { useT } from '../../i18n'
import type { PaymentMethod } from '../../types/database'
import { useInvoiceMutations } from './hooks'

interface Props {
  open: boolean
  onClose: () => void
  childId: string
  invoiceId: string | null
  suggestedAmount?: number
}

const METHODS: PaymentMethod[] = ['cash', 'vodafone_cash', 'instapay', 'bank_transfer']

/** تسجيل دفعة من الإدارة (نقدي أو إلكتروني بإثبات اختياري) */
export function RecordPaymentSheet({
  open,
  onClose,
  childId,
  invoiceId,
  suggestedAmount,
}: Props) {
  const t = useT()
  const mutations = useInvoiceMutations()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const methodLabel = (m: PaymentMethod): string =>
    m === 'cash'
      ? t('invoices.methodCash')
      : m === 'vodafone_cash'
        ? t('invoices.methodVodafone')
        : m === 'instapay'
          ? t('invoices.methodInstapay')
          : t('invoices.methodBank')

  async function handleSubmit() {
    setError(null)
    const value = parseFloat(amount || String(suggestedAmount ?? ''))
    if (!value || value <= 0) {
      setError(t('common.errorGeneric'))
      return
    }
    try {
      await mutations.recordPayment.mutateAsync({
        invoice_id: invoiceId,
        child_id: childId,
        amount: value,
        method,
        proof_file: method === 'cash' ? null : proofFile,
      })
      setAmount('')
      setProofFile(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('invoices.recordPayment')}
      footer={
        <Button
          onClick={handleSubmit}
          disabled={mutations.recordPayment.isPending}
          full
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('common.amount')}>
          <TextInput
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            placeholder={suggestedAmount ? String(suggestedAmount) : ''}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label={t('invoices.paymentMethod')}>
          <ChipRow>
            {METHODS.map((m) => (
              <Chip key={m} active={method === m} onClick={() => setMethod(m)}>
                {methodLabel(m)}
              </Chip>
            ))}
          </ChipRow>
        </Field>
        {method !== 'cash' && (
          <Field label={t('invoices.proofRequired')}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              className="type-secondary"
            />
            {proofFile && (
              <span className="type-badge text-good-text">{t('invoices.proofAttached')}</span>
            )}
          </Field>
        )}
        {error && <FormError message={error} />}
      </div>
    </Sheet>
  )
}
