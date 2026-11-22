/** التنبيهات خلف الجرس (قاعدة المالك: لا كروت تنبيه في الرئيسية) */
export const notifications = {
  title: 'الإشعارات',
  empty: 'لا تنبيهات — كله تمام ✅',
  kind: {
    notPickedUp: 'حاضرون لم يُستلموا',
    proofsPending: 'إثباتات بانتظار المراجعة',
    overdue: 'متأخرات مستحقة',
    reportsMissing: 'تقارير لم تُنشر',
    absentStreak: 'غياب متكرر',
    photoCap: 'صور وصلت للحد اليومي',
  },
  notPickedUpBody: '{count} طفل حاضر ولسه لم يُستلم بعد نهاية اليوم',
  proofsPendingBody: '{count} إثبات دفع بانتظار مراجعتك',
  overdueBody: 'إجمالي المتأخرات {amount}',
  reportsMissingBody: '{count} تقرير لم يُنشر لأيام مفتوحة',
  absentStreakBody: '{name} غاب {count} أيام في آخر أسبوعين',
  photoCapBody: 'صور النهارده وصلت الحد المضبوط في الإعدادات',
} as const
