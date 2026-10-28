import { Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { ChainIcon } from '@/components/Icons'
import { Card } from '@/components/ui/Card'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { CHAINS } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { cn } from '@/lib/cn'

export default function NetworkSettings() {
  const { chain, setChainId } = useSettings()
  return (
    <>
      <PageHeader title="Network" />
      <div className="space-y-4">
        <InlineAlert tone="warn">Testnets only. Mainnet networks are not available in this app.</InlineAlert>
        <Card className="divide-y divide-canvas p-0">
          {CHAINS.map((c) => {
            const active = c.id === chain.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (active) return
                  setChainId(c.id)
                  notifyToast.success(`Switched to ${c.name}`)
                }}
                aria-pressed={active}
                className={cn('flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas', active && 'bg-brand-50/60')}
              >
                <ChainIcon chainId={c.id} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{c.name}</span>
                  <span className="block text-xs text-ink-mute">
                    Gas: {c.nativeSymbol} · Tokens: {c.tokens.map((t) => t.symbol).join(', ')}
                    {c.supportsSwap ? ' · Swap' : ''}
                  </span>
                </span>
                {active && <Check className="size-5 text-brand-600" />}
              </button>
            )
          })}
        </Card>
        <p className="px-2 text-center text-xs text-ink-mute">Your address is the same on every network. Gas on networks other than Arc is paid in the network's own test token.</p>
      </div>
    </>
  )
}
