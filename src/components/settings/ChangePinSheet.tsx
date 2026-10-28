import { useState } from 'react'
import { PinPad } from '@/components/PinPad'
import { notifyToast } from '@/components/ui/Feedback'
import { BottomSheet } from '@/components/ui/Overlay'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { describeError } from '@/lib/errors'
import { PinLockedError, WrongPinError, attemptsLeft, pinWeakness } from '@/lib/keystore'

type Phase = 'old' | 'new' | 'confirm'
const TITLES: Record<Phase, string> = { old: 'Enter current PIN', new: 'Choose a new PIN', confirm: 'Confirm new PIN' }

export function ChangePinSheet(props: { open: boolean; onClose: () => void }) {
  return props.open ? <ChangePinInner {...props} /> : null
}

function ChangePinInner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const { changePin, confirmPin } = useWallet()
  const [phase, setPhase] = useState<Phase>('old')
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const complete = async (value: string) => {
    if (busy) return
    setError(null)
    if (phase === 'old') {
      setBusy(true)
      try {
        await confirmPin(value)
        setOldPin(value)
        setPhase('new')
      } catch (err) {
        if (err instanceof WrongPinError && user) {
          const left = attemptsLeft(user.id)
          setError(`Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`)
        } else if (err instanceof PinLockedError) setError(describeError(err))
        else setError('Could not verify your PIN.')
      } finally {
        setPin('')
        setBusy(false)
      }
      return
    }
    if (phase === 'new') {
      const weak = pinWeakness(value)
      if (weak) {
        setError(weak)
        return setPin('')
      }
      if (value === oldPin) {
        setError('Choose a PIN different from your current one.')
        return setPin('')
      }
      setNewPin(value)
      setPin('')
      return setPhase('confirm')
    }
    if (value !== newPin) {
      setError('PINs do not match. Try again.')
      setPin('')
      return setPhase('new')
    }
    setBusy(true)
    try {
      await changePin(oldPin, value)
      notifyToast.success('PIN changed')
      onClose()
    } catch (err) {
      setError(describeError(err))
      setPin('')
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={TITLES[phase]} locked={busy}>
      <PinPad value={pin} onChange={setPin} onComplete={complete} disabled={busy} error={error} />
      {busy && <p className="mt-4 text-center text-sm font-medium text-brand-600">Working on it…</p>}
    </BottomSheet>
  )
}
