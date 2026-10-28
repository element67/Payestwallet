import { motion } from 'framer-motion'
import { ArrowLeft, Download, Eye, EyeOff, KeyRound, ShieldAlert, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo, TestnetBadge, TestnetWarning } from '@/components/layout/AuthLayout'
import { PinPad } from '@/components/PinPad'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { describeError } from '@/lib/errors'
import { isValidMnemonic, newMnemonic, normalizeMnemonic, pickQuizIndexes, pinWeakness } from '@/lib/keystore'

type Step = 'choose' | 'backup' | 'quiz' | 'import' | 'pin'

export default function WalletSetup() {
  const { user, logout } = useAuth()
  const { create } = useWallet()
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('choose')
  const [mode, setMode] = useState<'created' | 'imported'>('created')
  const [phrase, setPhrase] = useState('')

  const finish = async (pin: string) => {
    await create(phrase, pin, mode)
    setPhrase('')
    notifyToast.success('Wallet ready. Welcome to Payest.')
    void nav('/', { replace: true })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <p className="font-display font-bold leading-tight">Payest Wallet</p>
            <TestnetBadge />
          </div>
        </div>
        <button type="button" onClick={() => void logout()} className="min-h-[44px] px-2 text-sm font-semibold text-ink-mute">
          Sign out
        </button>
      </header>

      <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
        {step === 'choose' && (
          <div className="space-y-4">
            <h1 className="font-display text-3xl font-bold tracking-tight">Hi {user?.displayName.split(' ')[0]}, set up your wallet</h1>
            <p className="text-ink-soft">Your wallet is created on this device. Only you hold the keys. We never see or store them.</p>
            <Card className="space-y-3">
              <Button
                full
                size="lg"
                icon={<Sparkles className="size-5" />}
                onClick={() => {
                  setMode('created')
                  setPhrase(newMnemonic())
                  setStep('backup')
                }}
              >
                Create a new wallet
              </Button>
              <Button
                full
                size="lg"
                variant="secondary"
                icon={<Download className="size-5" />}
                onClick={() => {
                  setMode('imported')
                  setPhrase('')
                  setStep('import')
                }}
              >
                Import with recovery phrase
              </Button>
            </Card>
          </div>
        )}

        {step === 'backup' && <Backup phrase={phrase} onBack={() => { setPhrase(''); setStep('choose') }} onNext={() => setStep('quiz')} />}
        {step === 'quiz' && <Quiz phrase={phrase} onBack={() => setStep('backup')} onNext={() => setStep('pin')} />}
        {step === 'import' && (
          <ImportPhrase
            onBack={() => setStep('choose')}
            onNext={(p) => {
              setPhrase(p)
              setStep('pin')
            }}
          />
        )}
        {step === 'pin' && <PinSetup onBack={() => setStep(mode === 'created' ? 'quiz' : 'import')} onDone={finish} />}
      </motion.div>
      <TestnetWarning className="mt-8" />
    </main>
  )
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-ink-mute">
      <ArrowLeft className="size-4" /> Back
    </button>
  )
}

function Backup({ phrase, onBack, onNext }: { phrase: string; onBack: () => void; onNext: () => void }) {
  const words = phrase.split(' ')
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h1 className="font-display text-3xl font-bold tracking-tight">Write down your recovery phrase</h1>
      <InlineAlert tone="warn">
        <span className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          This is the only way to recover your wallet. Anyone with these words controls your funds. We cannot show them again without your PIN.
        </span>
      </InlineAlert>
      <Card>
        <div className={`grid grid-cols-2 gap-2 transition ${revealed ? '' : 'blur-md select-none'}`} aria-hidden={!revealed}>
          {words.map((w, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2.5">
              <span className="w-5 text-xs font-semibold text-ink-mute tabular">{i + 1}</span>
              <span className="font-mono text-sm font-medium">{w}</span>
            </div>
          ))}
        </div>
        <Button variant="secondary" full className="mt-4" icon={revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Hide words' : 'Tap to reveal'}
        </Button>
      </Card>
      <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink-soft">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-5 accent-brand-600" />I saved my recovery phrase somewhere safe, offline.
      </label>
      <Button full size="lg" disabled={!saved || !revealed} onClick={onNext}>
        I saved it
      </Button>
    </div>
  )
}

