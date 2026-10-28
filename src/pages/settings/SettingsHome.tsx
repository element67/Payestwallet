import { BookUser, ChevronRight, History, KeyRound, LockKeyhole, LogOut, Network, ShieldCheck, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChainIcon } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { Card, SectionTitle } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Overlay'
import { notifyToast } from '@/components/ui/Feedback'
import { useAuth } from '@/context/AuthContext'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'

function Item({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[60px] items-center gap-3 px-4 py-3 hover:bg-canvas">
      <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        {hint && <span className="block truncate text-xs text-ink-mute">{hint}</span>}
      </span>
      <ChevronRight className="size-5 text-ink-mute" />
    </Link>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? 'bg-brand-600' : 'bg-brand-100'}`}
    >
      <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
    </button>
  )
}

export default function SettingsHome() {
  const { user, logout, setUser } = useAuth()
  const { lock } = useWallet()
  const { chain, setHideBalances } = useSettings()
  const [confirmOut, setConfirmOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [savingHide, setSavingHide] = useState(false)
  if (!user) return null

  const toggleHide = async (v: boolean) => {
    if (savingHide) return
    setSavingHide(true)
    try {
      const res = await api.updateMe({ hideBalancesDefault: v })
      setUser(res.user)
      setHideBalances(v)
    } catch (err) {
      notifyToast.error(describeError(err))
    } finally {
      setSavingHide(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>

      <Card className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 font-display text-xl font-bold text-white shadow-btn">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-ink">{user.displayName}</p>
          <p className="truncate text-sm text-ink-mute">{user.email}</p>
        </div>
      </Card>

      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="divide-y divide-canvas overflow-hidden p-0">
          <Item to="/settings/profile" icon={<UserRound className="size-5" />} title="Profile" hint="Name and display preferences" />
          <Item to="/settings/contacts" icon={<BookUser className="size-5" />} title="Address book" hint="Saved recipients" />
        </Card>
      </section>

      <section>
        <SectionTitle>Security</SectionTitle>
        <Card className="divide-y divide-canvas overflow-hidden p-0">
          <Item to="/settings/security" icon={<ShieldCheck className="size-5" />} title="Security" hint={user.totpEnabled ? '2FA is on' : 'Password, PIN, 2FA, recovery phrase'} />
          <Item to="/settings/security-log" icon={<History className="size-5" />} title="Security log" hint="Recent sign-ins and devices" />
        </Card>
      </section>

      <section>
        <SectionTitle>Preferences</SectionTitle>
        <Card className="divide-y divide-canvas overflow-hidden p-0">
          <Item to="/settings/network" icon={<Network className="size-5" />} title="Network" hint={<span className="inline-flex items-center gap-1.5"><ChainIcon chainId={chain.id} size={14} />{chain.name} (testnet)</span>} />
          <div className="flex min-h-[60px] items-center gap-3 px-4 py-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <KeyRound className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">Hide balances by default</span>
              <span className="block text-xs text-ink-mute">Amounts show as dots until you tap the eye</span>
            </span>
            <Switch checked={user.hideBalancesDefault} onChange={toggleHide} label="Hide balances by default" disabled={savingHide} />
          </div>
        </Card>
      </section>

      <div className="space-y-2">
        <Button full variant="secondary" size="lg" icon={<LockKeyhole className="size-5" />} onClick={lock}>
          Lock wallet
        </Button>
        <Button full variant="secondary" size="lg" className="text-bad" icon={<LogOut className="size-5" />} onClick={() => setConfirmOut(true)}>
          Sign out
        </Button>
      </div>
      <p className="text-center text-xs text-ink-mute">Payest Wallet runs on testnet only. Test tokens have no real value.</p>

      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?" locked={signingOut}>
        <p className="text-sm text-ink-soft">Your wallet stays encrypted on this device. You will need your password and PIN to get back in.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" full onClick={() => setConfirmOut(false)} disabled={signingOut}>
            Cancel
          </Button>
          <Button
            full
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true)
              lock()
              await logout()
            }}
          >
            Sign out
          </Button>
        </div>
      </Modal>
    </div>
  )
}
