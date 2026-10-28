import { ApiClientError } from './api'
import { PinLockedError } from './keystore'

export class TimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`)
    this.name = 'TimeoutError'
  }
}

/** Rejects if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

export const isUserRejection = (err: unknown) => {
  const m = String((err as { message?: string })?.message ?? '').toLowerCase()
  return m.includes('user rejected') || m.includes('user denied')
}

/** Turns any thrown value into one clear sentence a user can act on. Never exposes raw RPC dumps. */
export function describeError(err: unknown): string {
  if (err instanceof ApiClientError) return err.message
  if (err instanceof PinLockedError) {
    const s = Math.max(1, Math.ceil((err.until - Date.now()) / 1000))
    return `Too many wrong PINs. Try again in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`}.`
  }
  if (err instanceof TimeoutError) return 'The network took too long to respond. Check your connection and try again.'
  const e = err as { shortMessage?: string; message?: string; name?: string; details?: string }
  const text = `${e?.shortMessage ?? ''} ${e?.details ?? ''} ${e?.message ?? ''}`.toLowerCase()
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You appear to be offline. Check your connection and try again.'
  if (text.includes('insufficient funds') || text.includes('exceeds the balance') || text.includes('exceeds balance') || text.includes('insufficient balance'))
    return 'Not enough balance to cover the amount and the network fee.'
  if (text.includes('nonce too low') || text.includes('already known')) return 'Another transaction is still being processed. Wait a moment and try again.'
  if (text.includes('replacement transaction underpriced') || text.includes('underpriced')) return 'The network fee was too low. Please try again.'
  if (text.includes('execution reverted') || text.includes('reverted')) return 'The transaction was rejected by the network. No funds moved.'
  if (text.includes('timeout') || text.includes('timed out') || text.includes('http request failed') || text.includes('fetch failed') || text.includes('failed to fetch'))
    return 'Cannot reach the network right now. Check your connection and try again.'
  if (text.includes('rate limit') || text.includes('429')) return 'The network is busy. Please wait a few seconds and try again.'
  return 'Something went wrong. Please try again.'
}
