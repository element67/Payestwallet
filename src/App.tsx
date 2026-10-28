import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Feedback'
import { useInactivity } from '@/hooks/useSession'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { WalletProvider, useWallet } from '@/context/WalletContext'
import Login from '@/pages/auth/Login'
import { ForgotPassword, ResetPassword } from '@/pages/auth/Recover'
import Register from '@/pages/auth/Register'
import LockScreen from '@/pages/LockScreen'
import WalletSetup from '@/pages/WalletSetup'
import Home from '@/pages/Home'
import Receive from '@/pages/Receive'
import Send from '@/pages/Send'
import Activity from '@/pages/Activity'
import TransactionDetail from '@/pages/TransactionDetail'
import Notifications from '@/pages/Notifications'
import ComingSoon from '@/pages/ComingSoon'
import SettingsHome from '@/pages/settings/SettingsHome'
import Profile from '@/pages/settings/Profile'
import SecuritySettings from '@/pages/settings/SecuritySettings'
import NetworkSettings from '@/pages/settings/NetworkSettings'
import Contacts from '@/pages/settings/Contacts'
import SecurityLog from '@/pages/settings/SecurityLog'

// Swap and bridge pull in the Circle App Kit, so they load on demand.
const Swap = lazy(() => import('@/pages/Swap'))
const Bridge = lazy(() => import('@/pages/Bridge'))

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-8" />
    </div>
  )
}

/** Runs for the whole signed-in session, including while the wallet is locked. */
function SessionWatcher() {
  useInactivity()
  return null
}

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'booting') return <Splash />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireAuth() {
  const { status } = useAuth()
  if (status === 'booting') return <Splash />
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireWallet() {
  const { status } = useWallet()
  if (status === 'none') return <Navigate to="/setup" replace />
  if (status === 'locked') return <LockScreen />
  return <Outlet />
}

function SetupGate() {
  const { status } = useWallet()
  return status === 'none' ? <WalletSetup /> : <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WalletProvider>
          <SettingsProvider>
            <ScrollTop />
            <SessionWatcher />
            <Suspense fallback={<Splash />}>
              <Routes>
                <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
                <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
                <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
                <Route path="/reset-password" element={<ResetPassword />} />

                <Route element={<RequireAuth />}>
                  <Route path="/setup" element={<SetupGate />} />
                  <Route element={<RequireWallet />}>
                    <Route element={<AppShell />}>
                      <Route index element={<Home />} />
                      <Route path="send" element={<Send />} />
                      <Route path="receive" element={<Receive />} />
                      <Route path="swap" element={<Swap />} />
                      <Route path="bridge" element={<Bridge />} />
                      <Route path="activity" element={<Activity />} />
                      <Route path="activity/:id" element={<TransactionDetail />} />
                      <Route path="notifications" element={<Notifications />} />
                      <Route path="soon/:feature" element={<ComingSoon />} />
                      <Route path="settings" element={<SettingsHome />} />
                      <Route path="settings/profile" element={<Profile />} />
                      <Route path="settings/security" element={<SecuritySettings />} />
                      <Route path="settings/network" element={<NetworkSettings />} />
                      <Route path="settings/contacts" element={<Contacts />} />
                      <Route path="settings/security-log" element={<SecurityLog />} />
                    </Route>
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </SettingsProvider>
        </WalletProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
