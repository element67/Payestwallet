import { useState, type FormEvent } from 'react'
import { changePasswordSchema } from '../../../shared/schemas'
import { PasswordChecklist } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { BottomSheet } from '@/components/ui/Overlay'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'

export function ChangePasswordSheet(props: { open: boolean; onClose: () => void }) {
  return props.open ? <ChangePasswordInner {...props} /> : null
}

function ChangePasswordInner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(changePasswordSchema, { currentPassword: current, newPassword: next })
    const errs: FieldErrors = v.ok ? {} : { ...v.errors }
    if (confirm !== next) errs.confirm = 'Passwords do not match'
    if (!v.ok || errs.confirm) return setErrors(errs)
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      await api.changePassword({ currentPassword: current, newPassword: next })
      notifyToast.success('Password changed. Other devices were signed out.')
      onClose()
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Change password" locked={busy}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} disabled={busy} />
        <div>
          <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} disabled={busy} />
          <PasswordChecklist password={next} />
        </div>
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} disabled={busy} />
        <Button type="submit" full size="lg" loading={busy}>
          Update password
        </Button>
      </form>
    </BottomSheet>
  )
}
