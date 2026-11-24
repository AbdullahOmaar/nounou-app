import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import * as api from './api'
import { useT } from '../../i18n'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Field, TextArea, TextInput } from '../../components/ui/form'

/** حجز جولة من الموقع العام (3.6): نموذج قصير يصل الطاقم كطلب. */
export default function VisitPage() {
  const t = useT()
  const { slug } = useParams<{ slug: string }>()
  const [parent, setParent] = useState('')
  const [phone, setPhone] = useState('')
  const [child, setChild] = useState('')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (done) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CalendarCheck size={32} />
          <div className="type-body">{t('pub.visitDone')}</div>
          <div className="type-secondary text-muted">{t('pub.visitDoneHint')}</div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="type-body mb-3">{t('pub.visitTitle')}</h2>
      <Field label={t('pub.visitParent')}>
        <TextInput value={parent} onChange={(e) => setParent(e.target.value)} />
      </Field>
      <Field label={t('pub.visitPhone')}>
        <TextInput dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={t('pub.visitChild')}>
        <TextInput value={child} onChange={(e) => setChild(e.target.value)} />
      </Field>
      <Field label={t('pub.visitWhen')}>
        <TextInput
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </Field>
      <Field label={t('pub.visitNote')}>
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      {error && <p className="type-badge text-bad-text mb-2">{error}</p>}
      <Button
        full
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          const res = await api.bookTour(slug!, {
            parentName: parent,
            phone,
            childName: child,
            preferredAt: when ? new Date(when).toISOString() : null,
            note: note.trim() || null,
          })
          setBusy(false)
          if (res.ok) setDone(true)
          else setError(t('pub.visitError'))
        }}
      >
        {t('pub.visitSubmit')}
      </Button>
    </Card>
  )
}
