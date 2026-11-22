/** سجل النشاط */
export const activity = {
  title: 'سجل النشاط',
  empty: 'لا نشاط مسجل لسه',
  kind: {
    child_created: 'أضاف طفلاً',
    child_updated: 'عدّل بيانات طفل',
    invoice_issued: 'أصدر فواتير',
    payment_recorded: 'سجّل دفعة',
    payment_reversed: 'عكس دفعة',
    proof_approved: 'اعتمد إثبات دفع',
    proof_rejected: 'رفض إثبات دفع',
    report_published: 'نشر تقارير',
    announcement_published: 'نشر إعلاناً',
    member_invited: 'دعا عضواً للطاقم',
    link_issued: 'أصدر رابط بوابة',
    link_revoked: 'ألغى رابط بوابة',
  },
  byActor: 'بواسطة {name}',
  filterAll: 'كل النشاط',
} as const
