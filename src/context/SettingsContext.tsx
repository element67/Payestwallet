import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_CHAIN_ID, findChainConfig, getChainConfig, type ChainConfig } from '@/config/app'
import { api } from '@/lib/api'
import { useAuth } from './AuthContext'

interface SettingsValue {
  chain: ChainConfig
  setChainId: (id: number) => void
  hideBalances: boolean
  setHideBalances: (v: boolean) => void
}

const Ctx = createContext<SettingsValue | null>(null)
const CHAIN_KEY = 'payest:chain'
const HIDE_KEY = 'payest:hide'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth()
  const [chainId, setChainState] = useState<number>(() => {
    const stored = Number(localStorage.getItem(CHAIN_KEY))
    return findChainConfig(stored) ? stored : (findChainConfig(user?.preferredChainId)?.id ?? DEFAULT_CHAIN_ID)
  })
  const [hideOverride, setHideOverride] = useState<boolean | null>(() => {
    const v = sessionStorage.getItem(HIDE_KEY)
    return v === null ? null : v === '1'
  })

  const setChainId = useCallback(
    (id: number) => {
      if (!findChainConfig(id)) return
      setChainState(id)
      localStorage.setItem(CHAIN_KEY, String(id))
      api
        .updateMe({ preferredChainId: id })
        .then((r) => setUser(r.user))
        .catch(() => undefined)
    },
    [setUser],
  )

  const setHideBalances = useCallback((v: boolean) => {
    setHideOverride(v)
    sessionStorage.setItem(HIDE_KEY, v ? '1' : '0')
  }, [])

  const value = useMemo<SettingsValue>(
    () => ({
      chain: getChainConfig(chainId),
      setChainId,
      hideBalances: hideOverride ?? user?.hideBalancesDefault ?? false,
      setHideBalances,
    }),
    [chainId, setChainId, hideOverride, user?.hideBalancesDefault, setHideBalances],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings must be used inside SettingsProvider')
  return v
}
