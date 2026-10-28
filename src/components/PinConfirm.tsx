import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { describeError } from '@/lib/errors'
import { PinLockedError, WrongPinError, attemptsLeft } from '@/lib/keystore'
import { PinPad } from './PinPad'
import { BottomSheet } from './ui/Overlay'

interface Props {
  open: boolean
  title?: string
  description?: string
  onClose: () => void
  /** Called after the PIN is verified. Return a promise to keep the sheet locked while the action runs. */
  onConfirmed: () => Promise<void> | void
}

/** Required before every send, swap and bridge. Re-verifies the PIN against the keystore. */
/** Mounts only while open, so every opening starts with a clean PIN field. */
export function PinConfirm(props: Props) {
  return props.open ? <PinConfirmInner {...props} /> : null
}

function PinConfirmInner({ open, title = 'Confirm with PIN', description, onClose, onConfirmed }: Props) {
  const { user } = useAuth()
  const { confirmPin } = useWallet()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (value: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await confirmPin(value)
    } catch (err) {
      setPin('')
      setBusy(false)
      if (err instanceof WrongPinError) {
        const left = user ? attemptsLeft(user.id) : null
        setError(left !== null ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect PIN.')
      } else if (err instanceof PinLockedError) setError(describeError(err))
      else setError('Could not verify your PIN. Please try again.')
      return
    }
    try {
      await onConfirmed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title} locked={busy}>
      {description && <p className="mb-4 text-sm text-ink-mute">{description}</p>}
      <PinPad value={pin} onChange={setPin} onComplete={submit} disabled={busy} error={error} />
      {busy && <p className="mt-4 text-center text-sm font-medium text-brand-600">Working on it…</p>}
    </BottomSheet>
  )
}
