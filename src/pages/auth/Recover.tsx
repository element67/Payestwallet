import { MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { forgotSchema, resetSchema } from '../../../shared/schemas'
import { AuthLayout, PasswordChecklist } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'

type Mock = { to: string; subject: string; text: string; link?: string }

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ message: string; mock?: Mock } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(forgotSchema, { email })
    if (!v.ok) return setError(v.errors.email ?? 'Enter a valid email address')
    setError(null)
    setBusy(true)
    try {
      const res = await api.forgotPassword(v.data.email)
      setSent({ message: res.message, mock: res.mockEmail })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we will send you a reset link."
      footer={
        <Link to="/login" className="font-semibold text-brand-600">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 size-6 shrink-0 text-ok" />
            <p className="text-sm text-ink-soft">{sent.message}</p>
          </div>
          {sent.mock && (
            <Card className="border border-dashed border-warn/40 bg-warn-soft/40 shadow-none">
              <p className="text-xs font-bold uppercase tracking-wider text-warn">Mock email (testnet)</p>
              <p className="mt-2 text-sm font-semibold text-ink">{sent.mock.subject}</p>
              <p className="mt-1 text-sm text-ink-soft">To: {sent.mock.to}</p>
              <p className="mt-2 text-sm text-ink-soft">{sent.mock.text}</p>
              {sent.mock.link && (
                <Link to={sent.mock.link} className="mt-3 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
                  Open reset link
                </Link>
              )}
            </Card>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <InlineAlert tone="bad">{error}</InlineAlert>}
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} placeholder="you@example.com" />
          <Button type="submit" full size="lg" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(resetSchema, { token, password })
    const next: FieldErrors = v.ok ? {} : { ...v.errors }
    if (confirm !== password) next.confirm = 'Passwords do not match'
    if (!v.ok || next.confirm) return setErrors(next)
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      await api.resetPassword({ token, password })
      notifyToast.success('Password updated. Please sign in.')
      void nav('/login', { replace: true })
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Link not valid" footer={<Link to="/forgot-password" className="font-semibold text-brand-600">Request a new link</Link>}>
        <InlineAlert tone="bad">This reset link is missing its code. Request a new one.</InlineAlert>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You will be signed out on all devices.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
        <div>
          <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} disabled={busy} />
          <PasswordChecklist password={password} />
        </div>
        <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} disabled={busy} />
        <Button type="submit" full size="lg" loading={busy}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
