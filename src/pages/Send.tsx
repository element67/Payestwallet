import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddressInput } from '@/components/AddressInput'
import { TokenIcon } from '@/components/Icons'
import { PageHeader } from '@/components/layout/AppShell'
import { PinConfirm } from '@/components/PinConfirm'
import { TxStatus } from '@/components/TxStatus'
import { Button } from '@/components/ui/Button'
import { Card, Row } from '@/components/ui/Card'
import { InlineAlert, Skeleton, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { getToken } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { useBalances } from '@/hooks/useBalances'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { estimateTransferFee, sendToken } from '@/lib/chain'
import { describeError } from '@/lib/errors'
import { formatToken, isValidAddress, isValidAmountInput, shortAddress, toDecimalString } from '@/lib/format'
import { parseUnitsExact } from '@/onchain-money'

type Stage = 'form' | 'review' | 'status'

function safeParse(value: string, decimals: number): bigint | null {
  if (!value || value === '.') return null
  try {
    return parseUnitsExact(value, decimals)
  } catch {
    return null
  }
}

export default function Send() {
  const nav = useNavigate()
  const { chain } = useSettings()
  const { address, account } = useWallet()
  const balances = useBalances()
  const [stage, setStage] = useState<Stage>('form')
  const [symbol, setSymbol] = useState<string>('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [result, setResult] = useState<{ hash: string; recordId: string | null } | null>(null)
  const sending = useRef(false)

  const token = getToken(chain.id, symbol) ?? chain.tokens[0]
  const balance = balances.data?.tokens[token.symbol]
  const usdcBalance = balances.data?.tokens.USDC ?? 0n
  const toValid = isValidAddress(to)
  const raw = safeParse(amount, token.decimals)

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts(), retry: 0, staleTime: 60_000 })
  const contactName = contacts.data?.data.find((c) => c.address.toLowerCase() === to.toLowerCase())?.name

  const fee = useQuery({
    queryKey: ['fee', chain.id, token.symbol, address, toValid ? to.toLowerCase() : 'self'],
    enabled: Boolean(address) && balances.isSuccess,
    queryFn: () => estimateTransferFee(chain.id, token, address!, (toValid ? to : address!) as `0x${string}`, 1n),
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
  })

  /** Largest amount that still leaves room for the network fee. */
  const max = useMemo(() => {
    if (balance === undefined) return null
    if (chain.gasIsUsdc && token.symbol === 'USDC') {
      if (!fee.data?.feeUsdcRaw) return null
      return balance > fee.data.feeUsdcRaw ? balance - fee.data.feeUsdcRaw : 0n
    }
    return balance
  }, [balance, chain.gasIsUsdc, token.symbol, fee.data])

  const feeShort = useMemo(() => {
    if (!fee.data) return null
    const f = fee.data
    if (f.feeUsdcRaw !== null) return f.feeUsdcRaw < 100n ? '< 0.0001 USDC' : `${formatToken(f.feeUsdcRaw, 6, 4, 2)} USDC`
    const v = formatToken(f.feeNative, chain.nativeDecimals, 6, 2)
    return `${v === '0.00' ? '< 0.000001' : v} ${chain.nativeSymbol}`
  }, [fee.data, chain.nativeDecimals, chain.nativeSymbol])

  const problem = useMemo((): string | null => {
    if (!toValid) return to ? 'Enter a valid 0x wallet address.' : 'Enter a recipient address.'
    if (raw === null) return amount ? 'Enter a valid amount.' : 'Enter an amount.'
    if (raw === 0n) return 'Amount must be greater than zero.'
    if (balance === undefined) return 'Balance is still loading.'
    if (raw > balance) return `Insufficient ${token.symbol} balance.`
    if (fee.data) {
      if (chain.gasIsUsdc) {
        const need = fee.data.feeUsdcRaw! + (token.symbol === 'USDC' ? raw : 0n)
        if (need > usdcBalance) return 'Not enough USDC to cover the amount plus the network fee.'
      } else if (balances.data && fee.data.feeNative > balances.data.native) {
        return `Not enough ${chain.nativeSymbol} to pay the network fee.`
      }
    }
    return null
  }, [toValid, to, raw, amount, balance, token.symbol, fee.data, chain, usdcBalance, balances.data])

  const ready = problem === null && fee.isSuccess
  const selfSend = toValid && address ? to.toLowerCase() === address.toLowerCase() : false

  const execute = async () => {
    if (sending.current || !account || raw === null || !address) return
    sending.current = true
    setSendError(null)
    try {
      const hash = await sendToken({ chainId: chain.id, account, token, to: to as `0x${string}`, amountRaw: raw })
      let recordId: string | null = null
      try {
        const rec = await api.recordTransaction({
          walletAddress: address,
          chainId: chain.id,
          type: 'send',
          status: 'pending',
          tokenSymbol: token.symbol,
          amount: toDecimalString(raw, token.decimals),
          fromAddress: address,
          toAddress: to,
          txHash: hash,
          feeSymbol: chain.gasIsUsdc ? 'USDC' : chain.nativeSymbol,
        })
        recordId = rec.id
      } catch {
        notifyToast.info('Sent. Your history will update shortly.')
      }
      setResult({ hash, recordId })
      setStage('status')
    } catch (err) {
      setSendError(describeError(err))
    } finally {
      sending.current = false
      setPinOpen(false)
    }
  }

  if (stage === 'status' && result && raw !== null) {
    return (
      <>
        <PageHeader title="Send" onBack={() => nav('/')} />
        <TxStatus
          chainId={chain.id}
          hash={result.hash}
          recordId={result.recordId}
          title="Transfer"
          detail={<>{toDecimalString(raw, token.decimals)} {token.symbol} to {contactName ?? shortAddress(to)}</>}
          onDone={() => nav('/')}
        />
      </>
    )
  }

  if (stage === 'review' && raw !== null) {
    return (
      <>
        <PageHeader title="Review" onBack={() => setStage('form')} />
        <div className="space-y-4">
          <Card className="py-6 text-center">
            <p className="text-sm font-semibold text-ink-mute">You are sending</p>
            <p className="font-display text-4xl font-bold text-ink tabular">{toDecimalString(raw, token.decimals)}</p>
            <p className="font-semibold text-ink-soft">{token.symbol}</p>
          </Card>
          <Card className="divide-y divide-canvas py-1">
            <Row label="To" value={contactName ? `${contactName} (${shortAddress(to)})` : shortAddress(to, 10, 8)} />
            <Row label="Network" value={chain.name} />
            <Row label="Network fee" value={feeShort ?? '—'} />
            {chain.gasIsUsdc && token.symbol === 'USDC' && fee.data?.feeUsdcRaw != null && raw !== null && (
              <Row label="Total" value={`${formatToken(raw + fee.data.feeUsdcRaw, 6, 6, 2)} USDC`} />
            )}
          </Card>
          {selfSend && (
            <InlineAlert tone="warn">
              <span className="flex gap-2"><AlertTriangle className="size-4 shrink-0" /> This is your own address. You will only pay the network fee.</span>
            </InlineAlert>
          )}
          <InlineAlert tone="brand">Transactions cannot be reversed. Check the address carefully.</InlineAlert>
          {sendError && <InlineAlert tone="bad">{sendError}</InlineAlert>}
          <Button full size="lg" onClick={() => setPinOpen(true)} disabled={!ready}>
            Confirm with PIN
          </Button>
        </div>
        <PinConfirm
          open={pinOpen}
          onClose={() => setPinOpen(false)}
          title="Confirm transfer"
          description={`Enter your PIN to send ${toDecimalString(raw, token.decimals)} ${token.symbol}.`}
          onConfirmed={execute}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Send" />
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (ready) setStage('review')
        }}
      >
        <Card className="space-y-4">
          <AddressInput value={to} onChange={(v) => setTo(v)} />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-soft">Token</p>
            <div className="flex gap-2">
              {chain.tokens.map((t) => (
                <button
                  key={t.symbol}
                  type="button"
                  onClick={() => {
                    setSymbol(t.symbol)
                    setAmount('')
                  }}
                  aria-pressed={t.symbol === token.symbol}
                  className={cn('flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border font-semibold', t.symbol === token.symbol ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-brand-100 text-ink-soft')}
                >
                  <TokenIcon symbol={t.symbol} size={22} /> {t.symbol}
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.')
              if (isValidAmountInput(v, token.decimals)) setAmount(v)
            }}
            hint={
              balances.isLoading ? (
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              ) : balance !== undefined ? (
                `Balance: ${formatToken(balance, token.decimals, 4, 2)} ${token.symbol}`
              ) : (
                'Balance unavailable'
              )
            }
            trailing={
              <button
                type="button"
                onClick={() => max !== null && setAmount(toDecimalString(max, token.decimals))}
                disabled={max === null}
                className="rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 disabled:opacity-40"
              >
                Max
              </button>
            }
          />
          <div className="flex items-center justify-between rounded-2xl bg-canvas px-4 py-3 text-sm">
            <span className="text-ink-mute">Estimated network fee</span>
            {fee.isLoading ? <Skeleton className="h-4 w-20" /> : fee.error ? <span className="text-bad">Unavailable</span> : <span className="font-semibold tabular text-ink">{feeShort}</span>}
          </div>
        </Card>
        {fee.error && <InlineAlert tone="warn">Could not estimate the fee: {describeError(fee.error)}</InlineAlert>}
        {touched && problem && <InlineAlert tone="bad">{problem}</InlineAlert>}
        <Button type="submit" full size="lg" disabled={!fee.isSuccess && !fee.isError ? true : false}>
          Review
        </Button>
      </form>
    </>
  )
}
