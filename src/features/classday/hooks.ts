import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'
import { enqueueAttendance, flushQueue, pendingCount } from './offlineQueue'

/** حالة الاتصال الحية (أحداث online/offline) */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useClassDay(classId: string | undefined, date: string) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['class-day', nurseryId, classId, date],
    enabled: Boolean(nurseryId && classId),
    queryFn: () => api.getOrCreateClassDay(nurseryId!, classId!, date),
  })
}

export function useDayChildren(
  classId: string | undefined,
  classDayId: string | undefined,
) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['day-children', nurseryId, classId, classDayId],
    enabled: Boolean(nurseryId && classId && classDayId),
    queryFn: () => api.listDayChildren(nurseryId!, classId!, classDayId!),
  })
}

/**
 * كتابة حضور مع سقوط أوفلاين: محاولة مباشرة، وعند الفشل/غياب الاتصال
 * تُطابَق العملية وتُفرَّغ عند عودة النت (مستمع online + فحص دوري خفيف).
 */
export function useAttendanceWriter() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const { user } = useAuth()
  const qc = useQueryClient()
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    if (!nurseryId) return
    setQueued(pendingCount(nurseryId))
    const flush = async () => {
      if (!navigator.onLine) return
      const n = await flushQueue(nurseryId, api.upsertAttendance)
      if (n > 0) {
        invalidatePrefixes(qc, ['day-children', 'home'])
      }
      setQueued(pendingCount(nurseryId))
    }
    window.addEventListener('online', flush)
    const timer = setInterval(flush, 30_000)
    void flush()
    return () => {
      window.removeEventListener('online', flush)
      clearInterval(timer)
    }
  }, [nurseryId, qc])

  const write = useMutation({
    // ‏networkMode ‏'always' مقصود: الوضع الافتراضي في React Query يُعلّق
    // الـmutation صامتاً عند انقطاع الاتصال فلا يعمل mutationFn ولا onError
    // إطلاقاً — فيتجاوز طابور localStorage كلياً ولا تظهر لافتة الانتظار،
    // وتضيع الكتابة إن أُغلق التطبيق وهو أوفلاين. بـ'always' يعمل
    // mutationFn فوراً فيرمي 'offline' ويُطابَق في onError كما صُمم.
    // (اكتشاف فحص 0.1 — فيز 2، 2026-11-24: فلو E2E 09 كان يموت عند
    // انتظار اللافتة والطابور فارغ رغم onLine=false المؤكد)
    networkMode: 'always',
    mutationFn: async (payload: api.AttendanceUpsert) => {
      if (!navigator.onLine) throw new Error('offline')
      await api.upsertAttendance(payload)
    },
    onError: (_err, payload) => {
      if (nurseryId) {
        enqueueAttendance(nurseryId, payload)
        setQueued(pendingCount(nurseryId))
      }
    },
    onSettled: () => {
      invalidatePrefixes(qc, ['day-children', 'home'])
    },
  })

  return { write, queued, actorId: user?.id ?? null, nurseryId }
}

export function useChildAttendance(childId: string | undefined) {
  return useQuery({
    queryKey: ['child-attendance', childId],
    enabled: Boolean(childId),
    queryFn: () => api.listChildAttendance(childId!),
  })
}
