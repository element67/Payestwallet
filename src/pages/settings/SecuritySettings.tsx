import { Eye, KeyRound, LockKeyhole, Smartphone, UserRoundCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/AppShell'
import { ChangePasswordSheet } from '@/components/settings/ChangePasswordSheet'
import { ChangePinSheet } from '@/components/settings/ChangePinSheet'
import { RevealPhrase } from '@/components/settings/RevealPhrase'
import { TwoFactorSheet } from '@/components/settings/TwoFactorSheet'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, InlineAlert } from '@/components/ui/Feedback'
import { useAuth } from '@/context/AuthContext'

function Item({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-mute">{hint}</p>
      </div>
      {action}
    </div>
  )
}

type Sheet = 'password' | 'pin' | '2fa' | 'phrase' | null

export default function SecuritySettings() {
  const { user } = useAuth()
  const [sheet, setSheet] = useState<Sheet>(null)
  const close = () => setSheet(null)
  if (!user) return null

  return (
    <>
      <PageHeader title="Security" />
      <div className="space-y-4">
        <Card className="divide-y divide-canvas p-0">
          <Item icon={<KeyRound className="size-5" />} title="Password" hint="Used to sign in to your account" action={<Button size="sm" variant="secondary" onClick={() => setSheet('password')}>Change</Button>} />
          <Item icon={<LockKeyhole className="size-5" />} title="Transaction PIN" hint="Unlocks this device and confirms sends, swaps and bridges" action={<Button size="sm" variant="secondary" onClick={() => setSheet('pin')}>Change</Button>} />
          <Item
            icon={<Smartphone className="size-5" />}
            title="Two-factor authentication"
            hint={user.totpEnabled ? <Badge tone="ok">On</Badge> : 'Add a code from an authenticator app'}
            action={<Button size="sm" variant={user.totpEnabled ? 'secondary' : 'primary'} onClick={() => setSheet('2fa')}>{user.totpEnabled ? 'Manage' : 'Enable'}</Button>}
          />
          <Item icon={<Eye className="size-5" />} title="Recovery phrase" hint="Requires your PIN" action={<Button size="sm" variant="secondary" onClick={() => setSheet('phrase')}>Show</Button>} />
        </Card>
        <InlineAlert tone="brand">
          <span className="flex gap-2">
            <UserRoundCheck className="mt-0.5 size-4 shrink-0" />
            Your recovery phrase and keys never leave this device. Payest cannot recover them for you, so keep your phrase safe.
          </span>
        </InlineAlert>
      </div>
      <ChangePasswordSheet open={sheet === 'password'} onClose={close} />
      <ChangePinSheet open={sheet === 'pin'} onClose={close} />
      <TwoFactorSheet open={sheet === '2fa'} onClose={close} />
      <RevealPhrase open={sheet === 'phrase'} onClose={close} />
    </>
  )
}
