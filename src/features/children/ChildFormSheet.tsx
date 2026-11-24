import { useEffect, useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Chip, ChipRow, Field, FormError, Select, TextInput } from '../../components/ui/form'
import { useT } from '../../i18n'
import { useClasses } from '../classes/hooks'
import type { ChildInput } from './api'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (input: ChildInput) => Promise<void>
  initialClassId?: string | null
}

/** نموذج طفل جديد بالحد الأدنى الإلزامي (قرار ق٤): طفل + وصيّ + فصل */
export function ChildFormSheet({ open, onClose, onSubmit, initialClassId }: Props) {
  const t = useT()
  const classes = useClasses()
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [classId, setClassId] = useState<string>('')
  const [consent, setConsent] = useState(false)
  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setClassId(initialClassId ?? '')
      setError(null)
    }
  }, [open, initialClassId])

  async function handleSubmit() {
    setError(null)
    setBusy(true)
    try {
      await onSubmit({
        full_name: name,
        birth_date: birthDate || null,
        gender,
        photo_consent: consent,
        notes: null,
        class_id: classId || null,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        guardian_relation: null,
      })
      setName('')
      setBirthDate('')
      setGender(null)
      setConsent(false)
      setGuardianName('')
      setGuardianPhone('')
      onClose()
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'class_full'
          ? t('children.classFull')
          : err instanceof Error
            ? err.message
            : t('common.errorGeneric'),
      )
    } finally {
      setBusy(false)
    }
  }

  const valid =
    name.trim().length > 1 && guardianName.trim().length > 1 && guardianPhone.trim().length >= 10

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('children.addChild')}
      footer={
        <Button onClick={handleSubmit} disabled={!valid || busy} full>
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('children.fullName')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('children.birthDate')}>
            <TextInput
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </Field>
          <Field label={t('children.class')}>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{t('children.noClass')}</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('children.gender')}>
          <ChipRow>
            <Chip active={gender === 'male'} onClick={() => setGender('male')}>
              {t('children.male')}
            </Chip>
            <Chip active={gender === 'female'} onClick={() => setGender('female')}>
              {t('children.female')}
            </Chip>
          </ChipRow>
        </Field>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 w-5 h-5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="type-body block">{t('children.photoConsent')}</span>
            <span className="type-badge text-muted block">
              {t('children.photoConsentHint')}
            </span>
          </span>
        </label>
        <div className="border-t border-border pt-3 flex flex-col gap-3">
          <Field label={t('children.guardianName')}>
            <TextInput
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
          </Field>
          <Field label={t('children.guardianPhone')}>
            <TextInput
              type="tel"
              dir="ltr"
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
            />
          </Field>
        </div>
        {error && <FormError message={error} />}
      </div>
    </Sheet>
  )
}
