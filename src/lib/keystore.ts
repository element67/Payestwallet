/**
 * Device-only encrypted keystore.
 * The recovery phrase is generated here, encrypted with a key derived from the PIN
 * (PBKDF2-SHA256, AES-256-GCM) and stored in localStorage. Nothing here is ever sent to the server.
 */
import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { bytesToHex, hexToBytes } from 'viem'
import { english, generateMnemonic, mnemonicToAccount, type HDAccount } from 'viem/accounts'
import { PIN_KDF_ITERATIONS, PIN_LENGTH, PIN_MAX_ATTEMPTS } from '@/config/app'

export interface KeystoreRecord {
  v: 1
  address: string
  salt: string
  iv: string
  ct: string
  iterations: number
}

export class WrongPinError extends Error {
  constructor() {
    super('Incorrect PIN')
    this.name = 'WrongPinError'
  }
}
export class PinLockedError extends Error {
  constructor(public until: number) {
    super('PIN entry is temporarily locked')
    this.name = 'PinLockedError'
  }
}

export const isValidPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)

/** Rejects trivially guessable PINs. */
export function pinWeakness(pin: string): string | null {
  if (!isValidPin(pin)) return `PIN must be exactly ${PIN_LENGTH} digits`
  if (/^(\d)\1+$/.test(pin)) return 'Do not repeat the same digit'
  const asc = '0123456789'
  if (asc.includes(pin) || [...asc].reverse().join('').includes(pin)) return 'Do not use a simple sequence'
  return null
}

export const normalizeMnemonic = (input: string) => input.trim().toLowerCase().replace(/\s+/g, ' ')
export const isValidMnemonic = (input: string) => validateMnemonic(normalizeMnemonic(input), wordlist)
export const newMnemonic = () => generateMnemonic(english, 128)

export function accountFromMnemonic(mnemonic: string): HDAccount {
  return mnemonicToAccount(normalizeMnemonic(mnemonic))
}

/** Private key as 0x hex, for SDK adapters that need one. Held in memory only. */
export function privateKeyOf(account: HDAccount): `0x${string}` {
  const key = account.getHdKey().privateKey
  if (!key) throw new Error('Wallet key unavailable')
  return bytesToHex(key)
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptMnemonic(mnemonic: string, pin: string, iterations = PIN_KDF_ITERATIONS): Promise<KeystoreRecord> {
  if (!isValidPin(pin)) throw new Error('Invalid PIN')
  const phrase = normalizeMnemonic(mnemonic)
  const account = accountFromMnemonic(phrase)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(pin, salt, iterations)
  const aad = hexToBytes(account.address)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    new TextEncoder().encode(phrase),
  )
  return { v: 1, address: account.address, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)), iterations }
}

/** Throws WrongPinError when the PIN does not decrypt the keystore. */
export async function decryptMnemonic(record: KeystoreRecord, pin: string): Promise<string> {
  const key = await deriveKey(pin, unb64(record.salt), record.iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(record.iv) as BufferSource, additionalData: hexToBytes(record.address as `0x${string}`) as BufferSource },
      key,
      unb64(record.ct),
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new WrongPinError()
  }
}

/* -------------------------------------------------------------- storage */

const ksKey = (userId: string) => `payest:keystore:${userId}`
const guardKey = (userId: string) => `payest:pin-guard:${userId}`

export function loadKeystore(userId: string): KeystoreRecord | null {
  try {
    const raw = localStorage.getItem(ksKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as KeystoreRecord
    return parsed.v === 1 && parsed.ct && parsed.salt && parsed.iv && parsed.address ? parsed : null
  } catch {
    return null
  }
}
export const saveKeystore = (userId: string, record: KeystoreRecord) => localStorage.setItem(ksKey(userId), JSON.stringify(record))
export const removeKeystore = (userId: string) => {
  localStorage.removeItem(ksKey(userId))
  localStorage.removeItem(guardKey(userId))
}

/* --------------------------------------------- PIN attempt rate limiting */

interface Guard {
  fails: number
  lockedUntil: number
  rounds: number
}
const readGuard = (userId: string): Guard => {
  try {
    return { fails: 0, lockedUntil: 0, rounds: 0, ...(JSON.parse(localStorage.getItem(guardKey(userId)) ?? '{}') as Partial<Guard>) }
  } catch {
    return { fails: 0, lockedUntil: 0, rounds: 0 }
  }
}
const writeGuard = (userId: string, g: Guard) => localStorage.setItem(guardKey(userId), JSON.stringify(g))

export function pinLockedUntil(userId: string): number {
  const g = readGuard(userId)
  return g.lockedUntil > Date.now() ? g.lockedUntil : 0
}

/** Checks the PIN against the keystore with escalating lockouts after repeated failures. */
export async function verifyPin(userId: string, record: KeystoreRecord, pin: string): Promise<string> {
  const g = readGuard(userId)
  if (g.lockedUntil > Date.now()) throw new PinLockedError(g.lockedUntil)
  try {
    const phrase = await decryptMnemonic(record, pin)
    writeGuard(userId, { fails: 0, lockedUntil: 0, rounds: 0 })
    return phrase
  } catch (err) {
    if (!(err instanceof WrongPinError)) throw err
    const fails = g.fails + 1
    if (fails >= PIN_MAX_ATTEMPTS) {
      const rounds = g.rounds + 1
      const lockedUntil = Date.now() + Math.min(30_000 * 2 ** (rounds - 1), 15 * 60_000)
      writeGuard(userId, { fails: 0, lockedUntil, rounds })
      throw new PinLockedError(lockedUntil)
    }
    writeGuard(userId, { ...g, fails })
    throw err
  }
}

export const attemptsLeft = (userId: string) => PIN_MAX_ATTEMPTS - readGuard(userId).fails

/** Picks three distinct word positions (0 based, ascending) for the backup quiz. */
export function pickQuizIndexes(wordCount: number): number[] {
  const picked = new Set<number>()
  const buf = new Uint32Array(8)
  while (picked.size < 3) {
    crypto.getRandomValues(buf)
    for (const n of buf) {
      if (picked.size < 3) picked.add(n % wordCount)
    }
  }
  return [...picked].sort((a, b) => a - b)
}
