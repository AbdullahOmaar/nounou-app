/**
 * علم إيقاف للعمليات الجماعية (4.9 — «الإيقاف حق بشري»):
 * الحلقة تفحص العلم بين العناصر وتقف بنظافة، والمستدعي يبلّغ
 * بإكمال جزئي صريح (اتنفذ X من Y). لا إلغاء لعنصر بدأ فعلاً.
 */
export interface StopFlag {
  stop: () => void
  shouldStop: () => boolean
}

export function makeStopFlag(): StopFlag {
  let stopped = false
  return {
    stop: () => {
      stopped = true
    },
    shouldStop: () => stopped,
  }
}
