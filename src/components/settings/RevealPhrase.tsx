import { EyeOff, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PinPad } from '@/components/PinPad'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/Feedback'
import { BottomSheet } from '@/components/ui/Overlay'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { describeError } from '@/lib/errors'
import { PinLockedError, WrongPinError, attemptsLeft } from '@/lib/keystore'

const AUTO_HIDE_SECONDS = 60

/** PIN gated viewer for the recovery phrase. The phrase lives in state only while it is visible. */
export function RevealPhrase(props: { open: boolean; onClose: () => void }) {
  return props.open ? <RevealInner {...props} /> : null
}

function RevealInner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const { revealMnemonic } = useWallet()
  const [phrase, setPhrase] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(AUTO_HIDE_SECONDS)

  useEffect(() => {
    if (!phrase) return
    const id = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(id)
  }, [phrase])

  useEffect(() => {
    if (phrase && left <= 0) onClose()
  }, [left, phrase, onClose])

  const submit = async (value: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setPhrase(await revealMnemonic(value))
      setLeft(AUTO_HIDE_SECONDS)
    } catch (err) {
      setPin('')
      if (err instanceof WrongPinError && user) {
        const n = attemptsLeft(user.id)
        setError(`Incorrect PIN. ${n} attempt${n === 1 ? '' : 's'} left.`)
      } else if (err instanceof PinLockedError) setError(describeError(err))
      else setError('Could not verify your PIN.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={phrase ? 'Recovery phrase' : 'Enter PIN to view'} locked={busy}>
      {phrase ? (
        <div className="space-y-4">
          <InlineAlert tone="warn">
            <span className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" /> Never share these words. Anyone who has them can take your funds. Support will never ask for them.
            </span>
          </InlineAlert>
          <div className="grid grid-cols-2 gap-2">
            {phrase.split(' ').map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2.5">
                <span className="w-5 text-xs font-semibold text-ink-mute tabular">{i + 1}</span>
                <span className="font-mono text-sm font-medium">{w}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-ink-mute">Hides automatically in {Math.max(0, left)}s</p>
          <Button full variant="secondary" icon={<EyeOff className="size-4" />} onClick={onClose}>
            Hide now
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-mute">Your recovery phrase is protected by your PIN.</p>
          <PinPad value={pin} onChange={setPin} onComplete={submit} disabled={busy} error={error} />
        </>
      )}
    </BottomSheet>
  )
}
