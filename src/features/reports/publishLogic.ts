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
