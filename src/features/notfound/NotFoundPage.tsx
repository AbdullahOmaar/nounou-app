import { useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { t } from '../../i18n'

/** صفحة 404: أي رابط خاطئ يعرض رسالة واضحة + رجوع للرئيسية */
export function NotFoundPage({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate()
  const body = (
    <EmptyState
      mascot
      icon={Home}
      title={t('common.notFoundTitle')}
      hint={t('common.notFoundHint')}
      action={{ label: t('common.notFoundHome'), onClick: () => navigate('/') }}
    />
  )
  if (!standalone) return <div className="rise-in">{body}</div>
  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center p-4">
      <div className="max-w-sm w-full rise-in">{body}</div>
    </div>
  )
}
