import { isAddress } from 'viem'
import { formatUnitsExact } from '@/onchain-money'

export const shortAddress = (a: string, head = 6, tail = 4) => (a.length > head + tail + 2 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a)

export function isValidAddress(a: string): boolean {
  const v = a.trim()
  return /^0x[0-9a-fA-F]{40}$/.test(v) && isAddress(v, { strict: true })
}

/** Truncates (never rounds up) to `maxFraction` digits and groups thousands. */
export function formatToken(raw: bigint, decimals: number, maxFraction = 2, minFraction = 2): string {
  const full = formatUnitsExact(raw, decimals)
  const [whole = '0', frac = ''] = full.split('.')
  let f = frac.slice(0, maxFraction)
  f = f.padEnd(minFraction, '0')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return f ? `${grouped}.${f}` : grouped
}

/** Shortest exact decimal string for an amount, suitable for inputs and APIs. */
export const toDecimalString = (raw: bigint, decimals: number) => formatUnitsExact(raw, decimals)

export function relativeTime(iso: string | number | Date): string {
  const t = new Date(iso).getTime()
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'Just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Accepts only plain decimals with at most `decimals` fraction digits. */
export function isValidAmountInput(v: string, decimals: number): boolean {
  if (!/^\d*\.?\d*$/.test(v)) return false
  const frac = v.split('.')[1]
  return !frac || frac.length <= decimals
}

export function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
