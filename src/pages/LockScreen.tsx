import { LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo, TestnetBadge, TestnetWarning } from '@/components/layout/AuthLayout'
import { PinPad } from '@/components/PinPad'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Overlay'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { describeError } from '@/lib/errors'
import { PinLockedError, WrongPinError, attemptsLeft, pinLockedUntil } from '@/lib/keystore'
import { InlineAlert } from '@/components/ui/Feedback'
import { useNavigate } from 'react-router-dom'

export default function LockScreen() {
  const { user, logout } = useAuth()
  const { unlock, forgetWallet } = useWallet()
  const nav = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(() => (user ? pinLockedUntil(user.id) : 0))
  const [now, setNow] = useState(() => Date.now())
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (!lockedUntil) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= lockedUntil) {
        setLockedUntil(0)
        setError(null)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [lockedUntil])

  const submit = async (value: string) => {
    if (busy || lockedUntil > Date.now()) return
    setBusy(true)
    setError(null)
    try {
      await unlock(value)
    } catch (err) {
      setPin('')
      if (err instanceof PinLockedError) setLockedUntil(err.until)
      else if (err instanceof WrongPinError && user) {
        const left = attemptsLeft(user.id)
        setError(`Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`)
      } else setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-5 pb-10 pt-14">
      <Logo size={56} />
      <div className="mt-3 flex items-center gap-2">
        <h1 className="font-display text-2xl font-bold">Payest Wallet</h1>
        <TestnetBadge />
      </div>
      <p className="mb-8 mt-2 flex items-center gap-1.5 text-ink-soft">
        <LockKeyhole className="size-4" /> Enter your PIN, {user?.displayName.split(' ')[0]}
      </p>
      {remaining > 0 ? (
        <InlineAlert tone="warn">Too many wrong PINs. Try again in {remaining >= 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining}s`}.</InlineAlert>
      ) : (
        <PinPad value={pin} onChange={setPin} onComplete={submit} disabled={busy} error={error} />
      )}
      <div className="mt-8 flex flex-col items-center gap-1">
        <button type="button" onClick={() => setConfirmReset(true)} className="min-h-[44px] px-3 text-sm font-semibold text-brand-600">
          Forgot PIN? Restore with recovery phrase
        </button>
        <button type="button" onClick={() => void logout()} className="min-h-[44px] px-3 text-sm font-semibold text-ink-mute">
          Sign out
        </button>
      </div>
      <TestnetWarning className="mt-auto w-full" />
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Restore wallet">
        <p className="text-sm text-ink-soft">
          This removes the encrypted wallet from this device so you can import it again with your recovery phrase and choose a new PIN. Without the phrase the wallet cannot be recovered.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" full onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            full
            onClick={() => {
              forgetWallet()
              void nav('/setup', { replace: true })
            }}
          >
            Remove from device
          </Button>
        </div>
      </Modal>
    </main>
  )
}
