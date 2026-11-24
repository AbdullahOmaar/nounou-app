import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Palette } from 'lucide-react'
import * as api from './api'
import { useT } from '../../i18n'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useToast } from '../../components/ui/toast'

const SWATCHES = ['#0EA5A4', '#2563EB', '#DB2777', '#F59E0B', '#16A34A', '#7C3AED']

/**
 * هوية الحضانة (3.4): شعار + لون علامة — يظهران على الصفحة
 * العامة والبوابة وإيصال الطباعة. الشعار يُرفع لـbucket علني
 * مخصص (الشعار علني بطبيعته).
 */
export function IdentityCard({
  nurseryId,
  logoUrl,
  brandColor,
}: {
  nurseryId: string
  logoUrl: string | null
  brandColor: string | null
}) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [color, setColor] = useState<string | null>(brandColor)

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ['current-nursery'] })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const url = await api.uploadNurseryLogo(nurseryId, file)
      await api.updateNurseryProfile(nurseryId, { logo_url: url })
    },
    onSuccess: () => {
      showToast(t('common.savedOk'))
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const saveColor = useMutation({
    mutationFn: () =>
      api.updateNurseryProfile(nurseryId, { brand_color: color }),
    onSuccess: () => {
      showToast(t('common.savedOk'))
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="type-section inline-flex items-center gap-2">
        <Palette size={18} />
        {t('settings.identitySection')}
      </h2>
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="w-14 h-14 rounded-2xl object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-soft" />
        )}
        <div>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
          >
            <ImagePlus size={16} />
            {t('settings.logoUpload')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
              e.target.value = ''
            }}
          />
          <p className="type-badge text-muted mt-1">{t('settings.logoHint')}</p>
        </div>
      </div>
      <div>
        <div className="type-secondary text-muted mb-2">
          {t('settings.brandColor')}
        </div>
        <div className="flex gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={`w-9 h-9 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-text' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            type="button"
            onClick={() => setColor(null)}
            className={`type-badge rounded-full px-3 ${color === null ? 'bg-primary text-white' : 'bg-soft'}`}
          >
            {t('settings.brandDefault')}
          </button>
        </div>
      </div>
      <Button onClick={() => saveColor.mutate()} disabled={saveColor.isPending}>
        {t('common.save')}
      </Button>
    </Card>
  )
}
