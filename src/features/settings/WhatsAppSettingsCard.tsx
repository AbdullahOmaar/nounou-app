import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, TextInput } from '../../components/ui/form'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as wa from './whatsapp'

/**
 * 2.2: بطاقة بوابات تفعيل واتساب (نمط 3A-300) — إعداد الحضانة +
 * حالة البوابات الأربع بالترتيب + سجل المحاولات. لا إرسال فعلي:
 * الإرسال يحتاج رقم Meta معتمداً (قرار تجاري للمالك).
 */
export function WhatsAppSettingsCard({ nurseryId }: { nurseryId: string }) {
  const t = useT()
  const showToast = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [phoneId, setPhoneId] = useState('')
  const [displayPhone, setDisplayPhone] = useState('')
  const [tplStatus, setTplStatus] = useState<'none' | 'submitted' | 'approved'>('none')
  const [enabled, setEnabled] = useState(false)

  const config = useQuery({
    queryKey: ['whatsapp-config', nurseryId],
    queryFn: () => wa.getWhatsAppConfig(nurseryId),
  })
  const gate = useQuery({
    queryKey: ['whatsapp-gate', nurseryId],
    queryFn: () => wa.whatsAppGate(nurseryId),
  })
  const log = useQuery({
    queryKey: ['whatsapp-log', nurseryId],
    queryFn: () => wa.listWhatsAppLog(nurseryId),
  })
  useEffect(() => {
    if (config.data) {
      setPhoneId(config.data.phone_number_id ?? '')
      setDisplayPhone(config.data.display_phone ?? '')
      setTplStatus(config.data.template_status)
      setEnabled(config.data.enabled)
    }
  }, [config.data])

  const refresh = () =>
    invalidatePrefixes(qc, ['whatsapp-config', 'whatsapp-gate', 'whatsapp-log'])
  const save = useMutation({
    mutationFn: () =>
      wa.saveWhatsAppConfig(nurseryId, user?.id ?? null, {
        phone_number_id: phoneId.trim() || null,
        display_phone: displayPhone.trim() || null,
        template_status: tplStatus,
        enabled,
      }),
    onSuccess: () => {
      refresh()
      showToast(t('common.savedOk'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const test = useMutation({
    mutationFn: () => wa.whatsAppEnqueueTest(nurseryId),
    onSuccess: (status) => {
      refresh()
      showToast(t('settings.wa.testResult', { status }))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const g = gate.data ?? 'kill_switch'
  const steps: { label: string; pass: boolean }[] = [
    { label: t('settings.wa.gateKillSwitch'), pass: g !== 'kill_switch' },
    {
      label: t('settings.wa.gateConfigured'),
      pass: g !== 'kill_switch' && g !== 'not_configured',
    },
    {
      label: t('settings.wa.gateEnabled'),
      pass: !['kill_switch', 'not_configured', 'not_enabled'].includes(g),
    },
    { label: t('settings.wa.gateTemplate'), pass: g === 'ready' },
  ]

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="type-section">{t('settings.wa.title')}</h2>
      <p className="type-secondary text-muted">{t('settings.wa.body')}</p>
      <div className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <span key={s.label} className="flex items-center gap-2 type-body">
            {s.pass ? (
              <Check size={16} className="text-good-text" />
            ) : (
              <X size={16} className="text-bad-text" />
            )}
            {s.label}
          </span>
        ))}
      </div>
      <Field label={t('settings.wa.phoneId')}>
        <TextInput value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
      </Field>
      <Field label={t('settings.wa.displayPhone')}>
        <TextInput
          value={displayPhone}
          onChange={(e) => setDisplayPhone(e.target.value)}
        />
      </Field>
      <Field label={t('settings.wa.templateStatus')}>
        <ChipRow>
          <Chip active={tplStatus === 'none'} onClick={() => setTplStatus('none')}>
            {t('settings.wa.tplNone')}
          </Chip>
          <Chip
            active={tplStatus === 'submitted'}
            onClick={() => setTplStatus('submitted')}
          >
            {t('settings.wa.tplSubmitted')}
          </Chip>
          <Chip
            active={tplStatus === 'approved'}
            onClick={() => setTplStatus('approved')}
          >
            {t('settings.wa.tplApproved')}
          </Chip>
        </ChipRow>
      </Field>
      <Field label={t('settings.wa.enabled')}>
        <ChipRow>
          <Chip active={enabled} onClick={() => setEnabled(true)}>
            {t('settings.wa.on')}
          </Chip>
          <Chip active={!enabled} onClick={() => setEnabled(false)}>
            {t('settings.wa.off')}
          </Chip>
        </ChipRow>
      </Field>
      <span className="flex gap-2">
        <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
        <Button
          variant="soft"
          className="flex-1"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          {t('settings.wa.test')}
        </Button>
      </span>
      {(log.data ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="type-badge text-muted">{t('settings.wa.logTitle')}</span>
          {(log.data ?? []).map((row) => (
            <span key={row.id} className="type-badge text-muted">
              {row.created_at.slice(0, 16).replace('T', ' ')} • {row.template} •{' '}
              {row.status}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
