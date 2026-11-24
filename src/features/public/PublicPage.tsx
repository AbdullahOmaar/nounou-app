import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { MapPin, MessageCircle, ShieldCheck } from 'lucide-react'
import * as api from './api'
import { useT } from '../../i18n'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { formatMoney, waLink } from '../../lib/format'

export default function PublicPage() {
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
          <h1 className="type-title">{d.name}</h1>
          {d.licensed && (
            <span className="type-badge bg-primary-soft text-primary rounded-full px-3 py-1 inline-flex items-center gap-1">
              <ShieldCheck size={14} />
              {t('pub.licensed')}
            </span>
          )}
          {d.address && (
            <div className="type-secondary text-muted inline-flex items-center gap-1">
              <MapPin size={14} />
              {d.address}
            </div>
          )}
        </header>

        {d.about && (
          <Card>
            <p className="type-body whitespace-pre-wrap">{d.about}</p>
          </Card>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="type-secondary">{t('pub.classesTitle')}</h2>
          {(d.classes ?? []).map((c) => (
            <Card key={c.name}>
              <div className="flex items-center justify-between">
                <span className="type-body">{c.name}</span>
                <span className="type-body">
                  {formatMoney(c.fee)}
                  <span className="type-badge text-muted"> {t('pub.perMonth')}</span>
                </span>
              </div>
              <div className="type-badge text-muted mt-1">
                {c.available === null
                  ? t('pub.askPlaces')
                  : c.available > 0
                    ? t('pub.placesLeft', { count: c.available })
                    : t('pub.full')}
              </div>
            </Card>
          ))}
        </section>

        {d.payments &&
          (d.payments.instapay || d.payments.vodafone || d.payments.bank) && (
            <section className="flex flex-col gap-2">
              <h2 className="type-secondary">{t('pub.paymentsTitle')}</h2>
              <Card>
                {d.payments.instapay && (
                  <div className="flex items-center justify-between py-1">
                    <span className="type-secondary text-muted">
                      {t('pub.instapay')}
                    </span>
                    <span className="type-body" dir="ltr">
                      {d.payments.instapay}
                    </span>
                  </div>
                )}
                {d.payments.vodafone && (
                  <div className="flex items-center justify-between py-1">
                    <span className="type-secondary text-muted">
                      {t('pub.vodafone')}
                    </span>
                    <span className="type-body" dir="ltr">
                      {d.payments.vodafone}
                    </span>
                  </div>
                )}
                {d.payments.bank && (
                  <div className="flex items-center justify-between py-1">
                    <span className="type-secondary text-muted">
                      {t('pub.bank')}
                    </span>
                    <span className="type-body" dir="ltr">
                      {d.payments.bank}
                    </span>
                  </div>
                )}
                <p className="type-badge text-muted mt-2">{t('pub.payDirect')}</p>
              </Card>
            </section>
          )}

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
