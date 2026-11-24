/**
 * مكتبة البنرات المولّدة (3.12): أعمال زخرفية مولّدة بالذكاء
 * الاصطناعي — لا أطفال ولا أشخاص أبداً (قاعدة حديدية). تُعرض
 * دائماً مع شارة الإفصاح (3.14).
 */
export const BANNER_KEYS = [
  'spring',
  'ramadan',
  'school',
  'graduation',
  'openday',
  'aqeeqa',
] as const

export type BannerKey = (typeof BANNER_KEYS)[number]

export function bannerUrl(key: string): string {
  return `/banners/banner-${key}.jpg`
}

export function eventBannerKey(
  kind: string,
  nurseryBanner: string | null | undefined,
): string {
  switch (kind) {
    case 'graduation':
      return 'graduation'
    case 'open_day':
      return 'openday'
    case 'aqeeqa':
      return 'aqeeqa'
    default:
      return nurseryBanner ?? 'spring'
  }
}
