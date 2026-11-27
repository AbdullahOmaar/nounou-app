import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import * as api from './api'
import { useSettingsMutations } from './hooks'

/**
 * إشعارات الدفع للطاقم (3A-412 خطوة خادمية): opt-in لكل حضانة يفعّله
 * المالك وحده (تحديث nursery_settings مالك فقط في RLS). عند التفعيل،
 * مشغّلات أحداث الطاقم (إثبات دفع مقدَّم، طلب جولة جديد) تُدرج في
 * صندوق push_outbox، ودالة send-push ترسلها عبر FCM كل دقيقة.
 * ملحوظة: الإرسال الفعلي يحتاج سرّ حساب خدمة Firebase
 * (FCM_SERVICE_ACCOUNT) — بدونه تبقى الصفوف queued.
 */
export function PushSettingsCard({ nurseryId }: { nurseryId: string }) {
  const t = useT()
  const showToast = useToast()
  const mutations = useSettingsMutations()
  const [enabled, setEnabled] = useState(false)

  const settings = useQuery({
    queryKey: ['nursery-settings', nurseryId],
    queryFn: () => api.getNurserySettings(nurseryId),
  })
  useEffect(() => {
    if (settings.data) setEnabled(settings.data.push_enabled)
  }, [settings.data])

  return (
    <Card>
      <div className="type-body mb-1 inline-flex items-center gap-2">
        <Bell size={18} />
        {t('settings.push.title')}
      </div>
      <p className="type-secondary text-muted mb-3">
        {t('settings.push.body')}
      </p>
      <label className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="type-secondary">{t('settings.push.enabledLabel')}</span>
      </label>
      <p className="type-secondary text-muted mb-3">
        {t('settings.push.eventsHint')}
      </p>
      <Button
        disabled={mutations.updateSettings.isPending}
        onClick={async () => {
          await mutations.updateSettings.mutateAsync({
            push_enabled: enabled,
          })
          showToast(t('common.savedOk'))
        }}
      >
        {t('common.save')}
      </Button>
    </Card>
  )
}
