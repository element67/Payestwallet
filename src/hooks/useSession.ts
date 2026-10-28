import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { TIMING } from '@/config/app'
import { useAuth } from '@/context/AuthContext'
import { useWallet } from '@/context/WalletContext'
import { api } from '@/lib/api'

let holds = 0

/** While `active` is true (a payment is in flight) the wallet is not auto-locked or signed out. */
export function useSessionHold(active: boolean) {
  useEffect(() => {
    if (!active) return
    holds += 1
    return () => {
      holds -= 1
    }
  }, [active])
}

const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'visibilitychange'] as const

/**
 * Locks the wallet after a short idle period and signs the user out after a longer one.
 * Time is measured from the wall clock so a sleeping laptop is handled correctly.
 */
export function useInactivity() {
  const { logout, status } = useAuth()
  const { status: walletStatus, lock } = useWallet()
  const last = useRef(0)

  // A fresh sign-in starts a fresh idle clock. Locking the wallet must not restart it.
  useEffect(() => {
    last.current = Date.now()
  }, [status])

  useEffect(() => {
    if (status !== 'authenticated') return
    const touch = () => {
      last.current = Date.now()
    }
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const tick = setInterval(() => {
      if (holds > 0) {
        last.current = Date.now()
        return
      }
      const idle = Date.now() - last.current
      if (idle >= TIMING.autoLogoutMs) {
        lock()
        void logout('You were signed out after 15 minutes of inactivity.')
      } else if (idle >= TIMING.autoLockMs && walletStatus === 'unlocked') {
        lock()
      }
    }, 5_000)
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch))
      clearInterval(tick)
    }
  }, [status, walletStatus, lock, logout])
}

export function useUnreadCount() {
  const { status } = useAuth()
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    enabled: status === 'authenticated',
    refetchInterval: TIMING.notificationPollMs,
    retry: 0,
    queryFn: async () => (await api.notifications({ pageSize: 1, unreadOnly: true })).unreadCount,
  })
  return q.data ?? 0
}
