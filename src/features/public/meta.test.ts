import { describe, expect, it } from 'vitest'
import type { PublicPageData } from './api'
import { buildNurseryJsonLd, buildPublicMeta, truncateDesc } from './meta'

const ORIGIN = 'https://example.test'
const STRINGS = {
  homeTitle: 'حضانة النور — نونو',
  fallbackDescription: 'اكتشف حضانة النور على نونو',
  pageTitle: null as string | null,
}

const base: PublicPageData = { found: true, name: 'حضانة النور' }

describe('truncateDesc — قص الوصف لحد المشاركة', () => {
  it('النص القصير يمر كما هو مع طي المسافات', () => {
    expect(truncateDesc('  أهلا   بالعالم ')).toBe('أهلا بالعالم')
  })
  it('النص الطويل يُقص عند 160 حرفاً بنقطة حذف', () => {
    const out = truncateDesc('أ'.repeat(300))
    expect(out).toHaveLength(160)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('buildPublicMeta — قيم الميتا من بيانات الصفحة العامة', () => {
  it('الرئيسية: العنوان من القالب والرابط الأساسي بلا لاحقة', () => {
    const m = buildPublicMeta(base, 'alnoor', 'home', ORIGIN, STRINGS)
    expect(m.title).toBe('حضانة النور — نونو')
    expect(m.canonical).toBe('https://example.test/n/alnoor')
    expect(m.description).toBe('اكتشف حضانة النور على نونو')
    expect(m.image).toBe('https://example.test/og-card.png')
  })

  it('صفحة فرعية: العنوان يسبق اسم الحضانة والرابط يحمل اللاحقة', () => {
    const m = buildPublicMeta(base, 'alnoor', 'classes', ORIGIN, {
      ...STRINGS,
      pageTitle: 'الفصول والأسعار',
    })
    expect(m.title).toBe('الفصول والأسعار — حضانة النور')
    expect(m.canonical).toBe('https://example.test/n/alnoor/classes')
  })

  it('الوصف يفضّل نبذة الحضانة على الافتراضي', () => {
    const m = buildPublicMeta(
      { ...base, about: 'حضانة دافئة في المعادي' },
      'alnoor',
      'home',
      ORIGIN,
      STRINGS,
    )
    expect(m.description).toBe('حضانة دافئة في المعادي')
  })

  it('الصورة: البنر أولاً ثم الشعار ثم بطاقة المنصة', () => {
    const withBanner = buildPublicMeta(
      { ...base, banner_key: 'spring', logo_url: 'https://cdn.test/logo.png' },
      'alnoor',
      'home',
      ORIGIN,
      STRINGS,
    )
    expect(withBanner.image).toBe('https://example.test/banners/banner-spring.jpg')
    const withLogo = buildPublicMeta(
      { ...base, logo_url: 'https://cdn.test/logo.png' },
      'alnoor',
      'home',
      ORIGIN,
      STRINGS,
    )
    expect(withLogo.image).toBe('https://cdn.test/logo.png')
  })
})

describe('buildNurseryJsonLd — البيانات المنظمة', () => {
  it('الحقول الاختيارية تظهر فقط عند وجودها', () => {
    const bare = buildNurseryJsonLd(base, 'https://example.test/n/alnoor', 'وصف', 'img', ORIGIN)
    expect(bare['@type']).toBe('ChildCare')
    expect(bare).not.toHaveProperty('telephone')
    expect(bare).not.toHaveProperty('address')
    const full = buildNurseryJsonLd(
      { ...base, phone: '01001234567', address: 'شارع 9، المعادي', logo_url: '/logo.png' },
      'https://example.test/n/alnoor',
      'وصف',
      'img',
      ORIGIN,
    )
    expect(full.telephone).toBe('01001234567')
    expect(full.logo).toBe('https://example.test/logo.png')
    expect(full.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'شارع 9، المعادي',
    })
  })
})
