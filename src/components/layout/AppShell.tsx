import { Activity, ArrowLeft, Bell, Home, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '@/context/SettingsContext'
import { useIncomingWatcher } from '@/hooks/useIncoming'
import { useReconcilePending } from '@/hooks/useReconcile'
import { useUnreadCount } from '@/hooks/useSession'
import { cn } from '@/lib/cn'
import { ChainIcon } from '../Icons'
import { Logo, TestnetBadge } from './AuthLayout'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/notifications', label: 'Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const MAIN_PATHS = new Set(['/', '/activity', '/notifications', '/settings'])

export default function AppShell() {
  const { chain } = useSettings()
  const unread = useUnreadCount()
  const nav = useNavigate()
  const { pathname } = useLocation()
  useIncomingWatcher()
  useReconcilePending()
  const showNav = MAIN_PATHS.has(pathname)

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-canvas/85 px-4 pb-2 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-bold text-ink">Payest Wallet</p>
              <TestnetBadge />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => nav('/settings/network')}
              className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-ink-soft shadow-card"
              aria-label={`Network: ${chain.name}. Change network`}
            >
              <ChainIcon chainId={chain.id} size={18} />
              <span className="max-w-[88px] truncate">{chain.shortName}</span>
            </button>
            <button
              type="button"
              onClick={() => nav('/notifications')}
              className="relative grid size-11 place-items-center rounded-full bg-white text-ink-soft shadow-card"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-bad px-1 text-[11px] font-bold leading-5 text-white tabular">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] font-medium text-warn">Testnet only. Test tokens have no real value.</p>
      </header>

      <main className={cn('px-4 pt-4', showNav ? 'pb-28' : 'pb-10')}>
        <Outlet />
      </main>

      {showNav && (
        <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-white/70 bg-white/90 px-2 pt-1.5 backdrop-blur-md">
          <ul className="grid grid-cols-4">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn('flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold', isActive ? 'text-brand-600' : 'text-ink-mute')
                  }
                >
                  <Icon className="size-6" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}

export function PageHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack ?? (() => nav(-1))}
          aria-label="Go back"
          className="grid size-11 place-items-center rounded-full bg-white text-ink-soft shadow-card"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
      </div>
      {right}
    </div>
  )
}
