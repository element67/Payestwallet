import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerSchema } from '../../../shared/schemas'
import { AuthLayout, PasswordChecklist } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [displayName, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setFormError(null)
    const v = validate(registerSchema, { email, password, displayName })
    const next: FieldErrors = v.ok ? {} : { ...v.errors }
    if (confirm !== password) next.confirm = 'Passwords do not match'
    if (!v.ok || next.confirm) return setErrors(next)
    setErrors({})
    setBusy(true)
    try {
      await register(v.data.email, v.data.password, v.data.displayName)
      void nav('/setup', { replace: true })
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your account keeps your history and alerts. Your wallet keys stay on this device."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
        <Input label="Your name" autoComplete="name" value={displayName} onChange={(e) => setName(e.target.value)} error={errors.displayName} disabled={busy} placeholder="Ada Okafor" />
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={busy} placeholder="you@example.com" />
        <div>
          <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} disabled={busy} />
          <PasswordChecklist password={password} />
        </div>
        <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} disabled={busy} />
        <Button type="submit" full size="lg" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
