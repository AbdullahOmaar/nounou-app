import { requireSupabase } from '../../lib/supabase'
import type { ChildPhotoRow, DailyReportRow, MealEntry } from '../../types/database'
import { compressImage } from './photoUtils'

export async function listReportsForDay(
  classDayId: string,
): Promise<DailyReportRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('daily_reports')
    .select('*')
    .eq('class_day_id', classDayId)
  if (error) throw error
  return (data ?? []) as DailyReportRow[]
}

export interface ReportDraft {
  meals: MealEntry[]
  nap_from: string | null
  nap_to: string | null
  nap_slept: boolean | null
  activities: string[]
  mood: DailyReportRow['mood']
  note: string | null
}

/** حفظ تقرير طفل (upsert على اليوم × الطفل) — النشر خطوة منفصلة صريحة */
export async function upsertReport(
  nurseryId: string,
  classDayId: string,
  childId: string,
  draft: ReportDraft,
  actorId: string | null,
): Promise<void> {
  const db = requireSupabase()
  // X2 (3A-378): بوابة حضور في طبقة التطبيق — الغائب/في إجازة لا
  // تقرير له (المشغّل daily_reports_absent_trg في 0017 هو الحارس
  // الأخير للاستدعاءات المباشرة).
  const { data: att, error: attErr } = await db
    .from('attendance')
    .select('status')
    .eq('class_day_id', classDayId)
    .eq('child_id', childId)
    .maybeSingle()
  if (attErr) throw attErr
  const status = (att as { status: string } | null)?.status
  if (status === 'absent' || status === 'leave') {
    throw new Error('report_for_absent_child')
  }
  const { error } = await db.from('daily_reports').upsert(
    {
      nursery_id: nurseryId,
      class_day_id: classDayId,
      child_id: childId,
      meals: draft.meals,
      nap_from: draft.nap_from,
      nap_to: draft.nap_to,
      nap_slept: draft.nap_slept,
      activities: draft.activities,
      mood: draft.mood,
      note: draft.note,
      created_by: actorId,
    },
    { onConflict: 'class_day_id,child_id' },
  )
  if (error) throw error
}

/**
 * نشر تقارير اليوم دفعة واحدة (تظهر في البوابات فوراً) — X2 (3A-378):
 * تقارير الغائبين/في إجازة لا تُنشر إطلاقاً (كُتبت والطفل حاضر ثم
 * تغيّر حضوره): تُستثنى هنا، والمشغّل daily_reports_absent_trg
 * في 0017 يرفض نشرها مباشرةً أيضاً.
 */
export async function publishDayReports(classDayId: string): Promise<number> {
  const db = requireSupabase()
  const [reportsRes, attRes] = await Promise.all([
    db
      .from('daily_reports')
      .select('id, child_id')
      .eq('class_day_id', classDayId)
      .is('published_at', null),
    db.from('attendance').select('child_id, status').eq('class_day_id', classDayId),
  ])
  if (reportsRes.error) throw reportsRes.error
  if (attRes.error) throw attRes.error
  const absentIds = new Set(
    ((attRes.data ?? []) as { child_id: string; status: string }[])
      .filter((a) => a.status === 'absent' || a.status === 'leave')
      .map((a) => a.child_id),
  )
  const publishable = ((reportsRes.data ?? []) as { id: string; child_id: string }[]).filter(
    (r) => !absentIds.has(r.child_id),
  )
  if (publishable.length === 0) return 0
  const { data, error } = await db
    .from('daily_reports')
    .update({ published_at: new Date().toISOString() })
    .in(
      'id',
      publishable.map((r) => r.id),
    )
    .select('id')
  if (error) throw error
  return (data ?? []).length
}

export async function listPhotosForDay(
  classDayId: string,
): Promise<(ChildPhotoRow & { childIds: string[]; url: string | null })[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('child_photos')
    .select('*')
    .eq('class_day_id', classDayId)
    .order('created_at')
  if (error) throw error
  const photos = (data ?? []) as ChildPhotoRow[]
  if (photos.length === 0) return []
  const { data: links, error: linkErr } = await db
    .from('photo_children')
    .select('photo_id, child_id')
    .in('photo_id', photos.map((p) => p.id))
  if (linkErr) throw linkErr
  const byPhoto = new Map<string, string[]>()
  for (const l of links ?? []) {
    const arr = byPhoto.get(l.photo_id as string) ?? []
    arr.push(l.child_id as string)
    byPhoto.set(l.photo_id as string, arr)
  }
  // سجل مشاهدات الطاقم (4.14): العرض داخل التطبيق مشاهدة
  // موثقة. التسجيل جهد أفضل — فشله لا يحجب الصور عن الطاقم
  // (استثناء موثق كتحليلات 3.3).
  if (photos.length > 0) {
    try {
      await db.rpc('log_staff_photo_views', {
        p_photo_ids: photos.map((p) => p.id),
      })
    } catch {
      // documented best-effort: viewing is the primary right
    }
  }
  const withUrls = await Promise.all(
    photos.map(async (p) => {
      const { data: signed } = await db.storage
        .from('child-media')
        .createSignedUrl(p.storage_path, 3600)
      return { ...p, childIds: byPhoto.get(p.id) ?? [], url: signed?.signedUrl ?? null }
    }),
  )
  return withUrls
}

/**
 * 420: تصدير صور اليوم جماعياً كملف ZIP — تنزيل كل صورة من التخزين
 * بصلاحية العضو ثم ضغط تخزيني (JPEG مضغوط أصلاً) عبر fflate.
 */
