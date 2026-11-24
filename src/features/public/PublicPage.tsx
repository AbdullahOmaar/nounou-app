import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { MapPin, MessageCircle, Phone, ShieldCheck } from 'lucide-react'
import * as api from './api'
import type { PublicPageData } from './api'
import { useT } from '../../i18n'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { formatMoney, waLink } from '../../lib/format'

/**
 * موقع الحضانة العام (3.1 + 3.2): هيكل موقع متعدد الصفحات مولّد
 * تلقائياً من بيانات الحضانة — رئيسية/فصول/عن الحضانة، بروابط
 * قابلة للمشاركة لكل صفحة. نفس RPC 0037، بلا بيانات أطفال إطلاقاً.
 */
export default function PublicSiteLayout() {
  const t = useT()
  const { slug } = useParams<{ slug: string }>()
  const page = useQuery({
    queryKey: ['public-page', slug],
    queryFn: () => api.fetchPublicPage(slug!),
    enabled: !!slug,
  })

  if (page.isPending) return <LoadingState />
  if (page.isError) {
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void page.refetch()}
      />
    )
  }
  const d = page.data
  if (!d || !d.found) {
    return (
      <div className="min-h-dvh bg-bg text-text flex items-center justify-center p-6">
        <div className="type-secondary text-muted">{t('pub.notFound')}</div>
      </div>
    )
  }
  const wa = waLink(d.phone)
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `type-secondary rounded-full px-3 py-1 ${isActive ? 'bg-primary text-white' : 'text-muted'}`

  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto max-w-md p-4 flex flex-col gap-4">
        <header className="text-center flex flex-col items-center gap-2 pt-4">
          {d.logo_url && (
            <img
              src={d.logo_url}
              alt=""
              className="w-20 h-20 rounded-3xl object-cover"
            />
          )}
          <Link to={`/n/${slug}`} className="type-title">
            {d.name}
          </Link>
          {d.licensed && (
            <span className="type-badge bg-primary-soft text-primary rounded-full px-3 py-1 inline-flex items-center gap-1">
              <ShieldCheck size={14} />
              {t('pub.licensed')}
            </span>
          )}
          <nav className="flex gap-2 mt-1">
            <NavLink to={`/n/${slug}`} end className={navCls}>
              {t('pub.navHome')}
            </NavLink>
            <NavLink to={`/n/${slug}/classes`} className={navCls}>
              {t('pub.navClasses')}
            </NavLink>
            <NavLink to={`/n/${slug}/about`} className={navCls}>
              {t('pub.navAbout')}
            </NavLink>
          </nav>
        </header>

        <Outlet context={d} />

        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary text-white py-3 type-body"
          >
            <MessageCircle size={18} />
            {t('pub.contactWhatsapp')}
          </a>
        )}

        <footer className="text-center type-badge text-muted pb-6">
          {t('pub.poweredBy')}
        </footer>
      </div>
    </div>
  )
}

export function usePublicData(): PublicPageData {
  return useOutletContext<PublicPageData>()
}

export function ClassCard({ name, fee, capacity, available }: {
  name: string
  fee: number
  capacity: number | null
  available: number | null
}) {
  const t = useT()
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="type-body">{name}</span>
        <span className="type-body">
          {formatMoney(fee)}
          <span className="type-badge text-muted"> {t('pub.perMonth')}</span>
        </span>
      </div>
      <div className="type-badge text-muted mt-1">
        {available === null
          ? t('pub.askPlaces')
          : available > 0
            ? t('pub.placesLeft', { count: available })
            : t('pub.full')}
      </div>
      {capacity !== null && (
        <div className="type-badge text-muted">
          {t('pub.capacity', { count: capacity })}
        </div>
      )}
    </Card>
  )
}

export function PaymentsBlock({ d }: { d: PublicPageData }) {
  const t = useT()
  if (!d.payments || (!d.payments.instapay && !d.payments.vodafone && !d.payments.bank)) {
    return null
  }
  const rows: Array<[string, string | null | undefined]> = [
    [t('pub.instapay'), d.payments.instapay],
    [t('pub.vodafone'), d.payments.vodafone],
    [t('pub.bank'), d.payments.bank],
  ]
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-secondary">{t('pub.paymentsTitle')}</h2>
      <Card>
        {rows
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label} className="flex items-center justify-between py-1">
              <span className="type-secondary text-muted">{label}</span>
              <span className="type-body" dir="ltr">
                {v}
              </span>
            </div>
          ))}
        <p className="type-badge text-muted mt-2">{t('pub.payDirect')}</p>
      </Card>
    </section>
  )
}

export function PublicHome() {
  const t = useT()
  const d = usePublicData()
  const { slug } = useParams<{ slug: string }>()
  return (
    <>
      {d.about && (
        <Card>
          <p className="type-body whitespace-pre-wrap line-clamp-4">{d.about}</p>
          <Link to={`/n/${slug}/about`} className="type-secondary text-primary">
            {t('pub.readMore')}
          </Link>
        </Card>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="type-secondary">{t('pub.classesTitle')}</h2>
        {(d.classes ?? []).slice(0, 3).map((c) => (
          <ClassCard key={c.name} {...c} />
        ))}
        <Link to={`/n/${slug}/classes`} className="type-secondary text-primary">
          {t('pub.allClasses')}
        </Link>
      </section>
      <PaymentsBlock d={d} />
    </>
  )
}

export function PublicClasses() {
  const t = useT()
  const d = usePublicData()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-secondary">{t('pub.classesTitle')}</h2>
      {(d.classes ?? []).map((c) => (
        <ClassCard key={c.name} {...c} />
      ))}
    </section>
  )
}

export function PublicAbout() {
  const t = useT()
  const d = usePublicData()
  return (
    <>
      {d.about && (
        <Card>
          <h2 className="type-secondary mb-2">{t('pub.navAbout')}</h2>
          <p className="type-body whitespace-pre-wrap">{d.about}</p>
        </Card>
      )}
      <Card>
        <div className="flex flex-col gap-2">
          {d.address && (
            <div className="type-body inline-flex items-center gap-2">
              <MapPin size={16} />
              {d.address}
            </div>
          )}
          {d.phone && (
            <div className="type-body inline-flex items-center gap-2">
              <Phone size={16} />
              <span dir="ltr">{d.phone}</span>
            </div>
          )}
          {d.licensed && (
            <div className="type-body inline-flex items-center gap-2">
              <ShieldCheck size={16} />
              {t('pub.licensed')}
            </div>
          )}
        </div>
      </Card>
      <PaymentsBlock d={d} />
    </>
  )
}
