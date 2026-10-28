import { z } from 'zod'
import { env } from './env'

/* ------------------------------------------------------------------ errors */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
    public headers?: Record<string, string>,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: Record<string, string>) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details)
export const unauthorized = (message = 'Please sign in again.', code = 'UNAUTHORIZED') => new ApiError(401, code, message)
export const forbidden = (message = 'You do not have access to this.') => new ApiError(403, 'FORBIDDEN', message)
export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message)
export const conflict = (message: string, code = 'CONFLICT') => new ApiError(409, code, message)

/* ----------------------------------------------------------------- context */

export interface AuthUser {
  id: string
  sessionId: string
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  ip: string
  requestId: string
  userAgent: string
  user?: AuthUser
}

export type Handler = (ctx: Ctx) => Promise<unknown>

export interface Result {
  status: number
  body: unknown
}
export const created = (body: unknown): Result => ({ status: 201, body })
export const noContent = (): Result => ({ status: 204, body: null })

const MAX_BODY_BYTES = 16 * 1024

function zodDetails(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in details)) details[key] = issue.message
  }
  return details
}

export async function parseBody<S extends z.ZodType>(ctx: Ctx, schema: S): Promise<z.output<S>> {
  const type = ctx.req.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json.')
  }
  const text = await ctx.req.text()
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw badRequest('Request body is not valid JSON.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const details = zodDetails(parsed.error)
    throw badRequest(Object.values(details)[0] ?? 'Invalid request.', details)
  }
  return parsed.data
}

export function parseQuery<S extends z.ZodType>(ctx: Ctx, schema: S): z.output<S> {
  const raw: Record<string, string> = {}
  ctx.url.searchParams.forEach((v, k) => {
    raw[k] = v
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const details = zodDetails(parsed.error)
    throw badRequest(Object.values(details)[0] ?? 'Invalid query.', details)
  }
  return parsed.data
}

/* ------------------------------------------------------------ rate limiting */

interface Bucket {
  hits: number[]
}
const buckets = new Map<string, Bucket>()

/** Sliding window limiter. Returns seconds until retry when the limit is exceeded. */
export function hit(key: string, max: number, windowMs: number): number {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { hits: [] }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs)
  if (bucket.hits.length >= max) {
    buckets.set(key, bucket)
    return Math.max(1, Math.ceil((windowMs - (now - bucket.hits[0]!)) / 1000))
  }
  bucket.hits.push(now)
  buckets.set(key, bucket)
  return 0
}

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < 15 * 60 * 1000)
    if (bucket.hits.length === 0) buckets.delete(key)
  }
}, 60_000).unref()

export interface RateRule {
  name: string
  max: number
  windowMs: number
}

export const LIMITS = {
  global: { name: 'global', max: 240, windowMs: 60_000 },
  auth: { name: 'auth', max: 12, windowMs: 60_000 },
  sensitive: { name: 'sensitive', max: 8, windowMs: 60_000 },
} satisfies Record<string, RateRule>

/* ------------------------------------------------------------------ router */

interface Route {
  method: string
  pattern: string[]
  handler: Handler
  limit?: RateRule
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, handler: Handler, limit?: RateRule) {
    this.routes.push({ method, pattern: path.split('/').filter(Boolean), handler, limit })
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const parts = pathname.split('/').filter(Boolean)
    let pathMatched = false
    for (const route of this.routes) {
      if (route.pattern.length !== parts.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < parts.length; i++) {
        const p = route.pattern[i]!
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]!)
        else if (p !== parts[i]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      pathMatched = true
      if (route.method === method) return { route, params }
    }
    return pathMatched ? 'method' : null
  }
}

/* ----------------------------------------------------------- headers, CORS */

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '600',
  }
}

export function clientIp(req: Request, socketIp: string | undefined): string {
  if (env.trustProxy) {
    // Entries are appended left to right by each proxy. Only the entries added by OUR trusted proxies
    // (the last `trustProxyHops`) can be believed. Everything to their left is client-controlled.
    const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const picked = parts.at(-env.trustProxyHops)
    if (picked && /^[0-9a-fA-F:.]{3,45}$/.test(picked)) return picked
  }
  return socketIp ?? 'unknown'
}

export function deviceLabel(userAgent: string): string {
  const ua = userAgent || ''
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iOS/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS'
  return `${browser} on ${os}`
}

/* ------------------------------------------------------------------ server */

function respond(ctx: { requestId: string }, origin: string | null, status: number, body: unknown, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    ...corsHeaders(origin),
    'X-Request-Id': ctx.requestId,
    ...extra,
  }
  if (body === null || status === 204) return new Response(null, { status, headers })
  headers['Content-Type'] = 'application/json; charset=utf-8'
  return new Response(JSON.stringify(body), { status, headers })
}

export function createFetchHandler(router: Router) {
  return async (req: Request, socketIp: string | undefined): Promise<Response> => {
    const started = performance.now()
    const url = new URL(req.url)
    const requestId = crypto.randomUUID()
    const origin = req.headers.get('origin')
    const ip = clientIp(req, socketIp)
    const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 300)
    let status = 500
    let res: Response

    try {
      if (origin && !env.allowedOrigins.includes(origin)) {
        throw new ApiError(403, 'CORS_FORBIDDEN', 'This origin is not allowed to use the API.')
      }
      if (req.method === 'OPTIONS') {
        res = respond({ requestId }, origin, 204, null)
        status = 204
      } else {
        const wait = hit(`g:${ip}`, LIMITS.global.max, LIMITS.global.windowMs)
        if (wait) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Slow down and try again shortly.', undefined, { 'Retry-After': String(wait) })

        const apiPath = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
        const matched = router.match(req.method, apiPath)
        if (!matched) throw notFound('Route not found.')
        if (matched === 'method') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
        const { route, params } = matched
        if (route.limit) {
          const w = hit(`${route.limit.name}:${ip}`, route.limit.max, route.limit.windowMs)
          if (w) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', undefined, { 'Retry-After': String(w) })
        }
        const ctx: Ctx = { req, url, params, ip, requestId, userAgent }
        const out = await route.handler(ctx)
        const result: Result = isResult(out) ? out : { status: 200, body: out }
        status = result.status
        res = respond(ctx, origin, result.status, result.body)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        status = err.status
        const body = { error: { code: err.code, message: err.message, details: err.details, requestId } }
        res = respond({ requestId }, origin && env.allowedOrigins.includes(origin) ? origin : null, err.status, body, err.headers)
      } else {
        status = 500
        // Log only the error class and message. Never request data.
        console.error(`[${requestId}] unhandled`, err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
        const body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', requestId } }
        res = respond({ requestId }, origin && env.allowedOrigins.includes(origin) ? origin : null, 500, body)
      }
    }

    // Request log: method, path (no query string), status, duration. No bodies, headers, tokens or IPs.
    console.log(`${new Date().toISOString()} ${requestId.slice(0, 8)} ${req.method} ${url.pathname} ${status} ${Math.round(performance.now() - started)}ms`)
    return res
  }
}

function isResult(v: unknown): v is Result {
  return typeof v === 'object' && v !== null && 'status' in v && 'body' in v && Object.keys(v).length === 2
}
