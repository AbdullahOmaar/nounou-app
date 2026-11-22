import { CloudOff } from 'lucide-react'
import { useOnlineStatus } from '../../features/classday/hooks'
import { t } from '../../i18n'

/**
 * شريط الأوفلاين العام: يظهر عند انقطاع الاتصال في أي شاشة — شغل
 * الحضور محفوظ على الجهاز ويرتفع تلقائياً عند عودة الاتصال.
 */
export function OfflineStrip({ containerCls }: { containerCls: string }) {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div role="status" className="bg-warn-soft border-b border-warn/50 text-warn-text">
      <div className={`mx-auto ${containerCls} px-4 py-1.5 flex items-center gap-2`}>
        <CloudOff size={16} className="shrink-0" />
        <span className="flex-1 text-[13px] font-semibold">{t('common.offline')}</span>
      </div>
    </div>
  )
}
