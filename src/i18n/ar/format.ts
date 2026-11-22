/** تنسيقات: عملة وتواريخ وأعداد — القيم تُبنى في lib/format */
export const format = {
  egp: '{amount} ج.م',
  andWord: 'و',
  listSep: '، ',
  amSuffix: 'ص',
  pmSuffix: 'م',
  childCount: {
    zero: 'لا أطفال',
    one: 'طفل واحد',
    two: 'طفلان',
    few: '{count} أطفال',
    many: '{count} طفلاً',
    other: '{count} طفل',
  },
  memberCount: {
    zero: 'لا أعضاء',
    one: 'عضو واحد',
    two: 'عضوان',
    few: '{count} أعضاء',
    many: '{count} عضواً',
    other: '{count} عضو',
  },
  yearsOld: {
    one: 'سنة',
    two: 'سنتان',
    few: '{count} سنوات',
    many: '{count} سنة',
    other: '{count} سنة',
  },
  monthsOld: {
    one: 'شهر',
    two: 'شهران',
    few: '{count} شهور',
    many: '{count} شهراً',
    other: '{count} شهر',
  },
} as const
