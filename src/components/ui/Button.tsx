import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'soft' | 'accent' | 'ok' | 'dangerGhost'
type Size = 'md' | 'sm'

const variants: Record<Variant, string> = {
  // نص الزر الأساسي عبر توكن --on-primary: أبيض في الفاتح، داكن في الداكن
  // (الأبيض على أساسي الداكن #9DB8E8 كان 2.01:1 — الداكن عليه 8.59:1)
  primary: 'bg-primary text-on-primary hover:bg-primary-d',
  ghost: 'bg-transparent border border-border-interactive text-text hover:bg-soft',
  danger: 'bg-bad text-white hover:opacity-90',
  soft: 'bg-soft text-primary hover:opacity-90',
  // كهرماني (هوية نونو — الموجة 1): الزر الوحيد بلون التمييز في الشاشة
  // (زر QR للحضور + زر الدخول) — نص داكن #4A2E00 عليه (6.16:1، §2.1.1)
  accent: 'bg-accent text-on-accent hover:opacity-90',
  // اعتماد مالي (هوية نونو — الموجة 4): أخضر الحالة بحشوة كاملة ونص عبر
  // توكن --on-ok (أبيض على #166B4D = 6.47:1 فاتح؛ داكن على #34D399 داكن)
  ok: 'bg-ok text-on-ok hover:opacity-90',
  // رفض مالي: حدّ ونصّ بلون الخطر على شفاف — أهدى من الحشوة الكاملة
  dangerGhost: 'bg-transparent border border-bad text-bad-text hover:bg-bad-soft',
}

// سلم أحجام موحّد (3A-317 — تدقيق الأزرار): md هو الأساس (هدف لمس 48px)،
// وsm للأزرار الثانوية داخل البطاقات (40px — لمس سليم وأخف بصرياً)
const sizes: Record<Size, string> = {
  md: 'px-4 min-h-[48px] text-[15px] rounded-xl',
  sm: 'px-3 min-h-[40px] text-[13.5px] rounded-[10px]',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  full?: boolean
}

/** زر موحد: هدف لمس 48px، انحناء 12px، نص 15px (سلم الخط — بحث §5) */
export function Button({ variant = 'primary', size = 'md', full = false, className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    />
  )
}
