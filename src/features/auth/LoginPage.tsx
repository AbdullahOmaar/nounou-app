import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, FormError, TextInput } from '../../components/ui/form'
import { Mascot } from '../../components/mascot/Mascot'
import { useLocale, setLocale } from '../../i18n/locale'
import { useT } from '../../i18n'
import {
  requestPasswordReset,
  signIn,
  signInDemo,
  signUp,
} from './api'

/**
 * الدخول/التسجيل — سطح مصادقة واحد بوضعين. عند أول تسجيل بجلسة فورية
 * يُنشأ صف users؛ وإنشاء الحضانة خطوة الإعداد التالية (Onboarding).
 * زر الدخول التجريبي: حساب ديمو بحضانة وهمية واضحة (نمط المدرس المعتمد).
 */
export function LoginPage() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        navigate(from, { replace: true })
      } else {
        if (password.length < 6) {
          setError(t('auth.weakPassword'))
          return
        }
        const { needsEmailConfirm } = await signUp(email, password, displayName)
        if (needsEmailConfirm) {
          setNotice(t('auth.checkEmail'))
          setMode('signin')
        } else {
          navigate(from, { replace: true })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDemo() {
    setError(null)
    setBusy(true)
    try {
      await signInDemo()
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function handleForgot() {
    setError(null)
    setNotice(null)
    if (!email.trim()) {
      setError(t('auth.email'))
      return
    }
    setBusy(true)
    try {
      await requestPasswordReset(email)
      setNotice(t('auth.resetSent'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative overflow-hidden min-h-dvh bg-bg text-text flex items-start justify-center">
      <div className="relative w-full max-w-[640px] px-4 pt-12 pb-10">
        <div className="flex justify-end mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
          >
            {locale === 'ar' ? t('common.langEn') : t('common.langAr')}
          </Button>
        </div>
        <div className="text-center mb-6 rise-in">
          <div className="flex justify-center mb-3">
            <Mascot size={84} className="rounded-[22px] shadow-card select-none" />
          </div>
          <h1 className="type-title mb-1">{t('auth.welcome')}</h1>
          <p className="text-muted type-secondary">{t('auth.welcomeBody')}</p>
        </div>

        <Card className="rise-in">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {mode === 'signup' && (
              <Field label={t('auth.displayName')}>
                <TextInput
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label={t('auth.email')}>
              <TextInput
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label={t('auth.password')}>
              <TextInput
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>
            {error && <FormError message={error} />}
            {notice && (
              <p className="type-secondary text-good-text bg-good-soft rounded-xl px-3 py-2">
                {notice}
              </p>
            )}
            <Button type="submit" disabled={busy} full>
              {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
            </Button>
          </form>

          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              className="type-secondary text-primary underline-offset-2 hover:underline min-h-[44px] inline-flex items-center py-2"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setError(null)
                setNotice(null)
              }}
            >
              {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
            </button>
            {mode === 'signin' && (
              <button
                type="button"
                className="type-secondary text-muted underline-offset-2 hover:underline min-h-[44px] inline-flex items-center py-2"
                onClick={handleForgot}
                disabled={busy}
              >
                {t('auth.forgotPassword')}
              </button>
            )}
          </div>
        </Card>

        <Card className="mt-4 text-center rise-in">
          <p className="type-secondary text-muted mb-2">{t('auth.demoBody')}</p>
          <Button variant="soft" onClick={handleDemo} disabled={busy}>
            {t('auth.demoCta')}
          </Button>
        </Card>
      </div>
    </div>
  )
}
