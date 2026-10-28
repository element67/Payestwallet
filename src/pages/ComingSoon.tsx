import { ArrowDownToLine, Clock, Landmark, MoreHorizontal, Sprout, Users } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Feedback'
import { fiatProvider, type FiatFeatureId } from '@/services/fiat'

const ICONS: Record<FiatFeatureId, typeof Landmark> = {
  exchange: Landmark,
  p2p: Users,
  defi: Sprout,
  deposit: ArrowDownToLine,
  more: MoreHorizontal,
}

const PLANNED: Record<FiatFeatureId, string[]> = {
  exchange: ['Sell USDC and receive Naira in your bank account', 'Live rates with a clear fee preview', 'Instant payout tracking'],
  p2p: ['Trade with verified people', 'Escrow protects both sides', 'Choose your own payment method'],
  defi: ['Earn yield on idle stablecoins', 'Audited, well-known protocols', 'Withdraw any time'],
  deposit: ['Fund your wallet from a Nigerian bank account', 'Pay by transfer with a unique reference', 'Naira balance converted to USDC'],
  more: ['Bill payments and airtime', 'Virtual cards', 'Savings goals'],
}

export default function ComingSoon() {
  const { feature } = useParams()
  const nav = useNavigate()
  const item = fiatProvider.listFeatures().find((f) => f.id === feature)
  if (!item) return <Navigate to="/" replace />
  const Icon = ICONS[item.id]

  return (
    <>
      <PageHeader title={item.title} />
      <div className="space-y-4">
        <Card className="relative overflow-hidden py-10 text-center">
          <div className="pointer-events-none absolute -left-8 -top-8 size-36 rounded-full bg-brand-100/80 blur-2xl" aria-hidden />
          <div className="relative flex flex-col items-center">
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn">
              <Icon className="size-9" />
            </span>
            <Badge tone="brand" className="mt-5">
              <Clock className="size-3.5" /> Coming soon
            </Badge>
            <h2 className="mt-3 font-display text-2xl font-bold text-ink">{item.title}</h2>
            <p className="mx-auto mt-2 max-w-xs text-ink-soft">{item.description}</p>
          </div>
        </Card>
        <Card>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-mute">What to expect</h3>
          <ul className="space-y-2.5">
            {PLANNED[item.id].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-ink-soft">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                {line}
              </li>
            ))}
          </ul>
        </Card>
        <p className="px-2 text-center text-xs text-ink-mute">This feature is not live on the testnet app yet. Nothing here moves real money.</p>
        <Button full size="lg" variant="secondary" onClick={() => nav('/')}>
          Back to home
        </Button>
      </div>
    </>
  )
}
