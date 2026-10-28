import { Copy } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { totpDisableSchema, totpEnableSchema } from '../../../shared/schemas'
import { QrCode } from '@/components/Qr'
import { Button } from '@/components/ui/Button'
import { InlineAlert, Spinner, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { BottomSheet } from '@/components/ui/Overlay'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'

interface Props {
  open: boolean
  onClose: () => void
}

export function TwoFactorSheet(props: Props) {
  return props.open ? <TwoFactorInner {...props} /> : null
}

function TwoFactorInner({ open, onClose }: Props) {
  const { user, setUser } = useAuth()
  const enabled = user?.totpEnabled ?? false
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [loading, setLoading] = useState(!enabled)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (enabled) return
    let live = true
    api
      .totpSetup()
      .then((r) => live && setSetup({ secret: r.secret, uri: r.otpauthUri }))
      .catch((e) => live && setFormError(describeError(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [enabled])

  const refreshUser = async () => {
    const me = await api.me()
    setUser(me.user)
  }

  const enable = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(totpEnableSchema, { code })
    if (!v.ok) return setErrors(v.errors)
    setBusy(true)
    setFormError(null)
    try {
      await api.totpEnable(code)
      await refreshUser()
      notifyToast.success('Two-factor authentication is on')
      onClose()
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(totpDisableSchema, { password, code })
    if (!v.ok) return setErrors(v.errors)
    setBusy(true)
    setFormError(null)
    try {
      await api.totpDisable({ password, code })
      await refreshUser()
      notifyToast.success('Two-factor authentication is off')
      onClose()
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={enabled ? 'Turn off 2FA' : 'Set up 2FA'} locked={busy}>
      {enabled ? (
        <form onSubmit={disable} className="space-y-4" noValidate>
          <p className="text-sm text-ink-soft">Enter your password and a current code from your authenticator app.</p>
          {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} disabled={busy} />
          <Input label="Authenticator code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={errors.code} disabled={busy} />
          <Button type="submit" variant="danger" full size="lg" loading={busy}>
            Turn off 2FA
          </Button>
        </form>
      ) : loading ? (
        <div className="grid place-items-center py-10"><Spinner className="size-8" /></div>
      ) : setup ? (
        <form onSubmit={enable} className="space-y-4" noValidate>
          <p className="text-sm text-ink-soft">Scan this code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code.</p>
          <div className="flex justify-center"><QrCode value={setup.uri} size={180} /></div>
          <div className="flex items-center gap-2 rounded-2xl bg-canvas px-3 py-2">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{setup.secret}</span>
            <button
              type="button"
              aria-label="Copy setup key"
              className="grid size-10 place-items-center rounded-xl text-brand-600"
              onClick={() => navigator.clipboard.writeText(setup.secret).then(() => notifyToast.success('Setup key copied'), () => notifyToast.error('Could not copy'))}
            >
              <Copy className="size-4" />
            </button>
          </div>
          {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
          <Input label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={errors.code} disabled={busy} placeholder="123456" />
          <Button type="submit" full size="lg" loading={busy}>
            Turn on 2FA
          </Button>
        </form>
      ) : (
        formError && <InlineAlert tone="bad">{formError}</InlineAlert>
      )}
    </BottomSheet>
  )
}
