import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Route } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import * as api from './api'
import {
  LICENSING_STEP_KEYS,
  type LicensingStepStatus,
} from './steps'

const NEXT: Record<LicensingStepStatus, LicensingStepStatus> = {
  todo: 'done',
  done: 'na',
  na: 'todo',
}

export function LicensingPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const showToast = useToast()
  const qc = useQueryClient()

  const steps = useQuery({
    queryKey: ['licensing-steps', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listStepStatuses(nurseryId!),
  })

  if (!nurseryId || steps.isPending) return <LoadingState />
  if (steps.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void steps.refetch()}
      />
    )

  const doneCount = LICENSING_STEP_KEYS.filter(
    (k) => steps.data.get(k) === 'done' || steps.data.get(k) === 'na',
  ).length
  const pct = Math.round((doneCount / LICENSING_STEP_KEYS.length) * 100)

  const stepText = (
    key: (typeof LICENSING_STEP_KEYS)[number],
  ): { title: string; hint: string } => {
    switch (key) {
      case 'premises':
        return { title: t('licensingTrack.steps.premises.title'), hint: t('licensingTrack.steps.premises.hint') }
      case 'commercial_register':
        return { title: t('licensingTrack.steps.commercial_register.title'), hint: t('licensingTrack.steps.commercial_register.hint') }
      case 'tax_card':
        return { title: t('licensingTrack.steps.tax_card.title'), hint: t('licensingTrack.steps.tax_card.hint') }
      case 'civil_protection':
        return { title: t('licensingTrack.steps.civil_protection.title'), hint: t('licensingTrack.steps.civil_protection.hint') }
      case 'staff_papers':
        return { title: t('licensingTrack.steps.staff_papers.title'), hint: t('licensingTrack.steps.staff_papers.hint') }
      case 'health_certs':
        return { title: t('licensingTrack.steps.health_certs.title'), hint: t('licensingTrack.steps.health_certs.hint') }
      case 'apply_directorate':
        return { title: t('licensingTrack.steps.apply_directorate.title'), hint: t('licensingTrack.steps.apply_directorate.hint') }
      case 'inspection':
        return { title: t('licensingTrack.steps.inspection.title'), hint: t('licensingTrack.steps.inspection.hint') }
      case 'temp_license':
        return { title: t('licensingTrack.steps.temp_license.title'), hint: t('licensingTrack.steps.temp_license.hint') }
      case 'permanent_license':
        return { title: t('licensingTrack.steps.permanent_license.title'), hint: t('licensingTrack.steps.permanent_license.hint') }
    }
  }

  const statusLabel = (s: LicensingStepStatus): string =>
    s === 'done'
      ? t('licensingTrack.statusDone')
      : s === 'na'
        ? t('licensingTrack.statusNa')
        : t('licensingTrack.statusTodo')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="type-title flex items-center gap-2">
        <Route size={22} />
        {t('licensingTrack.title')}
      </h1>
      <p className="type-secondary text-muted">{t('licensingTrack.intro')}</p>

      <Card className="flex items-center justify-between">
        <span className="type-section">
          {t('licensingTrack.progress', { done: doneCount, total: LICENSING_STEP_KEYS.length })}
        </span>
        <span className="type-title">{pct}%</span>
      </Card>
      <div className="h-2 rounded-full bg-soft overflow-hidden">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>

      {LICENSING_STEP_KEYS.map((key, i) => {
        const status = steps.data.get(key) ?? 'todo'
        return (
          <Card key={key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="type-body font-semibold">
                {i + 1}. {stepText(key).title}
              </span>
              <Button
                size="sm"
                variant={status === 'done' ? 'primary' : 'soft'}
                onClick={async () => {
                  try {
                    await api.setStepStatus(nurseryId, key, NEXT[status])
                    void qc.invalidateQueries({
                      queryKey: ['licensing-steps', nurseryId],
                    })
                  } catch {
                    showToast(t('common.errorGeneric'), 'error')
                  }
                }}
              >
                {statusLabel(status)}
              </Button>
            </div>
            <p className="type-secondary text-muted">{stepText(key).hint}</p>
          </Card>
        )
      })}
      <p className="type-secondary text-muted">{t('licensingTrack.disclaimer')}</p>
    </div>
  )
}