function Quiz({ phrase, onBack, onNext }: { phrase: string; onBack: () => void; onNext: () => void }) {
  const words = phrase.split(' ')
  const indexes = useMemo(() => pickQuizIndexes(words.length), [words.length])
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [error, setError] = useState<string | null>(null)

  const check = () => {
    const ok = indexes.every((idx, n) => answers[n].trim().toLowerCase() === words[idx])
    if (!ok) return setError('One or more words do not match. Check your backup and try again.')
    onNext()
  }
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h1 className="font-display text-3xl font-bold tracking-tight">Quick check</h1>
      <p className="text-ink-soft">Enter the words below to prove you saved your phrase.</p>
      <Card className="space-y-4">
        {indexes.map((idx, n) => (
          <Input
            key={idx}
            label={`Word #${idx + 1}`}
            value={answers[n]}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setError(null)
              setAnswers((a) => a.map((x, i) => (i === n ? e.target.value : x)))
            }}
          />
        ))}
        {error && <InlineAlert tone="bad">{error}</InlineAlert>}
      </Card>
      <Button full size="lg" disabled={answers.some((a) => !a.trim())} onClick={check}>
        Verify
      </Button>
    </div>
  )
}

function ImportPhrase({ onBack, onNext }: { onBack: () => void; onNext: (phrase: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const p = normalizeMnemonic(text)
    const count = p.split(' ').length
    if (![12, 15, 18, 21, 24].includes(count)) return setError('A recovery phrase has 12 or 24 words.')
    if (!isValidMnemonic(p)) return setError('This phrase is not valid. Check the spelling and word order.')
    onNext(p)
  }
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h1 className="font-display text-3xl font-bold tracking-tight">Import your wallet</h1>
      <p className="text-ink-soft">Type or paste your 12 or 24 word recovery phrase. It stays on this device.</p>
      <Card>
        <label htmlFor="phrase" className="mb-1.5 block text-sm font-semibold text-ink-soft">
          Recovery phrase
        </label>
        <textarea
          id="phrase"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          rows={4}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-2xl border border-brand-100 p-4 font-mono text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          placeholder="word1 word2 word3 …"
        />
        {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      </Card>
      <Button full size="lg" icon={<KeyRound className="size-5" />} disabled={!text.trim()} onClick={submit}>
        Continue
      </Button>
    </div>
  )
}

function PinSetup({ onBack, onDone }: { onBack: () => void; onDone: (pin: string) => Promise<void> }) {
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const complete = async (value: string) => {
    if (busy) return
    if (first === null) {
      const weak = pinWeakness(value)
      if (weak) {
        setError(weak)
        setPin('')
        return
      }
      setFirst(value)
      setPin('')
      setError(null)
      return
    }
    if (value !== first) {
      setError('PINs do not match. Start again.')
      setFirst(null)
      setPin('')
      return
    }
    setBusy(true)
    try {
      await onDone(value)
    } catch (err) {
      setError(describeError(err))
      setFirst(null)
      setPin('')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h1 className="font-display text-3xl font-bold tracking-tight">{first === null ? 'Create a 6-digit PIN' : 'Confirm your PIN'}</h1>
      <p className="text-ink-soft">The PIN locks your wallet on this device and confirms every send, swap and bridge. It cannot be recovered, so remember it.</p>
      <Card className="py-6">
        <PinPad value={pin} onChange={setPin} onComplete={complete} disabled={busy} error={error} />
        {busy && <p className="mt-4 text-center text-sm font-medium text-brand-600">Encrypting your wallet…</p>}
      </Card>
    </div>
  )
}
