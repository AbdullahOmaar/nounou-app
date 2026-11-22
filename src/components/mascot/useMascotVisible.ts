import { useEffect, useState } from 'react'

/**
 * توافق هيكل المدرس: لا مفتاح إخفاء تميمة في نونو (لا تميمة أصلاً) —
 * العلامة ظاهرة دائماً، وقراءة المرآة تعيد true باستمرار.
 */
export function useMascotVisible(): boolean {
  return true
}

export function readMascotMirror(): boolean | null {
  return true
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
