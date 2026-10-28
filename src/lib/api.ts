import type {
  AuthSuccess,
  ContactDto,
  CreateTransactionInput,
  LoginResponse,
  NotificationDto,
  Paginated,
  PublicUser,
  SecurityEventDto,
  SessionDto,
  TransactionDto,
  WalletDto,
} from '../../shared/schemas'
import { API } from '@/config/app'

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/* ------------------------------------------------------------ token store */

const REFRESH_KEY = 'payest:rt'
let accessToken: string | null = null
let accessExpiresAt = 0
let refreshInFlight: Promise<boolean> | null = null

type Listener = () => void
const expiredListeners = new Set<Listener>()
/** Fires when the session can no longer be refreshed. */
export const onSessionExpired = (fn: Listener) => {
  expiredListeners.add(fn)
  return () => void expiredListeners.delete(fn)
}

export function setSession(auth: Pick<AuthSuccess, 'accessToken' | 'refreshToken' | 'expiresIn'>) {
  accessToken = auth.accessToken
  accessExpiresAt = Date.now() + auth.expiresIn * 1000
  sessionStorage.setItem(REFRESH_KEY, auth.refreshToken)
}

export function clearSession() {
  accessToken = null
  accessExpiresAt = 0
  sessionStorage.removeItem(REFRESH_KEY)
}

export const hasStoredSession = () => Boolean(sessionStorage.getItem(REFRESH_KEY))

/* ---------------------------------------------------------------- request */

interface Options {
  body?: unknown
  auth?: boolean
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
}

