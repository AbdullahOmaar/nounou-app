import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'nounou-active-nursery'
const EVENT = 'nounou-workspace-changed'

/**
 * الحضانة النشطة: معرّف الحضانة التي يعمل المستخدم في سياقها الآن.
 * الافتراضي null = أول حضانة يملكها/يعمل بها (يختارها حلّ الهوية).
 * كل الهوكس تقرأ البيانات بهذا المعرّف — نمط مساحة عمل المدرس نفسه.
 */
function getActiveNurseryId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setActiveNurseryId(nurseryId: string | null) {
  try {
    if (nurseryId) localStorage.setItem(STORAGE_KEY, nurseryId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // تجاهل: التخزين المحلي غير متاح
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** قراءة تفاعلية للحضانة النشطة (تتحدث فوراً عند التبديل) */
export function useActiveNurseryId(): string | null {
  return useSyncExternalStore(subscribe, getActiveNurseryId, () => null)
}
