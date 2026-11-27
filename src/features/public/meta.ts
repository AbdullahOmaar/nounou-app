import { useEffect } from 'react'
import { useT } from '../../i18n'
import type { PublicPageData, PublicPageName } from './api'
import { bannerUrl } from './banners'

/**
 * حلقة النمو العامة (3A-891 — الاكتشاف): ميتا SEO وبطاقات مشاركة
 * وبيانات منظمة (JSON-LD) لصفحات الحضانة العامة. الدوال النقية
 * تبني القيم من بيانات RPC 0037 نفسها — بلا بيانات أطفال إطلاقاً،
 * والخطاف يطبّقها على <head> وقت التشغيل ويعيد الأصل عند الفك.
 */

export interface PublicMetaStrings {
  homeTitle: string
  fallbackDescription: string
  /** عنوان الصفحة الفرعية (فصول/عن) أو null للرئيسية. */
  pageTitle: string | null
}

export interface PublicMeta {
  title: string
  description: string
  canonical: string
  image: string
  jsonLd: Record<string, unknown>
}

const DESC_MAX = 160

export function truncateDesc(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > DESC_MAX ? `${clean.slice(0, DESC_MAX - 1)}…` : clean
}

function absolute(origin: string, pathOrUrl: string): string {
  return pathOrUrl.startsWith('http') ? pathOrUrl : `${origin}${pathOrUrl}`
}

export function buildNurseryJsonLd(
  d: PublicPageData,
  canonical: string,
  description: string,
  image: string,
  origin: string,
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ChildCare',
    name: d.name,
    url: canonical,
    description,
    image,
  }
  if (d.logo_url) ld.logo = absolute(origin, d.logo_url)
  if (d.phone) ld.telephone = d.phone
  if (d.address) {
    ld.address = { '@type': 'PostalAddress', streetAddress: d.address }
  }
  return ld
}

export function buildPublicMeta(
  d: PublicPageData,
  slug: string,
  page: PublicPageName,
  origin: string,
  strings: PublicMetaStrings,
): PublicMeta {
  const path = page === 'home' ? `/n/${slug}` : `/n/${slug}/${page}`
  const canonical = `${origin}${path}`
  const title = strings.pageTitle
    ? `${strings.pageTitle} — ${d.name ?? ''}`
    : strings.homeTitle
  const about = d.about?.trim()
  const description = truncateDesc(about ? d.about! : strings.fallbackDescription)
  const image = d.banner_key
    ? absolute(origin, bannerUrl(d.banner_key))
    : d.logo_url
      ? absolute(origin, d.logo_url)
      : `${origin}/og-card.png`
  return {
    title,
    description,
    canonical,
    image,
    jsonLd: buildNurseryJsonLd(d, canonical, description, image, origin),
  }
}

function upsertMeta(
  attr: 'name' | 'property',
  key: string,
  content: string,
): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  )
  const created = !el
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  const prev = el.getAttribute('content')
  el.setAttribute('content', content)
  const node = el
  return () => {
    if (created) node.remove()
    else if (prev !== null) node.setAttribute('content', prev)
    else node.removeAttribute('content')
  }
}

function upsertCanonical(href: string): () => void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  const created = !el
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  const prev = el.getAttribute('href')
  el.setAttribute('href', href)
  const node = el
  return () => {
    if (created) node.remove()
    else if (prev !== null) node.setAttribute('href', prev)
    else node.removeAttribute('href')
  }
}

function upsertJsonLd(jsonLd: Record<string, unknown>): () => void {
  let el = document.getElementById('nounou-jsonld') as HTMLScriptElement | null
  const created = !el
  if (!el) {
    el = document.createElement('script')
    el.id = 'nounou-jsonld'
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  const prev = el.textContent
  el.textContent = JSON.stringify(jsonLd)
  const node = el
  return () => {
    if (created) node.remove()
    else node.textContent = prev
  }
}

function applyMeta(meta: PublicMeta): () => void {
  const prevTitle = document.title
  document.title = meta.title
  const restores = [
    upsertMeta('name', 'description', meta.description),
    upsertMeta('property', 'og:title', meta.title),
    upsertMeta('property', 'og:description', meta.description),
    upsertMeta('property', 'og:type', 'website'),
    upsertMeta('property', 'og:url', meta.canonical),
    upsertMeta('property', 'og:image', meta.image),
    upsertMeta('name', 'twitter:card', 'summary_large_image'),
    upsertMeta('name', 'twitter:title', meta.title),
    upsertMeta('name', 'twitter:description', meta.description),
    upsertMeta('name', 'twitter:image', meta.image),
    upsertCanonical(meta.canonical),
    upsertJsonLd(meta.jsonLd),
  ]
  return () => {
    document.title = prevTitle
    for (const restore of restores.reverse()) restore()
  }
}

/** يطبّق ميتا الصفحة العامة الحالية ويعيد أصل التطبيق عند فك التركيب. */
export function usePublicMeta(
  d: PublicPageData | undefined,
  slug: string | undefined,
  page: PublicPageName,
): void {
  const t = useT()
  useEffect(() => {
    if (!d?.found || !slug) return
    const meta = buildPublicMeta(d, slug, page, window.location.origin, {
      homeTitle: t('pub.metaTitle', { name: d.name ?? '' }),
      fallbackDescription: t('pub.metaDesc', { name: d.name ?? '' }),
      pageTitle:
        page === 'classes'
          ? t('pub.classesTitle')
          : page === 'about'
            ? t('pub.navAbout')
            : null,
    })
    return applyMeta(meta)
  }, [d, slug, page, t])
}
