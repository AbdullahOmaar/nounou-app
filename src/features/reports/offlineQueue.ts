import type { ReportDraft } from './api'

/**
 * طابور تقارير وصور أوفلاين (415 + حراسة الفقدان الصامت S3):
 * التقارير (JSON صغير) في localStorage، والصور (Blobs) في
 * IndexedDB — وكلاهما يصمد أمام إغلاق التطبيق، وعدّاد معلّق ظاهر
 * دائماً في صفحة التقارير حتى يُفرَّغ الطابور. لا عملية تضيع
 * بصمت: الفشل يُبقي العملية في الطابور لا في ذاكرة React Query.
 */
const REPORTS_KEY = 'nounou-report-queue-v1'

export interface QueuedReport {
  nurseryId: string
  classDayId: string
  childId: string
  draft: ReportDraft
  actorId: string | null
  queuedAt: string
}

function readReports(): QueuedReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedReport[]) : []
  } catch {
    return []
  }
}

function writeReports(entries: QueuedReport[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(REPORTS_KEY)
    else localStorage.setItem(REPORTS_KEY, JSON.stringify(entries))
  } catch {
    // تخزين ممتلئ/محظور — تبقى العمليات ظاهرة في عدّاد الجلسة
  }
}

export function enqueueReport(entry: Omit<QueuedReport, 'queuedAt'>): void {
  const entries = readReports()
  const idx = entries.findIndex(
    (e) => e.classDayId === entry.classDayId && e.childId === entry.childId,
  )
  const stamped = { ...entry, queuedAt: new Date().toISOString() }
  if (idx >= 0) entries[idx] = stamped
  else entries.push(stamped)
  writeReports(entries)
}

export function pendingReportCount(nurseryId: string): number {
  return readReports().filter((e) => e.nurseryId === nurseryId).length
}

export async function flushReports(
  nurseryId: string,
  write: (entry: QueuedReport) => Promise<void>,
): Promise<number> {
  const entries = readReports()
  const mine = entries.filter((e) => e.nurseryId === nurseryId)
  const rest = entries.filter((e) => e.nurseryId !== nurseryId)
  let flushed = 0
  const failed: QueuedReport[] = []
  for (const entry of mine) {
    try {
      await write(entry)
      flushed++
    } catch {
      failed.push(entry)
    }
  }
  writeReports([...rest, ...failed])
  return flushed
}

/* ---------------- الصور: IndexedDB (Blobs لا تسعها localStorage) -------- */

export interface QueuedPhoto {
  id: string
  nurseryId: string
  classDayId: string
  childIds: string[]
  caption: string | null
  actorId: string | null
  blob: Blob
  queuedAt: string
}

const DB_NAME = 'nounou-offline'
const STORE = 'photo-queue'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbAll(db: IDBDatabase): Promise<QueuedPhoto[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as QueuedPhoto[])
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, entry: QueuedPhoto): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function enqueuePhoto(
  entry: Omit<QueuedPhoto, 'id' | 'queuedAt'>,
): Promise<void> {
  const db = await openDb()
  await idbPut(db, {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
  })
  db.close()
}

export async function pendingPhotoCount(nurseryId: string): Promise<number> {
  try {
    const db = await openDb()
    const all = await idbAll(db)
    db.close()
    return all.filter((e) => e.nurseryId === nurseryId).length
  } catch {
    return 0
  }
}

export async function flushPhotos(
  nurseryId: string,
  upload: (entry: QueuedPhoto) => Promise<void>,
): Promise<number> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return 0
  }
  const all = await idbAll(db)
  let flushed = 0
  for (const entry of all.filter((e) => e.nurseryId === nurseryId)) {
    try {
      await upload(entry)
      await idbDelete(db, entry.id)
      flushed++
    } catch {
      // تبقى في الطابور للمحاولة التالية — ظاهرة في العدّاد
    }
  }
  db.close()
  return flushed
}
