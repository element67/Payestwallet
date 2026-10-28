import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginSchema, totpCodeSchema } from '../../../shared/schemas'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { describeError } from '@/lib/errors'
import { validate, type FieldErrors } from '@/lib/forms'

export default function Login() {
  const { login, login2fa, notice, clearNotice } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setFormError(null)
    clearNotice()
    if (challenge) {
      const v = validate(totpCodeSchema, code)
      if (!v.ok) return setErrors({ code: Object.values(v.errors)[0] ?? 'Enter the 6-digit code' })
      setBusy(true)
      try {
        await login2fa(challenge, code)
        void nav('/', { replace: true })
      } catch (err) {
        setFormError(describeError(err))
        setCode('')
      } finally {
        setBusy(false)
      }
      return
    }
    const v = validate(loginSchema, { email, password })
    if (!v.ok) return setErrors(v.errors)
    setErrors({})
    setBusy(true)
    try {
      const res = await login(v.data.email, v.data.password)
      if (res.kind === '2fa') setChallenge(res.challenge)
      else void nav('/', { replace: true })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={challenge ? 'Two-step check' : 'Welcome back'}
      subtitle={challenge ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your Payest Wallet.'}
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-semibold text-brand-600">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {notice && <InlineAlert tone="brand">{notice}</InlineAlert>}
        {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
        {challenge ? (
          <Input
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            error={errors.code}
            autoFocus
            disabled={busy}
            placeholder="123456"
          />
        ) : (
          <>
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={busy} placeholder="you@example.com" />
            <Input
              label="Password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              disabled={busy}
              trailing={
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="grid size-9 place-items-center text-ink-mute">
                  {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              }
            />
            <div className="text-right">
              <Link to="/forgot-password" className="text-sm font-semibold text-brand-600">
                Forgot password?
              </Link>
            </div>
          </>
        )}
        <Button type="submit" full size="lg" loading={busy}>
          {challenge ? 'Verify and sign in' : 'Sign in'}
        </Button>
        {challenge && (
          <Button variant="ghost" full onClick={() => { setChallenge(null); setCode(''); setFormError(null) }} disabled={busy}>
            Back
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
