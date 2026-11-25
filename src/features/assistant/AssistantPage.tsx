import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot, Play, Square } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmSheet } from '../../components/ui/ConfirmSheet'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/toast'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useT } from '../../i18n'
import { makeStopFlag } from '../../lib/bulk'
import { isFlagEnabled } from '../../lib/featureFlags'
import { formatMoney } from '../../lib/format'
import { logActivityAuto } from '../settings/api'
import { fetchDaySummary, runFeeReminders } from './actions'

/**
 * المساعد المشرف (4.8): خلف علم supervisor_assistant (4.21)
 * وللمالك فقط. كتالوج مغلق: ملخص اليوم (قراءة) + تذكيرات
 * الرسوم (كتابة — تأكيد صريح + زر إيقاف + سجل نشاط).
 */
export function AssistantPage() {
  const t = useT()
  const toast = useToast()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(makeStopFlag())

  const flag = useQuery({
    queryKey: ['flag', nurseryId, 'supervisor_assistant'],
    queryFn: () => isFlagEnabled(nurseryId as string, 'supervisor_assistant'),
    enabled: nurseryId !== null && isOwner,
  })

  const summaryMut = useMutation({
    mutationFn: () => fetchDaySummary(nurseryId as string),
    onSuccess: async (s) => {
      setSummary(
        `${t('assistant.sumChildren')}: ${s.children} · ` +
          `${t('assistant.sumOutstanding')}: ${formatMoney(s.outstanding)} · ` +
          `${t('assistant.sumProofs')}: ${s.pendingProofs}`,
      )
      await logActivityAuto(
        nurseryId as string,
        'assistant_executed',
        'day_summary',
      )
    },
    onError: () => toast(t('common.errorGeneric')),
  })

  const remindMut = useMutation({
    mutationFn: () =>
      runFeeReminders(nurseryId as string, null, stopRef.current.shouldStop),
    onSuccess: async (run) => {
      toast(
        run.stopped
          ? t('common.bulkStopped')
              .replace('{done}', String(run.attempted))
              .replace('{total}', String(run.total))
          : `${t('assistant.remindersDone')}: ${run.attempted}`,
      )
      await logActivityAuto(
        nurseryId as string,
        'assistant_executed',
        'fee_reminders',
      )
    },
    onError: () => toast(t('common.errorGeneric')),
  })

  if (!isOwner || flag.data !== true) {
    return (
      <EmptyState
        icon={Bot}
        title={t('assistant.offTitle')}
        hint={t('assistant.offHint')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="font-bold">{t('assistant.summaryTitle')}</p>
        <p className="text-sm text-muted">{t('assistant.summaryBody')}</p>
        <Button
          onClick={() => summaryMut.mutate()}
          disabled={summaryMut.isPending}
        >
          <Play size={18} /> {t('assistant.run')}
        </Button>
        {summary && <p className="text-sm">{summary}</p>}
      </Card>

      <Card className="space-y-2">
        <p className="font-bold">{t('assistant.remindTitle')}</p>
        <p className="text-sm text-muted">{t('assistant.remindBody')}</p>
        {remindMut.isPending ? (
          <Button
            variant="danger"
            onClick={() => stopRef.current.stop()}
          >
            <Square size={18} /> {t('common.stop')}
          </Button>
        ) : (
          <Button onClick={() => setConfirmOpen(true)}>
            <Play size={18} /> {t('assistant.run')}
          </Button>
        )}
      </Card>

      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('assistant.confirmTitle')}
        body={t('assistant.confirmBody')}
        confirmLabel={t('assistant.run')}
        onConfirm={() => {
          setConfirmOpen(false)
          stopRef.current = makeStopFlag()
          remindMut.mutate()
        }}
      />
    </div>
  )
}
