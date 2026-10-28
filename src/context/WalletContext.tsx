import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HDAccount } from 'viem/accounts'
import { api } from '@/lib/api'
import {
  accountFromMnemonic,
  encryptMnemonic,
  loadKeystore,
  privateKeyOf,
  removeKeystore,
  saveKeystore,
  verifyPin,
  type KeystoreRecord,
} from '@/lib/keystore'
import type { KitAdapter } from '@/services/swap'
import { useAuth } from './AuthContext'

type WalletStatus = 'none' | 'locked' | 'unlocked'

interface WalletValue {
  status: WalletStatus
  /** Public address. Known even while locked. */
  address: `0x${string}` | null
  account: HDAccount | null
  create: (mnemonic: string, pin: string, source: 'created' | 'imported') => Promise<void>
  unlock: (pin: string) => Promise<void>
  lock: () => void
  /** Re-checks the PIN (with attempt limits) without changing lock state. Used to confirm every send, swap and bridge. */
  confirmPin: (pin: string) => Promise<void>
  changePin: (oldPin: string, newPin: string) => Promise<void>
  revealMnemonic: (pin: string) => Promise<string>
  /** Adapter for Circle App Kit built from the in-memory key. Cleared on lock. */
  getAdapter: () => Promise<KitAdapter>
  forgetWallet: () => void
}

const Ctx = createContext<WalletValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [version, setVersion] = useState(0)
  const [unlocked, setUnlocked] = useState<{ uid: string; account: HDAccount } | null>(null)
  const adapterRef = useRef<{ account: HDAccount; adapter: KitAdapter } | null>(null)
  const registered = useRef<string | null>(null)

  // The device keystore belongs to whoever is signed in. Keys are only ever held for that same user,
  // so signing out (or switching user) drops them from memory automatically.
  const record: KeystoreRecord | null = useMemo(() => (userId && version >= 0 ? loadKeystore(userId) : null), [userId, version])
  const account = unlocked && unlocked.uid === userId ? unlocked.account : null

  const address = (record?.address as `0x${string}` | undefined) ?? null

  // Tell the server about the public address (never the keys). Retries on the next mount if offline.
  useEffect(() => {
    if (!userId || !address || registered.current === `${userId}:${address}`) return
    api
      .addWallet(address)
      .then(() => {
        registered.current = `${userId}:${address}`
      })
      .catch(() => undefined)
  }, [userId, address])

  const lock = useCallback(() => {
    adapterRef.current = null
    setUnlocked(null)
  }, [])

  const create = useCallback(
    async (mnemonic: string, pin: string, source: 'created' | 'imported') => {
      if (!userId) throw new Error('Not signed in')
      const rec = await encryptMnemonic(mnemonic, pin)
      saveKeystore(userId, rec)
      setVersion((v) => v + 1)
      setUnlocked({ uid: userId, account: accountFromMnemonic(mnemonic) })
      await api.addWallet(rec.address).catch(() => undefined)
      registered.current = `${userId}:${rec.address}`
      void api.clientEvent(source === 'created' ? 'wallet_created' : 'wallet_imported').catch(() => undefined)
      void api.clientEvent('pin_set').catch(() => undefined)
    },
    [userId],
  )

  const unlock = useCallback(
    async (pin: string) => {
      if (!userId || !record) throw new Error('No wallet on this device')
      try {
        const phrase = await verifyPin(userId, record, pin)
        setUnlocked({ uid: userId, account: accountFromMnemonic(phrase) })
        void api.clientEvent('wallet_unlocked').catch(() => undefined)
      } catch (err) {
        if ((err as Error).name === 'WrongPinError') void api.clientEvent('pin_failed').catch(() => undefined)
        throw err
      }
    },
    [userId, record],
  )

  const confirmPin = useCallback(
    async (pin: string) => {
      if (!userId || !record) throw new Error('No wallet on this device')
      try {
        await verifyPin(userId, record, pin)
      } catch (err) {
        if ((err as Error).name === 'WrongPinError') void api.clientEvent('pin_failed').catch(() => undefined)
        throw err
      }
    },
    [userId, record],
  )

  const changePin = useCallback(
    async (oldPin: string, newPin: string) => {
      if (!userId || !record) throw new Error('No wallet on this device')
      const phrase = await verifyPin(userId, record, oldPin)
      const rec = await encryptMnemonic(phrase, newPin)
      saveKeystore(userId, rec)
      setVersion((v) => v + 1)
      void api.clientEvent('pin_changed').catch(() => undefined)
    },
    [userId, record],
  )

  const revealMnemonic = useCallback(
    async (pin: string) => {
      if (!userId || !record) throw new Error('No wallet on this device')
      const phrase = await verifyPin(userId, record, pin)
      void api.clientEvent('phrase_viewed').catch(() => undefined)
      return phrase
    },
    [userId, record],
  )

  const getAdapter = useCallback(async () => {
    if (!account) throw new Error('Wallet is locked')
    if (adapterRef.current?.account === account) return adapterRef.current.adapter
    const { createLocalAdapter } = await import('@/services/adapter')
    const adapter = createLocalAdapter(privateKeyOf(account))
    adapterRef.current = { account, adapter }
    return adapter
  }, [account])

  const forgetWallet = useCallback(() => {
    if (userId) removeKeystore(userId)
    adapterRef.current = null
    setUnlocked(null)
    setVersion((v) => v + 1)
  }, [userId])

  const status: WalletStatus = !record ? 'none' : account ? 'unlocked' : 'locked'

  const value = useMemo<WalletValue>(
    () => ({ status, address, account, create, unlock, lock, confirmPin, changePin, revealMnemonic, getAdapter, forgetWallet }),
    [status, address, account, create, unlock, lock, confirmPin, changePin, revealMnemonic, getAdapter, forgetWallet],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWallet(): WalletValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWallet must be used inside WalletProvider')
  return v
}
