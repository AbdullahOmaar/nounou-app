/**
 * منطق النشر الجماعي النقي (3A-374/W2): الأطفال الحاضرون اليوم بلا
 * أي تقرير — هؤلاء لا يظهرون في بوابة ولي الأمر إطلاقاً بعد النشر،
 * فتُنبَّه المشرفة بأسمائهم قبل تأكيد النشر بدل الغياب الصامت.
 */
export interface PresentChildRef {
  id: string
  name: string
}

export function childrenWithoutReports(
  present: PresentChildRef[],
  reportChildIds: ReadonlySet<string>,
): PresentChildRef[] {
  return present.filter((c) => !reportChildIds.has(c.id))
}

/**
 * بوابة حضور التقرير اليومي (3A-378/X2): التقرير يُكتب فقط لمن حضر
 * فعلاً (present/early_leave). الغائب أو في إجازة لا تقرير له إطلاقاً،
 * ومن لم يُسجَّل حضوره بعد يبقى خارج القائمة حتى يُسجَّل (اليوم لسه
 * بيتسجَّل — لا حظر مبكر).
 */
export type ReportAccess = 'editable' | 'absent' | 'unmarked'

export function reportAccessFor(status: string | null | undefined): ReportAccess {
  if (status === 'present' || status === 'early_leave') return 'editable'
  if (status === 'absent' || status === 'leave') return 'absent'
  return 'unmarked'
}
