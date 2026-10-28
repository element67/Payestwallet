import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import { useSessionHold } from '@/hooks/useSession'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { findChainConfig, getChainConfig, txUrl } from '@/config/app'
import { api } from '@/lib/api'
import { waitForReceipt } from '@/lib/chain'
import { formatUnitsExact } from '@/onchain-money'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { InlineAlert, Spinner } from './ui/Feedback'

interface Props {
  chainId: number
  hash: string
  /** Backend record to update when the receipt arrives. */
  recordId: string | null
  title: string
  detail: ReactNode
  /** Extra fields written to the record on confirmation (for example the swap output). */
  confirmedPatch?: { toAmount?: string }
  onDone: () => void
  /** Label for the primary button once final. */
  doneLabel?: string
}

type Phase = 'pending' | 'confirmed' | 'failed'

/** Real status tracking: pending until a receipt exists, then confirmed or failed. Never simulated. */
export function TxStatus({ chainId, hash, recordId, title, detail, confirmedPatch, onDone, doneLabel = 'Done' }: Props) {
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>('pending')
  useSessionHold(phase === 'pending')
  const [slow, setSlow] = useState(false)
  const [syncWarn, setSyncWarn] = useState(false)
  const running = useRef(false)
  const finished = useRef(false)
  const patchRef = useRef(confirmedPatch)
  useEffect(() => {
    patchRef.current = confirmedPatch
  })

  const track = useCallback(async () => {
    if (running.current || finished.current) return
    running.current = true
    setSlow(false)
    try {
      const out = await waitForReceipt(chainId, hash as `0x${string}`)
      if (out.status === 'timeout') return setSlow(true)
      const cfg = getChainConfig(chainId)
      finished.current = true
      setPhase(out.status)
      if (recordId) {
        const feeNative = out.gasUsed * out.effectiveGasPrice
        const fee = formatUnitsExact(feeNative, cfg.nativeDecimals).slice(0, 12)
        await api
          .updateTransaction(recordId, out.status === 'confirmed' ? { status: 'confirmed', fee, ...patchRef.current } : { status: 'failed', fee, error: 'The network rejected this transaction.' })
          .catch(() => setSyncWarn(true))
      }
      void qc.invalidateQueries({ queryKey: ['balances'] })
      void qc.invalidateQueries({ queryKey: ['transactions'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    } finally {
      running.current = false
    }
  }, [chainId, hash, recordId, qc])

  useEffect(() => {
    void track()
  }, [track])

  const chain = findChainConfig(chainId)
  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center py-8 text-center">
        {phase === 'pending' && <Spinner className="mb-3 size-12" />}
        {phase === 'confirmed' && <CheckCircle2 className="mb-3 size-12 text-ok" />}
        {phase === 'failed' && <XCircle className="mb-3 size-12 text-bad" />}
        <h2 className="font-display text-2xl font-bold text-ink">
          {phase === 'pending' ? `${title} pending` : phase === 'confirmed' ? `${title} confirmed` : `${title} failed`}
        </h2>
        <div className="mt-2 text-ink-soft">{detail}</div>
      </Card>
      {phase === 'pending' && !slow && <InlineAlert tone="brand">Waiting for the network to confirm. You can leave this screen. It will keep updating in Activity.</InlineAlert>}
      {slow && phase === 'pending' && (
        <InlineAlert tone="warn">
          This is taking longer than usual. Your transaction was sent and may still confirm.
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void track()}>
            Check again
          </Button>
        </InlineAlert>
      )}
      {phase === 'failed' && <InlineAlert tone="bad">The network rejected the transaction. Your funds did not move, apart from the network fee.</InlineAlert>}
      {syncWarn && <InlineAlert tone="warn">The transaction is done, but your history could not be updated right now. It will sync later.</InlineAlert>}
      {chain && (
        <a href={txUrl(chainId, hash)} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-brand-700 shadow-card">
          View on {chain.shortName} explorer <ExternalLink className="size-4" />
        </a>
      )}
      <Button full size="lg" onClick={onDone}>
        {doneLabel}
      </Button>
      {recordId && (
        <Link to={`/activity/${recordId}`} className="block text-center text-sm font-semibold text-brand-600">
          Transaction details
        </Link>
      )}
    </div>
  )
}
