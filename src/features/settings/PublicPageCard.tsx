import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe } from 'lucide-react'
import * as api from './api'
import { BANNER_KEYS, STICKER_KEYS, bannerUrl, stickerUrl } from '../public/banners'
import { useT } from '../../i18n'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Field, TextArea, TextInput } from '../../components/ui/form'
import { useToast } from '../../components/ui/toast'

export function PublicPageCard({ nurseryId }: { nurseryId: string }) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const current = useQuery({
    queryKey: ['public-page-settings', nurseryId],
    queryFn: () => api.getPublicPageSettings(nurseryId),
  })
  const [enabled, setEnabled] = useState(false)
  const [slug, setSlug] = useState('')
  const [about, setAbout] = useState('')
  const [license, setLicense] = useState('')
  const [instapay, setInstapay] = useState('')
  const [vodafone, setVodafone] = useState('')
  const [bank, setBank] = useState('')
  const [banner, setBanner] = useState('')
  const [sticker, setSticker] = useState('')

  useEffect(() => {
    if (current.data) {
      setEnabled(current.data.public_enabled)
      setSlug(current.data.public_slug ?? '')
      setAbout(current.data.public_about ?? '')
      setLicense(current.data.public_license_no ?? '')
      setInstapay(current.data.public_instapay ?? '')
      setVodafone(current.data.public_vodafone ?? '')
      setBank(current.data.public_bank ?? '')
      setBanner(current.data.banner_key ?? '')
      setSticker(current.data.sticker_key ?? '')
    }
  }, [current.data])

  const save = useMutation({
    mutationFn: () =>
      api.updatePublicPageSettings(nurseryId, {
        public_enabled: enabled,
        public_slug: slug.trim() || null,
        public_about: about.trim() || null,
        public_license_no: license.trim() || null,
        public_instapay: instapay.trim() || null,
        public_vodafone: vodafone.trim() || null,
        public_bank: bank.trim() || null,
        banner_key: banner || null,
        sticker_key: sticker || null,
      }),
    onSuccess: () => {
      showToast(t('common.savedOk'))
      void qc.invalidateQueries({ queryKey: ['public-page-settings', nurseryId] })
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())
  const url = slugOk ? `${window.location.origin}/n/${slug.trim()}` : null
  const stats = useQuery({
    queryKey: ['public-page-stats', nurseryId],
    queryFn: () => api.getPublicPageStats(nurseryId),
    enabled: enabled,
  })

  return (
    <Card>
      <div className="type-body mb-1 inline-flex items-center gap-2">
        <Globe size={18} />
        {t('pub.settingsTitle')}
      </div>
      <p className="type-secondary text-muted mb-3">{t('pub.settingsHint')}</p>
      <label className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="type-secondary">{t('pub.enabledLabel')}</span>
      </label>
      <Field label={t('pub.slugLabel')}>
        <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} />
      </Field>
      {!slugOk && slug.trim() !== '' && (
        <p className="type-badge text-bad-text mb-2">{t('pub.slugInvalid')}</p>
      )}
      <Field label={t('pub.aboutLabel')}>
        <TextArea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} />
      </Field>
      <Field label={t('pub.instapayLabel')}>
        <TextInput value={instapay} onChange={(e) => setInstapay(e.target.value)} />
      </Field>
      <Field label={t('pub.vodafoneLabel')}>
        <TextInput value={vodafone} onChange={(e) => setVodafone(e.target.value)} />
      </Field>
      <Field label={t('pub.bankLabel')}>
        <TextInput value={bank} onChange={(e) => setBank(e.target.value)} />
      </Field>
      <Field label={t('pub.licenseLabel')}>
        <TextInput value={license} onChange={(e) => setLicense(e.target.value)} />
      </Field>
      <Button
        full
        disabled={save.isPending || (enabled && !slugOk)}
        onClick={() => save.mutate()}
      >
        {t('common.save')}
      </Button>
      <div>
        <div className="type-secondary text-muted mb-2">{t('settings.bannerLabel')}</div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setBanner('')}
            className={`rounded-xl bg-soft aspect-video flex items-center justify-center type-badge ${banner === '' ? 'ring-2 ring-text' : ''}`}
          >
            {t('settings.bannerNone')}
          </button>
          {BANNER_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setBanner(k)}
              className={`rounded-xl overflow-hidden aspect-video ${banner === k ? 'ring-2 ring-text' : ''}`}
            >
              <img src={bannerUrl(k)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
        <p className="type-badge text-muted mt-1">{t('settings.bannerHint')}</p>
      </div>
      <div>
        <div className="type-secondary text-muted mb-2">{t('settings.stickerLabel')}</div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSticker('')}
            className={`rounded-full bg-soft size-14 flex items-center justify-center type-badge ${sticker === '' ? 'ring-2 ring-text' : ''}`}
          >
            {t('settings.bannerNone')}
          </button>
          {STICKER_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSticker(k)}
              className={`rounded-full overflow-hidden size-14 ${sticker === k ? 'ring-2 ring-text' : ''}`}
            >
              <img src={stickerUrl(k)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      {enabled && stats.data && (
        <div className="type-secondary text-muted mt-3">
          {t('pub.statsLine', {
            views: stats.data.views,
            clicks: stats.data.clicks,
          })}
        </div>
      )}
      {enabled && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="type-secondary text-primary inline-flex items-center gap-1 mt-2"
        >
          <ExternalLink size={14} />
          {url}
        </a>
      )}
    </Card>
  )
}
