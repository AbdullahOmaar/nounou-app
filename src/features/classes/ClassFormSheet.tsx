import { useEffect, useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Field, FormError, TextInput } from '../../components/ui/form'
import { useT } from '../../i18n'
import type { ClassInput } from './api'
import type { ClassRow } from '../../types/database'

interface Props {
  open: boolean
  onClose: () => void
  initial?: ClassRow | null
  onSubmit: (input: ClassInput) => Promise<void>
}

/** نموذج فصل: اسم + باقة شهرية + سعة + نطاق سن + قيلولة */
export function ClassFormSheet({ open, onClose, initial, onSubmit }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [fee, setFee] = useState('')
  const [capacity, setCapacity] = useState('')
  const [ageFrom, setAgeFrom] = useState('')
  const [ageTo, setAgeTo] = useState('')
  const [nap, setNap] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setFee(initial ? String(initial.monthly_fee) : '')
      setCapacity(initial?.capacity ? String(initial.capacity) : '')
      setAgeFrom(initial?.age_from != null ? String(initial.age_from) : '')
      setAgeTo(initial?.age_to != null ? String(initial.age_to) : '')
      setNap(initial?.nap_enabled ?? true)
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        name,
        monthly_fee: parseFloat(fee) || 0,
        capacity: capacity ? parseInt(capacity, 10) : null,
        age_from: ageFrom ? parseFloat(ageFrom) : null,
        age_to: ageTo ? parseFloat(ageTo) : null,
        nap_enabled: nap,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? t('classes.editClass') : t('classes.addClass')}
      footer={
        <Button onClick={handleSubmit} disabled={!name.trim() || busy} full>
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('classes.name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('classes.monthlyFee')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </Field>
          <Field label={t('classes.capacity')}>
            <TextInput
              type="number"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
          <Field label={t('classes.ageFrom')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={ageFrom}
              onChange={(e) => setAgeFrom(e.target.value)}
            />
          </Field>
          <Field label={t('classes.ageTo')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={ageTo}
              onChange={(e) => setAgeTo(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={nap}
            onChange={(e) => setNap(e.target.checked)}
            className="w-5 h-5 accent-[var(--color-primary)]"
          />
          <span className="type-body">{t('classes.napEnabled')}</span>
        </label>
        {error && <FormError message={error} />}
      </div>
    </Sheet>
  )
}