export async function downloadDayPhotosZip(
  classDayId: string,
): Promise<{ blob: Blob; count: number }> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('child_photos')
    .select('id, storage_path')
    .eq('class_day_id', classDayId)
    .order('created_at')
  if (error) throw error
  const photos = (data ?? []) as { id: string; storage_path: string }[]
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  let done = 0
  for (const p of photos) {
    const { data: blob, error: dErr } = await db.storage
      .from('child-media')
      .download(p.storage_path)
    if (dErr || !blob) continue
    done++
    const name = `${String(done).padStart(2, '0')}-${p.id.slice(0, 8)}.jpg`
    files[name] = new Uint8Array(await blob.arrayBuffer())
  }
  if (done === 0) throw new Error('no_photos')
  const zipped = zipSync(files, { level: 0 })
  return { blob: new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }), count: done }
}

/** عدد صور طفل النهارده (لفرض السقف المرن من الإعدادات) */
export async function countChildPhotosToday(
  childId: string,
  classDayId: string,
): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('photo_children')
    .select('photo_id, photo:child_photos!inner(class_day_id)')
    .eq('child_id', childId)
    .eq('photo.class_day_id', classDayId)
  if (error) throw error
  return (data ?? []).length
}

/**
 * رفع صور من داخل النظام: ضغط → تخزين بمسار «<nursery>/<photo_id>.jpg»
 * → صف صورة + روابط الأطفال الظاهرين. لا مسار آخر لصور الأطفال.
 */
export async function uploadPhotos(
  nurseryId: string,
  classDayId: string,
  actorId: string | null,
  files: File[],
  childIds: string[],
  caption: string | null,
  shouldStop?: () => boolean,
): Promise<number> {
  const db = requireSupabase()
  // X3 (3A-378): الرفض عند المصدر — التحقق من موافقة كل طفل موسوم
  // قبل رفع أي ملف (لا تخزين ولا رابط لطفل بلا موافقة). المشغّل
  // photo_children_consent_trg في 0017 هو الحارس الأخير.
  if (childIds.length > 0) {
    const { data: kids, error: kidsErr } = await db
      .from('children')
      .select('id, photo_consent')
      .in('id', childIds)
    if (kidsErr) throw kidsErr
    const blocked = (kids ?? []).find(
      (k) => !(k as { photo_consent: boolean }).photo_consent,
    )
    if (blocked) throw new Error('photo_consent_required')
  }
  let uploaded = 0
  for (const file of files) {
    if (shouldStop?.()) break
    const photoId = crypto.randomUUID()
    const path = `${nurseryId}/${photoId}.jpg`
    const blob = await compressImage(file)
    const { error: upErr } = await db.storage
      .from('child-media')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (upErr) throw upErr
    const { error } = await db.from('child_photos').insert({
      id: photoId,
      nursery_id: nurseryId,
      class_day_id: classDayId,
      storage_path: path,
      taken_by: actorId,
      caption,
    })
    if (error) throw error
    if (childIds.length > 0) {
      const { error: linkErr } = await db.from('photo_children').insert(
        childIds.map((child_id) => ({ photo_id: photoId, child_id })),
      )
      if (linkErr) throw linkErr
    }
    uploaded++
  }
  return uploaded
}

export async function deletePhoto(photo: ChildPhotoRow): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('child_photos').delete().eq('id', photo.id)
  if (error) throw error
  await db.storage.from('child-media').remove([photo.storage_path])
}

/** صور طفل (تبويب ملف الطفل) بروابط موقعة للطاقم */
export interface ChildReportEntry {
  date: string
  mood: string | null
  nap_slept: boolean | null
  activities: string[] | null
  note: string | null
}

/** تقارير منشورة لطفل واحد (لملف النمو 4.5) — الأحدث أولاً. */
export async function listChildReports(
  childId: string,
  limit = 12,
): Promise<ChildReportEntry[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('daily_reports')
    .select('mood, nap_slept, activities, note, class_day:class_days(date)')
    .eq('child_id', childId)
    .not('published_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      mood: string | null
      nap_slept: boolean | null
      activities: string[] | null
      note: string | null
      class_day: { date: string } | null
    }
    return {
      date: row.class_day?.date ?? '',
      mood: row.mood,
      nap_slept: row.nap_slept,
      activities: row.activities,
      note: row.note,
    }
  })
}

export async function listChildPhotos(
  childId: string,
  limit = 60,
): Promise<(ChildPhotoRow & { url: string | null })[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('photo_children')
    .select('photo:child_photos(*)')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const photos = (data ?? [])
    .map((r) => (r as unknown as { photo: ChildPhotoRow }).photo)
    .filter(Boolean)
  // سجل مشاهدات الطاقم (4.14): العرض داخل التطبيق مشاهدة
  // موثقة. التسجيل جهد أفضل — فشله لا يحجب الصور عن الطاقم
  // (استثناء موثق كتحليلات 3.3).
  if (photos.length > 0) {
    try {
      await db.rpc('log_staff_photo_views', {
        p_photo_ids: photos.map((p) => p.id),
      })
    } catch {
      // documented best-effort: viewing is the primary right
    }
  }
  const withUrls = await Promise.all(
    photos.map(async (p) => {
      const { data: signed } = await db.storage
        .from('child-media')
        .createSignedUrl(p.storage_path, 3600)
      return { ...p, url: signed?.signedUrl ?? null }
    }),
  )
  return withUrls
}
