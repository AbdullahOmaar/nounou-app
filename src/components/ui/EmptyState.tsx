import type { ComponentType } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from './Button'
import { Mascot, type MascotState } from '../mascot/Mascot'

export type IconComponent = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>

interface EmptyStateProps {
  /** أيقونة Lucide (مكوّن) — لا إيموجي في الواجهة نهائياً (بحث §5) */
  icon?: IconComponent
  title: string
  hint?: string
  /** زر إجراء اختياري تحت الإرشاد — أيقونة اختيارية (لغة الأيقونة أولاً 3A-317) */
  action?: { label: string; onClick: () => void; icon?: IconComponent }
  /**
   * إظهار نونا (وجهها) بدل دائرة الأيقونة — الحالات الفارغة أولى
   * نقاط ظهور الشخصية (DESIGN §3). اختياري بالكامل: غيابه يُبقي
   * الشكل الحالي حرفياً.
   */
  mascot?: boolean
  /**
   * وضع نونا المعروض عند تفعيل mascot: الافتراضي «empty» (الوجه)
   * للفراغ العام وأسطح «غير موجود».
   */
  mascotPose?: MascotState
}

/** حالة الفراغ الكاملة — أيقونة Lucide + عنوان + إرشاد + زر إجراء اختياري (بحث §5) */
export function EmptyState({ icon: Icon = FolderOpen, title, hint, action, mascot = false, mascotPose = 'empty' }: EmptyStateProps) {
  const ActionIcon = action?.icon
  const iconCircle = (
    <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-soft text-primary flex items-center justify-center">
      <Icon size={28} />
    </div>
  )
  return (
    <div className="text-center py-10 px-4">
      {mascot ? (
        <div className="mx-auto mb-2 w-fit">
          {/* عند إيقاف الماسكوت من الإعدادات ترجع دائرة الأيقونة كما كانت */}
          <Mascot state={mascotPose} size={92} fallback={iconCircle} />
        </div>
      ) : (
        iconCircle
      )}
      <div className="type-section mb-1">{title}</div>
      {hint && <div className="text-muted type-secondary">{hint}</div>}
      {action && (
        <div className="mt-4">
          <Button onClick={action.onClick}>
            {ActionIcon ? <ActionIcon size={18} /> : null}
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}
