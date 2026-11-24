import { beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueReport,
  flushReports,
  pendingReportCount,
  type QueuedReport,
} from './offlineQueue'

const draft = {
  meals: [],
  nap_from: null,
  nap_to: null,
  nap_slept: null,
  activities: [],
  mood: null,
  note: null,
} as QueuedReport['draft']

function entry(childId: string, note: string): Omit<QueuedReport, 'queuedAt'> {
  return {
    nurseryId: 'n1',
    classDayId: 'd1',
    childId,
    draft: { ...draft, note },
    actorId: 'u1',
  }
}

describe('offline report queue (415/S3)', () => {
  beforeEach(() => localStorage.clear())

  it('آخر كتابة لنفس الطفل/اليوم تغلب (لا تكرار)', () => {
    enqueueReport(entry('c1', 'first'))
    enqueueReport(entry('c1', 'second'))
    expect(pendingReportCount('n1')).toBe(1)
  })

  it('العدّاد مقيد بالحضانة', () => {
    enqueueReport(entry('c1', 'a'))
    enqueueReport({ ...entry('c2', 'b'), nurseryId: 'n2' })
    expect(pendingReportCount('n1')).toBe(1)
    expect(pendingReportCount('n2')).toBe(1)
  })

  it('التفريغ الناجح يمسح، والفاشل يبقى ظاهراً في الطابور', async () => {
    enqueueReport(entry('c1', 'ok'))
    enqueueReport(entry('c2', 'fail'))
    const flushed = await flushReports('n1', async (e) => {
      if (e.childId === 'c2') throw new Error('network')
    })
    expect(flushed).toBe(1)
    expect(pendingReportCount('n1')).toBe(1)
  })

  it('الطابور يصمد أمام إعادة القراءة (محاكاة إغلاق التطبيق)', () => {
    enqueueReport(entry('c1', 'persisted'))
    // قراءة جديدة من التخزين مباشرة — كما بعد إعادة فتح التطبيق
    expect(pendingReportCount('n1')).toBe(1)
  })
})
