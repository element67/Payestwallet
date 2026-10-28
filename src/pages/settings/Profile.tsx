import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { displayNameSchema } from '../../../shared/schemas'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'
import { dateTime } from '@/lib/format'

export default function Profile() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.displayName ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(z.object({ displayName: displayNameSchema }), { displayName: name })
    if (!v.ok) return setErrors(v.errors)
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      const res = await api.updateMe({ displayName: v.data.displayName })
      setUser(res.user)
      notifyToast.success('Profile updated')
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Profile" />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card className="space-y-4">
          {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.displayName} disabled={busy} autoComplete="name" />
          <Input label="Email" value={user.email} readOnly disabled hint="Email cannot be changed on testnet." />
          <p className="text-xs text-ink-mute">Member since {dateTime(user.createdAt)}</p>
        </Card>
        <Button type="submit" full size="lg" loading={busy} disabled={name.trim() === user.displayName}>
          Save changes
        </Button>
      </form>
    </>
  )
}