async function raw(method: string, path: string, opts: Options, token: string | null): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), API.timeoutMs)
  opts.signal?.addEventListener('abort', () => controller.abort())
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    return await fetch(`${API.baseUrl}${path}${qs === '?' ? '' : qs}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      credentials: 'omit',
    })
  } catch (err) {
    if (controller.signal.aborted && !(opts.signal?.aborted)) {
      throw new ApiClientError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.')
    }
    if (opts.signal?.aborted) throw err
    throw new ApiClientError(
      0,
      'NETWORK',
      navigator.onLine ? 'Cannot reach the server right now. Please try again.' : 'You appear to be offline. Check your connection.',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Explains a response that did not come from the Payest API (host login wall, wrong URL, proxy error). */
function describeForeignResponse(status: number): string {
  if (status === 401 || status === 403) {
    return `The server blocked this request (HTTP ${status}) before it reached the Payest API. Check that the site is not behind a login or access wall and that the API address is correct.`
  }
  if (status === 404 || status === 405 || (status >= 200 && status < 300)) {
    return `No Payest API was found at this address (HTTP ${status}). The API address for this deployment is probably not configured.`
  }
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return `The server is having a problem (HTTP ${status}). Please try again in a moment.`
  return `The server sent an unexpected response (HTTP ${status}). Please try again.`
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty or non JSON body */
  }
  const e = (data as { error?: { code?: string; message?: string; details?: Record<string, string> } } | null)?.error
  if (!res.ok) {
    // Only the Payest API produces { error: { code, message } }. Anything else came from a host or proxy.
    if (!e?.code) throw new ApiClientError(res.status, 'NOT_API', describeForeignResponse(res.status))
    throw new ApiClientError(res.status, e.code, e.message ?? 'Something went wrong. Please try again.', e.details)
  }
  if (data === null) throw new ApiClientError(res.status, 'NOT_API', describeForeignResponse(res.status))
  return data as T
}

/** Single-flight refresh so parallel requests share one rotation. */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  const refreshToken = sessionStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return Promise.resolve(false)
  refreshInFlight = (async () => {
    try {
      const res = await raw('POST', '/auth/refresh', { body: { refreshToken } }, null)
      const data = await parse<AuthSuccess>(res)
      setSession(data)
      return true
    } catch (err) {
      // Only a definite rejection ends the session. A flaky network keeps it.
      if (err instanceof ApiClientError && err.code !== 'NOT_API' && (err.status === 401 || err.status === 400)) {
        clearSession()
        expiredListeners.forEach((fn) => fn())
      }
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const auth = opts.auth !== false
  if (auth && accessToken && accessExpiresAt - Date.now() < 30_000) await refreshSession()
  let res = await raw(method, path, opts, auth ? accessToken : null)
  if (auth && res.status === 401) {
    const refreshed = await refreshSession()
    if (refreshed) res = await raw(method, path, opts, accessToken)
    else if (!hasStoredSession()) expiredListeners.forEach((fn) => fn())
  }
  return parse<T>(res)
}

/* --------------------------------------------------------------- endpoints */

export const api = {
  health: () => request<{ status: string }>('GET', '/health', { auth: false }),
  register: (b: { email: string; password: string; displayName: string }) => request<AuthSuccess>('POST', '/auth/register', { body: b, auth: false }),
  login: (b: { email: string; password: string }) => request<LoginResponse>('POST', '/auth/login', { body: b, auth: false }),
  login2fa: (b: { challenge: string; code: string }) => request<AuthSuccess>('POST', '/auth/login/2fa', { body: b, auth: false }),
  logout: () => request<void>('POST', '/auth/logout', { body: { refreshToken: sessionStorage.getItem(REFRESH_KEY) ?? undefined } }),
  forgotPassword: (email: string) =>
    request<{ message: string; mockEmail?: { to: string; subject: string; text: string; link?: string } }>('POST', '/auth/forgot-password', { body: { email }, auth: false }),
  resetPassword: (b: { token: string; password: string }) => request<{ message: string }>('POST', '/auth/reset-password', { body: b, auth: false }),
  changePassword: (b: { currentPassword: string; newPassword: string }) => request<{ message: string }>('POST', '/auth/change-password', { body: b }),

  me: () => request<{ user: PublicUser }>('GET', '/me'),
  updateMe: (b: { displayName?: string; hideBalancesDefault?: boolean; preferredChainId?: number }) => request<{ user: PublicUser }>('PATCH', '/me', { body: b }),

  wallets: () => request<Paginated<WalletDto>>('GET', '/wallets', { query: { pageSize: 50 } }),
  addWallet: (address: string) => request<WalletDto>('POST', '/wallets', { body: { address, label: 'Main wallet' } }),

  transactions: (q: { page?: number; pageSize?: number; type?: string; status?: string }) => request<Paginated<TransactionDto>>('GET', '/transactions', { query: q }),
  transaction: (id: string) => request<TransactionDto>('GET', `/transactions/${id}`),
  recordTransaction: (b: CreateTransactionInput) => request<TransactionDto>('POST', '/transactions', { body: b }),
  updateTransaction: (id: string, b: { status?: string; destTxHash?: string; toAmount?: string; fee?: string; error?: string }) =>
    request<TransactionDto>('PATCH', `/transactions/${id}`, { body: b }),

  notifications: (q: { page?: number; pageSize?: number; unreadOnly?: boolean }) =>
    request<Paginated<NotificationDto> & { unreadCount: number }>('GET', '/notifications', { query: q }),
  createNotification: (b: { type: string; title: string; body: string; txHash?: string; chainId?: number }) => request<{ ok: true }>('POST', '/notifications', { body: b }),
  markRead: (id: string) => request<NotificationDto>('POST', `/notifications/${id}/read`),
  markAllRead: () => request<void>('POST', '/notifications/read-all'),

  contacts: () => request<Paginated<ContactDto>>('GET', '/contacts', { query: { pageSize: 50 } }),
  addContact: (b: { name: string; address: string }) => request<ContactDto>('POST', '/contacts', { body: b }),
  editContact: (id: string, b: { name: string; address: string }) => request<ContactDto>('PATCH', `/contacts/${id}`, { body: b }),
  deleteContact: (id: string) => request<void>('DELETE', `/contacts/${id}`),

  securityEvents: (page = 1) => request<Paginated<SecurityEventDto>>('GET', '/security/events', { query: { page, pageSize: 20 } }),
  clientEvent: (type: string) => request<void>('POST', '/security/events', { body: { type } }),
  sessions: () => request<{ data: SessionDto[] }>('GET', '/security/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/security/sessions/${id}`),
  totpSetup: () => request<{ secret: string; otpauthUri: string }>('POST', '/security/2fa/setup'),
  totpEnable: (code: string) => request<{ totpEnabled: boolean }>('POST', '/security/2fa/enable', { body: { code } }),
  totpDisable: (b: { password: string; code: string }) => request<{ totpEnabled: boolean }>('POST', '/security/2fa/disable', { body: b }),
}
