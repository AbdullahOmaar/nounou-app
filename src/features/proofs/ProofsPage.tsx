import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Field, TextInput } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { fmtPeriod } from '../../i18n/format'
import { formatDateTimeAr, formatMoney } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'

/** مراجعة إثباتات الدفع (المالك فقط): اعتماد يحوّلها لدفعة، أو رفض بسبب */
export function ProofsPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const { user } = useAuth()
  const qc = useQueryClient()
  const proofs = useQuery({
    queryKey: ['proofs', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listPendingProofs(nurseryId!),
  })
  const refresh = () =>
    invalidatePrefixes(qc, ['proofs', 'invoices', 'invoice', 'child-payments', 'overdue', 'home'])
  const approve = useMutation({
    mutationFn: (proof: api.ProofItem) =>
      api.approveProof(user?.id ?? null, proof),
    onSuccess: refresh,
  })
  const reject = useMutation({
    mutationFn: (args: { proofId: string; reason: string }) =>
      api.rejectProof(user?.id ?? null, args.proofId, args.reason),
    onSuccess: refresh,
  })
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<api.ProofItem | null>(null)
  const [reason, setReason] = useState('')

  const methodLabel = (m: api.ProofItem['method']): string =>
    m === 'vodafone_cash'
      ? t('invoices.methodVodafone')
      : m === 'instapay'
        ? t('invoices.methodInstapay')
        : t('invoices.methodBank')

  return (
    <div className="flex flex-col gap-3">
      <p className="type-secondary text-muted">
        {t('paymentProofs.pendingCount', { count: proofs.data?.length ?? 0 })}
      </p>
      {proofs.isPending ? (
        <LoadingState />
      ) : proofs.isError ? (
        <ErrorState
          message={t('common.errorGeneric')}
          onRetry={() => void proofs.refetch()}
        />
      ) : (proofs.data ?? []).length === 0 ? (
        <EmptyState
          title={t('paymentProofs.emptyTitle')}
          hint={t('paymentProofs.emptyBody')}
        />
      ) : (
        (proofs.data ?? []).map((proof) => (
          <Card key={proof.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="type-body">
                  {t('paymentProofs.fromGuardian', {
                    guardian: proof.guardianName ?? '',
                    child: proof.childName,
                  })}
                </div>
                <div className="type-badge text-muted">
                  {t('paymentProofs.claimedAmount')}: {formatMoney(proof.amount)} —{' '}
                  {methodLabel(proof.method)} — {formatDateTimeAr(proof.created_at)}
                </div>
                <div className="type-badge text-muted">
                  {t('paymentProofs.childBalance', {
                    amount: formatMoney(proof.childBalance),
                  })}
                  {proof.invoicePeriod
                    ? ` — ${t('paymentProofs.invoiceBalance', {
                        period: fmtPeriod(proof.invoicePeriod),
                        amount: formatMoney(proof.invoiceBalance ?? 0),
                      })}`
                    : ''}
                </div>
              </div>
              {proof.proof_path && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const url = await api.proofSignedUrl(proof.proof_path!)
                    setImageUrl(url)
                  }}
                >
                  <Eye size={16} />
                  {t('paymentProofs.viewProof')}
                </Button>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                className="flex-1"
                onClick={() => approve.mutate(proof)}
                disabled={approve.isPending}
              >
                <Check size={18} />
                {t('paymentProofs.approve')}
              </Button>
              <Button
                variant="soft"
                className="flex-1"
                onClick={() => {
                  setReason('')
                  setRejectTarget(proof)
                }}
              >
                <X size={18} />
                {t('paymentProofs.reject')}
              </Button>
            </div>
          </Card>
        ))
      )}

      <Sheet open={Boolean(imageUrl)} onClose={() => setImageUrl(null)} title={t('paymentProofs.viewProof')}>
        {imageUrl && (
          <img src={imageUrl} alt="" className="w-full rounded-xl" />
        )}
      </Sheet>

      <Sheet
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('paymentProofs.reject')}
        footer={
          <Button
            variant="danger"
            disabled={!reason.trim() || reject.isPending}
            onClick={async () => {
              if (!rejectTarget) return
              await reject.mutateAsync({ proofId: rejectTarget.id, reason: reason.trim() })
              setRejectTarget(null)
            }}
            full
          >
            {t('paymentProofs.reject')}
          </Button>
        }
      >
        <Field label={t('paymentProofs.rejectReason')}>
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('paymentProofs.rejectReasonPlaceholder')}
          />
        </Field>
      </Sheet>
    </div>
  )
}
