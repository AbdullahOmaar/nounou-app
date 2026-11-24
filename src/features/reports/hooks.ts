import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'
import {
  flushPhotos,
  flushReports,
  pendingPhotoCount,
  pendingReportCount,
} from './offlineQueue'

/**
 * مزامنة أوفلاين للتقارير والصور (415): عدّاد معلّق موحّد + تفريغ
 * عند عودة الاتصال وكل 30 ثانية وعند فتح الصفحة. أي فشل يُبقي
 * العملية في طابورها — لا فقدان صامت (حراسة S3).
 */
export function useReportsOfflineSync(nurseryId: string | null) {
  const qc = useQueryClient()
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    if (!nurseryId) return
    let alive = true
    const recount = async () => {
      const photos = await pendingPhotoCount(nurseryId)
      if (alive) setQueued(pendingReportCount(nurseryId) + photos)
    }
    const flush = async () => {
      if (!navigator.onLine) return
      const r = await flushReports(nurseryId, (e) =>
        api.upsertReport(e.nurseryId, e.classDayId, e.childId, e.draft, e.actorId),
      )
      const p = await flushPhotos(nurseryId, async (e) => {
        const file = new File([e.blob], 'queued-photo.jpg', {
          type: e.blob.type || 'image/jpeg',
        })
        await api.uploadPhotos(
          e.nurseryId,
          e.classDayId,
          e.actorId,
          [file],
          e.childIds,
          e.caption,
        )
      })
      if (r + p > 0) {
        invalidatePrefixes(qc, ['day-reports', 'day-photos', 'home', 'child-photos'])
      }
      await recount()
    }
    void recount()
    window.addEventListener('online', flush)
    const timer = setInterval(flush, 30_000)
    void flush()
    return () => {
      alive = false
      window.removeEventListener('online', flush)
      clearInterval(timer)
    }
  }, [nurseryId, qc])

  return { queued, recountQueued: () => void (async () => {
    if (!nurseryId) return
    const photos = await pendingPhotoCount(nurseryId)
    setQueued(pendingReportCount(nurseryId) + photos)
  })() }
}
