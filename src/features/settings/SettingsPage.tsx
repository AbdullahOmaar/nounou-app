import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, TextArea, TextInput } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useLocale, setLocale } from '../../i18n/locale'
import { useTheme } from '../../hooks/useTheme'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { WhatsAppSettingsCard } from './WhatsAppSettingsCard'
import { PublicPageCard } from './PublicPageCard'
import { PublicPostsCard } from './PublicPostsCard'
import { LicensingCard } from './LicensingCard'
import { IsoCard } from './IsoCard'
import { DataRequestsCard } from './DataRequestsCard'
import { IdentityCard } from './IdentityCard'
import { useAuth } from '../../lib/AuthProvider'
import { useNurserySettings, useSettingsMutations } from './hooks'

/**
 * الإعدادات: بيانات الحضانة (مالك) + سياسات التشغيل (خصم إخوات/صور/
 * كود استلام/نهاية اليوم) + قوالب الرسائل + المظهر واللغة + الحساب.
 */
export function SettingsPage() {
  const t = useT()
  const locale = useLocale()
  const { mode, setMode } = useTheme()
  const nursery = useCurrentNursery()
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const settings = useNurserySettings()
  const mutations = useSettingsMutations()
  const { signOut } = useAuth()
  const showToast = useToast()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [discount, setDiscount] = useState('')
  const [photoCap, setPhotoCap] = useState('')
  const [retention, setRetention] = useState('')
  const [dayEnd, setDayEnd] = useState('13:00')
  const [receiptTpl, setReceiptTpl] = useState('')
  const [reminderTpl, setReminderTpl] = useState('')

  useEffect(() => {
    if (nursery.status === 'ready') {
      setName(nursery.nursery.name)
      setPhone(nursery.nursery.phone ?? '')
      setAddress(nursery.nursery.address ?? '')
    }
  }, [nursery.status, nursery.status === 'ready' ? nursery.nursery.id : null])

  useEffect(() => {
    if (settings.data) {
      setDiscount(String(settings.data.sibling_discount_percent))
      setPhotoCap(
        settings.data.photo_daily_cap != null
          ? String(settings.data.photo_daily_cap)
          : '',
      )
      setRetention(String(settings.data.photo_retention_days))
      setDayEnd(settings.data.day_end_time.slice(0, 5))
      setReceiptTpl(settings.data.receipt_message_template)
      setReminderTpl(settings.data.reminder_template)
    }
  }, [settings.data])

  if (settings.isPending) return <LoadingState />
  if (settings.isError || !settings.data)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void settings.refetch()}
      />
    )
  const s = settings.data

  return (
    <div className="flex flex-col gap-4">
      {isOwner && (
        <h2 className="type-section">{t('settings.groupNursery')}</h2>
      )}
      {isOwner && (
        <Card className="flex flex-col gap-3">
          <h2 className="type-section">{t('settings.nurserySection')}</h2>
          <Field label={t('settings.nurseryName')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('settings.nurseryPhone')}>
            <TextInput
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t('settings.nurseryAddress')}>
            <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Button
            onClick={async () => {
              await mutations.updateProfile.mutateAsync({
                name: name.trim(),
                phone: phone.trim() || null,
                address: address.trim() || null,
              })
              showToast(t('common.savedOk'))
            }}
          >
            {t('common.save')}
          </Button>
        </Card>
      )}

      {isOwner && nursery.status === 'ready' && (
        <IdentityCard
          nurseryId={nursery.nurseryId}
          logoUrl={nursery.nursery.logo_url}
          brandColor={nursery.nursery.brand_color}
        />
      )}

      {isOwner && (
        <Card className="flex flex-col gap-3">
          <h2 className="type-section">{t('settings.policiesSection')}</h2>
          <Field label={t('settings.siblingDiscount')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
            <span className="type-badge text-muted">{t('settings.siblingDiscountHint')}</span>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settings.photoDailyCap')}>
              <TextInput
                type="number"
                inputMode="numeric"
                value={photoCap}
                onChange={(e) => setPhotoCap(e.target.value)}
                placeholder="∞"
              />
            </Field>
            <Field label={t('settings.photoRetention')}>
              <TextInput
                type="number"
                inputMode="numeric"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
            </Field>
          </div>
          <span className="type-badge text-muted -mt-2">{t('settings.photoDailyCapHint')}</span>
          <Field label={t('settings.dayEndTime')}>
            <TextInput
              type="time"
              value={dayEnd}
              onChange={(e) => setDayEnd(e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={s.pickup_code_enabled}
              onChange={(e) =>
                void mutations.updateSettings.mutateAsync({
                  pickup_code_enabled: e.target.checked,
                })
              }
              className="mt-1 w-5 h-5 accent-[var(--color-primary)]"
            />
            <span>
              <span className="type-body block">{t('settings.pickupCode')}</span>
              <span className="type-badge text-muted block">
                {t('settings.pickupCodeHint')}
              </span>
            </span>
          </label>
          <Button
            onClick={async () => {
              await mutations.updateSettings.mutateAsync({
                sibling_discount_percent: parseFloat(discount) || 0,
                photo_daily_cap: photoCap ? parseInt(photoCap, 10) : null,
                photo_retention_days: parseInt(retention, 10) || 180,
                day_end_time: dayEnd,
              })
              showToast(t('common.savedOk'))
            }}
          >
            {t('common.save')}
          </Button>
        </Card>
      )}

      {isOwner && (
        <Card className="flex flex-col gap-3">
          <h2 className="type-section">{t('settings.templatesSection')}</h2>
          <Field label={t('settings.receiptTemplate')}>
            <TextArea
              value={receiptTpl}
              onChange={(e) => setReceiptTpl(e.target.value)}
              rows={3}
            />
          </Field>
          <Field label={t('settings.reminderTemplate')}>
            <TextArea
              value={reminderTpl}
              onChange={(e) => setReminderTpl(e.target.value)}
              rows={3}
            />
          </Field>
          <span className="type-badge text-muted">{t('settings.templateVars')}</span>
          <Button
            onClick={async () => {
              await mutations.updateSettings.mutateAsync({
                receipt_message_template: receiptTpl,
                reminder_template: reminderTpl,
              })
              showToast(t('common.savedOk'))
            }}
          >
            {t('common.save')}
          </Button>
        </Card>
      )}

      {isOwner && nursery.status === 'ready' && (
        <>
          <WhatsAppSettingsCard nurseryId={nursery.nurseryId} />
          <PublicPageCard nurseryId={nursery.nurseryId} />
          <PublicPostsCard nurseryId={nursery.nurseryId} />
        </>
      )}

      {isOwner && nursery.status === 'ready' && (
        <h2 className="type-section">{t('settings.groupDataSupport')}</h2>
      )}
      {isOwner && nursery.status === 'ready' && (
        <>
          <DataRequestsCard nurseryId={nursery.nurseryId} />
          <LicensingCard
            nurseryId={nursery.nurseryId}
            nurseryName={nursery.nursery.name}
            logoUrl={nursery.nursery.logo_url}
            brandColor={nursery.nursery.brand_color}
            address={nursery.nursery.address}
            phone={nursery.nursery.phone}
          />
          <IsoCard
            nurseryId={nursery.nurseryId}
            nurseryName={nursery.nursery.name}
            logoUrl={nursery.nursery.logo_url}
            brandColor={nursery.nursery.brand_color}
          />
        </>
      )}

      <h2 className="type-section">{t('settings.groupAccountTeam')}</h2>
      <Card className="flex flex-col gap-3">
        <h2 className="type-section">{t('settings.appearanceSection')}</h2>
        <Field label={t('settings.theme')}>
          <ChipRow>
            <Chip active={mode === 'auto'} onClick={() => setMode('auto')}>
              {t('settings.themeAuto')}
            </Chip>
            <Chip active={mode === 'light'} onClick={() => setMode('light')}>
              {t('settings.themeLight')}
            </Chip>
            <Chip active={mode === 'dark'} onClick={() => setMode('dark')}>
              {t('settings.themeDark')}
            </Chip>
          </ChipRow>
        </Field>
        <Field label={t('settings.languageSection')}>
          <ChipRow>
            <Chip active={locale === 'ar'} onClick={() => setLocale('ar')}>
              {t('common.langAr')}
            </Chip>
            <Chip active={locale === 'en'} onClick={() => setLocale('en')}>
              {t('common.langEn')}
            </Chip>
          </ChipRow>
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="type-section">{t('settings.accountSection')}</h2>
        <Button variant="soft" onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </Card>
    </div>
  )
}
