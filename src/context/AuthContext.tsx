import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthSuccess, PublicUser } from '../../shared/schemas'
import { api, clearSession, hasStoredSession, onSessionExpired, refreshSession, setSession } from '@/lib/api'

type Status = 'booting' | 'anonymous' | 'authenticated'

export type LoginResult = { kind: 'ok' } | { kind: '2fa'; challenge: string }

interface AuthValue {
  status: Status
  user: PublicUser | null
  /** Why the user was signed out (inactivity, expiry). Cleared after it is shown. */
  notice: string | null
  clearNotice: () => void
  login: (email: string, password: string) => Promise<LoginResult>
  login2fa: (challenge: string, code: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: (reason?: string) => Promise<void>
  setUser: (user: PublicUser) => void
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('booting')
  const [user, setUserState] = useState<PublicUser | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loggingOut = useRef(false)

  const applyAuth = useCallback((auth: AuthSuccess) => {
    setSession(auth)
    setUserState(auth.user)
    setStatus('authenticated')
  }, [])

  // Restore a session that survived a page reload (refresh token lives in sessionStorage).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!hasStoredSession()) return setStatus('anonymous')
      const ok = await refreshSession()
      if (cancelled) return
      if (!ok) return setStatus('anonymous')
      try {
        const { user: me } = await api.me()
        if (cancelled) return
        setUserState(me)
        setStatus('authenticated')
      } catch {
        clearSession()
        if (!cancelled) setStatus('anonymous')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      onSessionExpired(() => {
        if (loggingOut.current) return
        setUserState(null)
        setStatus('anonymous')
        setNotice('Your session expired. Please sign in again.')
      }),
    [],
  )

  const logout = useCallback(async (reason?: string) => {
    loggingOut.current = true
    try {
      await api.logout().catch(() => undefined)
    } finally {
      clearSession()
      setUserState(null)
      setStatus('anonymous')
      if (reason) setNotice(reason)
      loggingOut.current = false
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      notice,
      clearNotice: () => setNotice(null),
      login: async (email, password) => {
        const res = await api.login({ email, password })
        if ('requires2fa' in res) return { kind: '2fa', challenge: res.challenge }
        applyAuth(res)
        return { kind: 'ok' }
      },
      login2fa: async (challenge, code) => applyAuth(await api.login2fa({ challenge, code })),
      register: async (email, password, displayName) => applyAuth(await api.register({ email, password, displayName })),
      logout,
      setUser: setUserState,
    }),
    [status, user, notice, applyAuth, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export function useUser(): PublicUser {
  const { user } = useAuth()
  if (!user) throw new Error('No signed-in user')
  return user
}
