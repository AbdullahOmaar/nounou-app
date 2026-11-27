import { Sparkles } from 'lucide-react'
import { useT } from '../../i18n'

/**
 * إفصاح المحتوى المولّد (3.14): أي أصل مولّد بالذكاء الاصطناعي
 * يظهر على أسطح الحضانة يحمل هذا الشارة ظاهرة — قاعدة حديدية
 * موثقة في docs/CONTENT-PROTECTION.md.
 */
export function AiDisclosure() {
  const t = useT()
  return (
    <span className="type-badge inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5">
      <Sparkles size={12} />
      {t('common.aiGenerated')}
    </span>
  )
}
