import { useQuery } from '@tanstack/react-query'
import { ArrowDownUp, AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TokenIcon } from '@/components/Icons'
import { PageHeader } from '@/components/layout/AppShell'
import { PinConfirm } from '@/components/PinConfirm'
import { TxStatus } from '@/components/TxStatus'
import { Button } from '@/components/ui/Button'
import { Card, Row } from '@/components/ui/Card'
import { InlineAlert, Skeleton, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { SWAP, getChainConfig } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { useBalances } from '@/hooks/useBalances'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { describeError } from '@/lib/errors'
import { formatToken, isValidAmountInput, toDecimalString } from '@/lib/format'
import { parseUnitsExact } from '@/onchain-money'
import { executeSwap, quoteSwap } from '@/services/swap'

type Stage = 'form' | 'review' | 'status'
const GAS_RESERVE = 50_000n // 0.05 USDC kept for the network fee (Arc pays gas in USDC)

function safeParse(v: string, d: number): bigint | null {
  if (!v || v === '.') return null
  try {
    return parseUnitsExact(v, d)
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

export default function Swap() {
  const nav = useNavigate()
  const { chain, setChainId } = useSettings()
  const { address, getAdapter } = useWallet()
  const balances = useBalances()
  const swapChain = getChainConfig(SWAP.chainId)
  const [stage, setStage] = useState<Stage>('form')
  const [tokenIn, setTokenIn] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState<number>(SWAP.defaultSlippageBps)
  const [ack, setAck] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ hash: string; recordId: string | null; out: string | null } | null>(null)
  const running = useRef(false)

  const tokenOut = tokenIn === 'USDC' ? 'EURC' : 'USDC'
  const tin = swapChain.tokens.find((t) => t.symbol === tokenIn)!
  const raw = safeParse(amount, tin.decimals)
  const balIn = balances.data?.tokens[tokenIn]
  const debounced = useDebounced(raw && raw > 0n ? amount : '', 600)
  const onSwapChain = chain.id === SWAP.chainId

  const quote = useQuery({
    queryKey: ['swap-quote', tokenIn, tokenOut, debounced, slippage, address],
    enabled: onSwapChain && debounced !== '' && Boolean(address),
    retry: 0,
    staleTime: 10_000,
    refetchInterval: 20_000,
    queryFn: async () => quoteSwap(await getAdapter(), tokenIn, tokenOut, debounced, slippage),
  })

  const max = useMemo(() => {
    if (balIn === undefined) return null
    if (tokenIn === 'USDC') return balIn > GAS_RESERVE ? balIn - GAS_RESERVE : 0n
    return balIn
  }, [balIn, tokenIn])

  const quoteFresh = quote.data && quote.data.amountIn === amount
  const impact = quote.data?.priceImpactPct ?? 0
  const highImpact = impact >= SWAP.priceImpactWarnPct
  const veryHigh = impact >= 5

  const problem = ((): string | null => {
    if (raw === null || raw === 0n) return 'Enter an amount to swap.'
    if (balIn === undefined) return 'Balance is still loading.'
    if (raw > balIn) return `Insufficient ${tokenIn} balance.`
    if (tokenIn === 'USDC' && raw + GAS_RESERVE > balIn) return 'Leave a little USDC for the network fee.'
    if (!quoteFresh) return quote.error ? 'No quote available for this amount.' : 'Getting a live quote…'
    if (veryHigh && !ack) return 'Confirm you accept the high price impact.'
    return null
  })()

  const run = async () => {
    if (running.current || raw === null || !address || !quote.data) return
    running.current = true
    setError(null)
    try {
      const adapter = await getAdapter()
      const out = await executeSwap(adapter, tokenIn, tokenOut, amount, slippage)
      let recordId: string | null = null
      try {
        const rec = await api.recordTransaction({
          walletAddress: address,
          chainId: SWAP.chainId,
          type: 'swap',
          status: 'pending',
          tokenSymbol: tokenIn,
          amount: toDecimalString(raw, tin.decimals),
          toTokenSymbol: tokenOut,
          toAmount: out.amountOut && /^\d{1,18}(\.\d{1,18})?$/.test(out.amountOut) ? out.amountOut : undefined,
          fromAddress: address,
          toAddress: address,
          txHash: out.txHash,
        })
        recordId = rec.id
      } catch {
        notifyToast.info('Swap sent. Your history will update shortly.')
      }
      setResult({ hash: out.txHash, recordId, out: out.amountOut })
      setStage('status')
    } catch (err) {
      setError(describeError(err))
    } finally {
      running.current = false
      setPinOpen(false)
    }
  }

  if (!onSwapChain) {
    return (
      <>
        <PageHeader title="Swap" />
        <Card className="space-y-4 text-center">
          <p className="text-ink-soft">Swaps are available on {swapChain.name}. You are on {chain.name}.</p>
          <Button full size="lg" onClick={() => setChainId(SWAP.chainId)}>
            Switch to {swapChain.name}
          </Button>
        </Card>
      </>
    )
  }

  if (stage === 'status' && result) {
    return (
      <>
        <PageHeader title="Swap" onBack={() => nav('/')} />
        <TxStatus
          chainId={SWAP.chainId}
          hash={result.hash}
          recordId={result.recordId}
          title="Swap"
          detail={<>{amount} {tokenIn} to {result.out ? `${result.out} ${tokenOut}` : tokenOut}</>}
          confirmedPatch={result.out && /^\d{1,18}(\.\d{1,18})?$/.test(result.out) ? { toAmount: result.out } : undefined}
          onDone={() => nav('/')}
        />
      </>
    )
  }

  const q = quote.data
  if (stage === 'review' && q && raw !== null) {
    return (
      <>
        <PageHeader title="Review swap" onBack={() => setStage('form')} />
        <div className="space-y-4">
          <Card className="flex items-center justify-between py-5">
            <div className="text-center">
              <TokenIcon symbol={tokenIn} size={40} />
              <p className="mt-1 font-display text-xl font-bold tabular">{amount}</p>
              <p className="text-sm text-ink-mute">{tokenIn}</p>
            </div>
            <ArrowDownUp className="size-5 rotate-90 text-brand-500" />
            <div className="text-center">
              <TokenIcon symbol={tokenOut} size={40} />
              <p className="mt-1 font-display text-xl font-bold tabular">{Number(q.estimatedOut).toFixed(4)}</p>
              <p className="text-sm text-ink-mute">{tokenOut}</p>
            </div>
          </Card>
          <Card className="divide-y divide-canvas py-1">
            <Row label="Rate" value={`1 ${tokenIn} = ${q.rate.toFixed(4)} ${tokenOut}`} />
            <Row label="Minimum received" value={`${Number(q.minimumOut).toFixed(4)} ${tokenOut}`} />
            <Row label="Slippage" value={`${slippage / 100}%`} />
            <Row label="Price impact" value={`${q.priceImpactPct.toFixed(2)}%`} />
            {q.fees.map((f, i) => (
              <Row key={i} label={`${f.type[0].toUpperCase()}${f.type.slice(1)} fee`} value={`${f.amount} ${f.token}`} />
            ))}
            <Row label="Network" value={swapChain.name} />
          </Card>
          <InlineAlert tone="brand">Quotes can move before the swap lands. You will receive at least the minimum shown. Swaps are routed through a third-party swap provider.</InlineAlert>
          {error && <InlineAlert tone="bad">{error}</InlineAlert>}
          <Button full size="lg" onClick={() => setPinOpen(true)}>
            Confirm with PIN
          </Button>
        </div>
        <PinConfirm open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm swap" description={`Enter your PIN to swap ${amount} ${tokenIn} for ${tokenOut}.`} onConfirmed={run} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Swap" />
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!problem) setStage('review')
        }}
      >
        <Card className="space-y-3">
          <Input
            label={`You pay (${tokenIn})`}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.')
              if (isValidAmountInput(v, tin.decimals)) {
                setAmount(v)
                setAck(false)
              }
            }}
            hint={balIn !== undefined ? `Balance: ${formatToken(balIn, tin.decimals, 4, 2)} ${tokenIn}` : balances.isLoading ? 'Loading balance…' : 'Balance unavailable'}
            trailing={
              <>
                <TokenIcon symbol={tokenIn} size={22} />
                <button
                  type="button"
                  disabled={max === null}
                  onClick={() => max !== null && setAmount(toDecimalString(max, tin.decimals))}
                  className="rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 disabled:opacity-40"
                >
                  Max
                </button>
              </>
            }
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                setTokenIn(tokenOut)
                setAmount('')
              }}
              aria-label="Flip tokens"
              className="grid size-11 place-items-center rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn"
            >
              <ArrowDownUp className="size-5" />
            </button>
          </div>
          <div className="rounded-2xl bg-canvas p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-soft">You receive ({tokenOut})</span>
              <TokenIcon symbol={tokenOut} size={22} />
            </div>
            <div className="mt-1 font-display text-2xl font-bold tabular text-ink">
              {quote.isFetching && !quote.data ? <Skeleton className="h-8 w-28" /> : quoteFresh && q ? Number(q.estimatedOut).toFixed(4) : '0.0000'}
            </div>
            {quote.error && <p className="mt-1 text-sm text-bad">{describeError(quote.error)}</p>}
          </div>
        </Card>

        <Card className="space-y-3">
          <p className="text-sm font-semibold text-ink-soft">Slippage tolerance</p>
          <div className="flex gap-2" role="group" aria-label="Slippage tolerance">
            {SWAP.slippageOptionsBps.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => setSlippage(bps)}
                aria-pressed={slippage === bps}
                className={cn('min-h-[44px] flex-1 rounded-2xl text-sm font-semibold', slippage === bps ? 'bg-brand-600 text-white shadow-btn' : 'bg-canvas text-ink-soft')}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
          {quoteFresh && q && (
            <div className="divide-y divide-canvas text-sm">
              <Row label="Rate" value={`1 ${tokenIn} = ${q.rate.toFixed(4)} ${tokenOut}`} />
              <Row label="Minimum received" value={`${Number(q.minimumOut).toFixed(4)} ${tokenOut}`} />
              <Row label="Price impact" value={<span className={cn(highImpact && 'text-bad')}>{q.priceImpactPct.toFixed(2)}%</span>} />
            </div>
          )}
        </Card>

        {quoteFresh && highImpact && (
          <InlineAlert tone="bad">
            <span className="flex gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              High price impact ({impact.toFixed(2)}%). You will get a noticeably worse rate than for a small trade. Try a smaller amount.
            </span>
          </InlineAlert>
        )}
        {quoteFresh && veryHigh && (
          <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink-soft">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-5 accent-brand-600" />I understand the price impact and still want to swap.
          </label>
        )}
        <Button type="submit" full size="lg" disabled={problem !== null}>
          {problem ?? 'Review swap'}
        </Button>
      </form>
    </>
  )
}
