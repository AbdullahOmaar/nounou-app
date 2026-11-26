import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, FormError, TextInput } from '../../components/ui/form'
import { useAuth } from '../../lib/AuthProvider'
import { useT } from '../../i18n'
import { createNursery } from './api'

/**
 * الإعداد الأول: مستخدم مسجل بلا أي عضوية حضانة — إما إنشاء حضانته
 * الأولى (RPC ذرّي)، أو انتظار دعوة (الادعاء يحدث تلقائياً عند حلّ
 * الهوية التالي/إعادة التحميل).
 */
export function Onboarding() {
  const t = useT()
  const { signOut } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await createNursery(name)
      await queryClient.invalidateQueries({ queryKey: ['current-nursery'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-text flex items-start justify-center">
      <div className="w-full max-w-[640px] px-4 pt-14 pb-10">
        <div className="text-center mb-6 rise-in">
          <div className="flex justify-center mb-3">
            {/* هوية نونو — الموجة 1: نونا النصفية (نفس قالب الدخول) */}
            <img
              src="/nouna/nouna-half.png"
              alt=""
              className="w-[200px] rounded-[24px] shadow-card select-none"
            />
          </div>
          <h1 className="type-title mb-1">{t('auth.onboardingTitle')}</h1>
          <p className="text-muted type-secondary">{t('auth.onboardingBody')}</p>
        </div>
        <Card className="rise-in">
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <Field label={t('auth.nurseryName')}>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.nurseryNamePlaceholder')}
                required
              />
            </Field>
            {error && <FormError message={error} />}
            <Button type="submit" variant="accent" disabled={busy} full>
              {busy ? t('auth.creatingNursery') : t('auth.createNursery')}
            </Button>
          </form>
          <p className="type-secondary text-muted mt-4">{t('auth.waitingInvite')}</p>
          <Button variant="ghost" onClick={() => void signOut()} className="mt-2">
            {t('auth.signOut')}
          </Button>
        </Card>
      </div>
    </div>
  )
}
