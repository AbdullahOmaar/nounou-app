import type { ReactNode } from 'react'

/**
 * علامة نونو البصرية — بديل خفيف داخل نفس واجهة مكوّن الماسكوت المنقولة
 * من هيكل تطبيق المدرس (توافق استيراد فقط): نونو منتج مستقل بلا تميمة
 * معتمدة، فالعلامة رسم تجريدي (برعم نابت في مربع ملوّن ناعم) بلا شخصية.
 * الحالات (state) تُقبل للتوافق ولا تغيّر الرسم إلا باهتاً في «empty».
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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Nounou"
    >
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#3B3FA3" />
      <path
        d="M32 46c0-10 0-16 0-22"
        stroke="#FFA726"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M32 30c-8 0-13-5-13-13 8 0 13 5 13 13z"
        fill="#00D2FF"
        opacity={state === 'empty' ? 0.55 : 1}
      />
      <path
        d="M32 26c0-8 5-13 13-13 0 8-5 13-13 13z"
        fill="#7EE2FF"
        opacity={state === 'empty' ? 0.55 : 1}
      />
      <circle cx="32" cy="49" r="3" fill="#FFA726" />
    </svg>
  )
}
