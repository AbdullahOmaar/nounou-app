import type { ReactNode } from 'react'

/**
 * حضور نونا العام (موجة الهوية 6 — قرارا 4 و6 معتمدان): نفس واجهة
 * مكوّن الماسكوت المنقولة من هيكل تطبيق المدرس، لكن الرسم لم يعد
 * البرعم التجريدي المؤقت: الحالة الافتراضية = علامة نونا المعتمدة
 * (قصّة الأيقونة — الدبدوب بالفيونكة في المربع الكحلي، نفس شعار
 * التطبيق)، وحالة «empty» = وجه نونا (قصّة الوجه) لأن الفراغ
 * والتنبيه اللطيف هما دور الشخصية في DESIGN §3.
 * قواعد §3 محفوظة: المالية والإدارية بلا حضور شخصية — ترويسة
 * AppShell تُخفي العلامة أصلاً على شاشتي الفواتير والمزيد الجذريتين،
 * وحالة الوجه لا تُطلب إلا من أسطح مرحّبة (فراغ/بوابة/404).
 * «error» مع fallback يعيد الـfallback كما كان (عقد EmptyState).
 */
export type MascotState =
  | 'idle'
  | 'loading'
  | 'thinking'
  | 'empty'
  | 'error'
  | 'success'
  | 'offline'

interface MascotProps {
  state?: MascotState
  size?: number
  still?: boolean
  className?: string
  fallback?: ReactNode
}

export function Mascot({
  state = 'idle',
  size = 48,
  className,
  fallback,
}: MascotProps) {
  if (state === 'error' && fallback) return <>{fallback}</>
  if (state === 'empty') {
    return (
      <img
        src="/nouna/nouna-face.png"
        width={size}
        height={size}
        className={`rounded-2xl object-cover ${className ?? ''}`}
        role="img"
        aria-label="Nouna"
        alt=""
      />
    )
  }
  return (
    <img
      src="/nouna/nouna-icon.png"
      width={size}
      height={size}
      className={`rounded-[24%] object-cover ${className ?? ''}`}
      role="img"
      aria-label="Nounou"
      alt=""
    />
  )
}
