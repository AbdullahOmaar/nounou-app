import type { AttendanceUpsert } from './api'

/**
 * طابور حضور أوفلاين (نمط المدرس المبسّط): عمليات upsert حضور/استلام
 * تُحفظ في localStorage عند غياب الاتصال أو فشل الكتابة، وتُفرَّغ
 * بالترتيب عند عودة النت. المفتاح مقيد بالحضانة حتى لا تتسرب عمليات
 * حضانة لجلسة أخرى (درس SEC-L5 عند المدرس).
 */
const QUEUE_KEY = 'nounou-attendance-queue-v1'

interface QueueEntry {
  nurseryId: string
  payload: AttendanceUpsert
  queuedAt: string
}

function readQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueueEntry[]) : []
  } catch {
    return []
  }
}

function writeQueue(entries: QueueEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(QUEUE_KEY)
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  } catch {
    // تخزين ممتلئ/محظور: العمليات تبقى في الذاكرة لهذه الجلسة فقط
  }
}

export function enqueueAttendance(nurseryId: string, payload: AttendanceUpsert): void {
  const entries = readQueue()
  // آخر كتابة لنفس الطفل/اليوم تغلب (دمج سطحي للحقول)
  const idx = entries.findIndex(
    (e) =>
      e.payload.class_day_id === payload.class_day_id &&
      e.payload.child_id === payload.child_id,
  )
  if (idx >= 0) {
    entries[idx] = {
      nurseryId,
      payload: { ...entries[idx].payload, ...payload },
      queuedAt: new Date().toISOString(),
    }
  } else {
    entries.push({ nurseryId, payload, queuedAt: new Date().toISOString() })
  }
  writeQueue(entries)
}

export function pendingCount(nurseryId: string): number {
  return readQueue().filter((e) => e.nurseryId === nurseryId).length
}

export async function flushQueue(
  nurseryId: string,
  write: (payload: AttendanceUpsert) => Promise<void>,
): Promise<number> {
  const entries = readQueue()
  const mine = entries.filter((e) => e.nurseryId === nurseryId)
  const rest = entries.filter((e) => e.nurseryId !== nurseryId)
  let flushed = 0
  const failed: QueueEntry[] = []
  for (const entry of mine) {
    try {
      await write(entry.payload)
      flushed++
    } catch {
      failed.push(entry)
    }
  }
  writeQueue([...rest, ...failed])
  return flushed
}
