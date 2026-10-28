import { useQuery } from '@tanstack/react-query'
import { ArrowDownUp, CheckCircle2, Circle, ExternalLink, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChainIcon } from '@/components/Icons'
import { PageHeader } from '@/components/layout/AppShell'
import { PinConfirm } from '@/components/PinConfirm'
import { Button } from '@/components/ui/Button'
import { Card, Row } from '@/components/ui/Card'
import { InlineAlert, Skeleton, Spinner, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { BRIDGE, CHAINS, DEFAULT_CHAIN_ID, getChainConfig, txUrl } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { api } from '@/lib/api'
import { readBalances } from '@/lib/chain'
import { cn } from '@/lib/cn'
import { describeError } from '@/lib/errors'
import { formatToken, isValidAmountInput, toDecimalString } from '@/lib/format'
import { parseUnitsExact } from '@/onchain-money'
import { useSessionHold } from '@/hooks/useSession'
import { estimateBridge, executeBridge, resumeBridge, type BridgeOutcome, type BridgeStepUpdate } from '@/services/bridge'

type Stage = 'form' | 'review' | 'progress'

const STEPS = [
  { key: 'approve', label: 'Approve USDC', where: 'source' },
  { key: 'burn', label: 'Send USDC from source', where: 'source' },
  { key: 'attest', label: 'Circle confirms the transfer', where: 'none' },
  { key: 'mint', label: 'Receive USDC on destination', where: 'dest' },
] as const

const stepKeyOf = (name: string): (typeof STEPS)[number]['key'] | null => {
  const n = name.toLowerCase()
  if (n.includes('approve')) return 'approve'
  if (n.includes('burn')) return 'burn'
  if (n.includes('attest')) return 'attest'
  if (n.includes('mint') || n.includes('forward')) return 'mint'
  return null
}

function safeParse(v: string): bigint | null {
  if (!v || v === '.') return null
  try {
    return parseUnitsExact(v, 6)
  } catch {
    return null
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export default function Bridge() {
  const nav = useNavigate()
  const { chain: active } = useSettings()
  const { address, getAdapter } = useWallet()
  const [stage, setStage] = useState<Stage>('form')
  const [fromId, setFromId] = useState(active.id)
  const [toId, setToId] = useState(() => (active.id === DEFAULT_CHAIN_ID ? 84532 : DEFAULT_CHAIN_ID))
  const [amount, setAmount] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<Record<string, BridgeStepUpdate>>({})
  const [outcome, setOutcome] = useState<BridgeOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const recordId = useRef<string | null>(null)
  const running = useRef(false)
  useSessionHold(busy)

  const from = getChainConfig(fromId)
  const to = getChainConfig(toId)
  const raw = safeParse(amount)
  const debounced = useDebounced(raw && raw > 0n ? amount : '', 700)

  const bal = useQuery({
    queryKey: ['balances', fromId, address, 'bridge'],
    enabled: Boolean(address),
    queryFn: () => readBalances(fromId, address!),
    refetchInterval: 20_000,
    retry: 1,
  })
  const usdc = bal.data?.tokens.USDC

  const est = useQuery({
    queryKey: ['bridge-estimate', fromId, toId, debounced, address],
    enabled: debounced !== '' && fromId !== toId && Boolean(address),
    retry: 0,
    staleTime: 15_000,
    queryFn: async () => estimateBridge(await getAdapter(), fromId, toId, debounced),
  })
  const estFresh = est.data && est.data.amount === amount

  const problem = useMemo((): string | null => {
    if (fromId === toId) return 'Choose two different networks.'
    if (raw === null || raw === 0n) return 'Enter an amount to bridge.'
    if (usdc === undefined) return 'Balance is still loading.'
    if (raw > usdc) return 'Insufficient USDC on the source network.'
    if (!from.gasIsUsdc && bal.data && bal.data.native === 0n) return `You need some ${from.nativeSymbol} on ${from.shortName} to pay the network fee.`
    if (from.gasIsUsdc && raw + 50_000n > usdc) return 'Leave a little USDC for the network fee.'
    if (!estFresh) return est.error ? 'Could not get a quote for this transfer.' : 'Getting a live quote…'
    if (Number(est.data.youReceive) <= 0) return 'The amount is smaller than the transfer fee.'
    return null
  }, [fromId, toId, raw, usdc, from, bal.data, estFresh, est.error, est.data])

  const flip = () => {
    setFromId(toId)
    setToId(fromId)
    setAmount('')
  }

  const record = async (b: BridgeOutcome | { sourceTxHash: string }) => {
    if (recordId.current || !address || raw === null || !b.sourceTxHash) return
    try {
      const rec = await api.recordTransaction({
        walletAddress: address,
        chainId: fromId,
        destChainId: toId,
        type: 'bridge',
        status: 'pending',
        tokenSymbol: 'USDC',
        amount: toDecimalString(raw, 6),
        fromAddress: address,
        toAddress: address,
        txHash: b.sourceTxHash,
      })
      recordId.current = rec.id
    } catch {
      /* history sync is retried when the transfer finishes */
    }
  }

  const finish = async (out: BridgeOutcome) => {
    setOutcome(out)
    await record(out)
    if (recordId.current) {
      const patch = out.state === 'success' ? { status: 'confirmed', destTxHash: out.destTxHash ?? undefined } : out.state === 'error' && !out.sourceTxHash ? { status: 'failed', error: out.error?.slice(0, 280) } : { error: out.error?.slice(0, 280) }
      await api.updateTransaction(recordId.current, patch).catch(() => undefined)
    }
  }

  const onStep = (s: BridgeStepUpdate) => {
    const key = stepKeyOf(s.name)
    if (!key) return
    setSteps((prev) => ({ ...prev, [key]: s }))
    if (key === 'burn' && s.txHash) void record({ sourceTxHash: s.txHash })
  }

  const run = async () => {
    if (running.current || raw === null) return
    running.current = true
    setError(null)
    setSteps({})
    setOutcome(null)
    recordId.current = null
    setBusy(true)
    setStage('progress')
    setPinOpen(false)
    try {
      const out = await executeBridge(await getAdapter(), fromId, toId, amount, onStep)
      await finish(out)
    } catch (err) {
      setOutcome({ state: 'error', steps: [], sourceTxHash: null, destTxHash: null, error: describeError(err) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const resume = async () => {
    if (running.current || !outcome?.raw) return
    running.current = true
    setBusy(true)
    try {
      const out = await resumeBridge(await getAdapter(), outcome.raw)
      await finish(out)
    } catch (err) {
      notifyToast.error(describeError(err))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  if (stage === 'progress') {
    const failed = outcome?.state === 'error'
    const done = outcome?.state === 'success'
    const doneKeys = new Set(Object.entries(steps).filter(([, s]) => s.state === 'success').map(([k]) => k))
    if (done) STEPS.forEach((s) => doneKeys.add(s.key))
    const firstOpen = STEPS.find((s) => !doneKeys.has(s.key))?.key
    return (
      <>
        <PageHeader title="Bridge" onBack={busy ? () => undefined : () => nav('/')} />
        <div className="space-y-4">
          <Card className="py-6 text-center">
            <div className="flex items-center justify-center gap-3">
              <ChainIcon chainId={fromId} size={32} />
              <span className="text-ink-mute">to</span>
              <ChainIcon chainId={toId} size={32} />
            </div>
            <p className="mt-3 font-display text-3xl font-bold tabular">{amount} USDC</p>
            <p className="text-sm text-ink-soft">{from.name} to {to.name}</p>
            <h2 className="mt-3 font-display text-xl font-bold">{done ? 'Bridge complete' : failed ? 'Bridge needs attention' : 'Bridging in progress'}</h2>
          </Card>
          <Card>
            <ol className="space-y-4">
              {STEPS.map((s) => {
                const upd = steps[s.key]
                const isDone = doneKeys.has(s.key)
                const active = !isDone && firstOpen === s.key && !failed
                const chainId = s.where === 'dest' ? toId : fromId
                return (
                  <li key={s.key} className="flex items-start gap-3">
                    <span className="mt-0.5">
                      {isDone ? <CheckCircle2 className="size-6 text-ok" /> : active ? <Spinner className="size-6" /> : failed && firstOpen === s.key ? <XCircle className="size-6 text-bad" /> : <Circle className="size-6 text-brand-200" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('font-semibold', isDone || active ? 'text-ink' : 'text-ink-mute')}>{s.label}</p>
                      {s.where !== 'none' && <p className="text-xs text-ink-mute">{getChainConfig(chainId).name}</p>}
                      {upd?.txHash && (
                        <a href={txUrl(chainId, upd.txHash)} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                          View transaction <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>
          {busy && <InlineAlert tone="brand">Keep this screen open until the transfer completes. {BRIDGE.estimatedTime}.</InlineAlert>}
          {failed && (
            <InlineAlert tone="bad">
              {outcome?.error ?? 'The transfer stopped.'}{' '}
              {outcome?.sourceTxHash ? 'Your USDC was already sent. Resume to finish the transfer on the destination.' : 'No USDC left your wallet.'}
            </InlineAlert>
          )}
          {failed && outcome?.sourceTxHash && outcome.raw !== undefined && (
            <Button full size="lg" onClick={resume} loading={busy}>
              Resume transfer
            </Button>
          )}
          {failed && !outcome?.sourceTxHash && (
            <Button full size="lg" variant="secondary" onClick={() => setStage('form')}>
              Back
            </Button>
          )}
          {done && (
            <Button full size="lg" onClick={() => nav('/')}>
              Done
            </Button>
          )}
        </div>
      </>
    )
  }

  if (stage === 'review' && estFresh && raw !== null) {
    const e = est.data
    return (
      <>
        <PageHeader title="Review bridge" onBack={() => setStage('form')} />
        <div className="space-y-4">
          <Card className="py-6 text-center">
            <div className="flex items-center justify-center gap-3">
              <ChainIcon chainId={fromId} size={32} />
              <span className="text-ink-mute">to</span>
              <ChainIcon chainId={toId} size={32} />
            </div>
            <p className="mt-3 font-display text-3xl font-bold tabular">{amount} USDC</p>
          </Card>
          <Card className="divide-y divide-canvas py-1">
            <Row label="From" value={from.name} />
            <Row label="To" value={to.name} />
            {e.usdcFees.map((f, i) => (
              <Row key={i} label={`${f.type[0].toUpperCase()}${f.type.slice(1)} fee`} value={`${f.amount} USDC`} />
            ))}
            {e.gas.map((g, i) => (
              <Row key={i} label={`Network gas (${g.chain.replace(/_/g, ' ')})`} value={`${g.amount} ${g.token}`} />
            ))}
            <Row label="You receive" value={`${e.youReceive} USDC`} />
            <Row label="Estimated time" value={BRIDGE.estimatedTime} />
          </Card>
          <InlineAlert tone="brand">The USDC is delivered to your own address on {to.name}. Circle's forwarding service completes the transfer, so you do not need gas there.</InlineAlert>
          {error && <InlineAlert tone="bad">{error}</InlineAlert>}
          <Button full size="lg" onClick={() => setPinOpen(true)}>
            Confirm with PIN
          </Button>
        </div>
        <PinConfirm open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm bridge" description={`Enter your PIN to bridge ${amount} USDC to ${to.shortName}.`} onConfirmed={run} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Bridge" />
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!problem) setStage('review')
        }}
      >
        <Card className="space-y-3">
          <ChainSelect label="From" value={fromId} onChange={(id) => { setFromId(id); if (id === toId) setToId(fromId) }} />
          <div className="flex justify-center">
            <button type="button" onClick={flip} aria-label="Swap networks" className="grid size-11 place-items-center rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn">
              <ArrowDownUp className="size-5" />
            </button>
          </div>
          <ChainSelect label="To" value={toId} onChange={(id) => { setToId(id); if (id === fromId) setFromId(toId) }} />
        </Card>
        <Card>
          <Input
            label="Amount (USDC)"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.')
              if (isValidAmountInput(v, 6)) setAmount(v)
            }}
            hint={bal.isLoading ? 'Loading balance…' : usdc !== undefined ? `Balance on ${from.shortName}: ${formatToken(usdc, 6, 4, 2)} USDC` : 'Balance unavailable'}
            trailing={
              <button
                type="button"
                disabled={usdc === undefined}
                onClick={() => usdc !== undefined && setAmount(toDecimalString(from.gasIsUsdc ? (usdc > 50_000n ? usdc - 50_000n : 0n) : usdc, 6))}
                className="rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 disabled:opacity-40"
              >
                Max
              </button>
            }
          />
          {bal.error && <p className="mt-2 text-sm text-bad">{describeError(bal.error)}</p>}
        </Card>
        {debounced !== '' && fromId !== toId && (
          <Card>
            {est.isFetching && !estFresh ? (
              <div className="space-y-2"><Skeleton className="h-5" /><Skeleton className="h-5" /></div>
            ) : estFresh ? (
              <div className="divide-y divide-canvas">
                <Row label="Estimated fee" value={`${est.data.totalUsdcFee || '0'} USDC`} />
                <Row label="You receive" value={`${est.data.youReceive} USDC`} />
                <Row label="Estimated time" value={BRIDGE.estimatedTime} />
              </div>
            ) : est.error ? (
              <p className="text-sm text-bad">{describeError(est.error)}</p>
            ) : null}
          </Card>
        )}
        <Button type="submit" full size="lg" disabled={problem !== null}>
          {problem ?? 'Review bridge'}
        </Button>
      </form>
    </>
  )
}

function ChainSelect({ label, value, onChange }: { label: string; value: number; onChange: (id: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-soft">{label}</span>
      <span className="flex h-14 items-center gap-3 rounded-2xl border border-brand-100 bg-white px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
        <ChainIcon chainId={value} size={26} />
        <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-full flex-1 bg-transparent font-semibold text-ink outline-none">
          {CHAINS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}
