import { Copy, Share2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { ChainIcon } from '@/components/Icons'
import { QrCode } from '@/components/Qr'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { InlineAlert, notifyToast } from '@/components/ui/Feedback'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'

export default function Receive() {
  const { address } = useWallet()
  const { chain } = useSettings()
  if (!address) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      notifyToast.success('Address copied')
    } catch {
      notifyToast.error('Could not copy. Select the address and copy it manually.')
    }
  }

  const share = async () => {
    const text = `My Payest Wallet address on ${chain.name} (testnet):\n${address}`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'My Payest Wallet address', text })
        return
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      notifyToast.success('Sharing is not available here, so the address was copied instead.')
    } catch {
      notifyToast.error('Could not share or copy the address.')
    }
  }

  return (
    <>
      <PageHeader title="Receive" />
      <div className="space-y-4">
        <Card className="flex flex-col items-center py-6">
          <p className="mb-4 flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-sm font-semibold text-ink-soft">
            <ChainIcon chainId={chain.id} size={18} /> {chain.name}
          </p>
          <QrCode value={address} />
          <p className="mt-4 break-all px-2 text-center font-mono text-sm text-ink" data-testid="address">
            {address}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" icon={<Copy className="size-5" />} onClick={copy}>
            Copy
          </Button>
          <Button size="lg" icon={<Share2 className="size-5" />} onClick={share}>
            Share
          </Button>
        </div>
        <InlineAlert tone="warn">Only send {chain.name} testnet tokens ({chain.tokens.map((t) => t.symbol).join(', ')}) to this address. Test tokens have no real value.</InlineAlert>
      </div>
    </>
  )
}
