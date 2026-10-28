/** Server configuration. All secrets come from environment variables, never from source. */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example`)
  return value
}

const jwtSecret = required('JWT_ACCESS_SECRET')
if (jwtSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters')

/** 32 bytes, given as 64 hex characters or as base64 (what most hosts generate for secrets). */
function parseKey32(raw: string): Buffer {
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('TOTP_ENC_KEY must be 32 bytes, given as 64 hex characters or base64')
  return buf
}
const totpKey = parseKey32(required('TOTP_ENC_KEY'))

const isProduction = process.env.NODE_ENV === 'production'
const mailMode = (process.env.MAIL_MODE ?? 'mock') as 'mock' | 'resend'
if (mailMode !== 'mock' && mailMode !== 'resend') throw new Error('MAIL_MODE must be "mock" or "resend"')

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

if (isProduction) {
  if (mailMode === 'mock') {
    throw new Error('MAIL_MODE=mock hands password reset links to the caller and must never run in production. Use MAIL_MODE=resend.')
  }
  const bad = allowedOrigins.filter((o) => !/^https:\/\/[^/*]+$/.test(o) || /localhost|127\.0\.0\.1/.test(o))
  if (allowedOrigins.length === 0 || bad.length > 0) {
    throw new Error('In production ALLOWED_ORIGINS must list only exact https origins (for example https://your-app.netlify.app), no localhost and no wildcards')
  }
  if (!process.env.APP_URL) throw new Error('APP_URL (the public https URL of the frontend) is required in production for email links')
}
if (mailMode === 'resend' && (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)) {
  throw new Error('MAIL_MODE=resend requires RESEND_API_KEY and MAIL_FROM')
}

export const env = {
  /** Hosts such as Render and Railway inject PORT. API_PORT is for local use. */
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3001),
  host: process.env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1'),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: new TextEncoder().encode(jwtSecret),
  totpKey,
  allowedOrigins,
  appUrl: (process.env.APP_URL ?? allowedOrigins[0] ?? '').replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** How many proxies in front of the API append to X-Forwarded-For. */
  trustProxyHops: Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1),
  mailMode,
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  mailFrom: process.env.MAIL_FROM ?? '',
  isProduction,
} as const

/** Auth and session policy in one place. */
export const POLICY = {
  accessTtlSeconds: 15 * 60,
  refreshTtlMs: 7 * 24 * 60 * 60 * 1000,
  refreshAbsoluteMs: 30 * 24 * 60 * 60 * 1000,
  maxFailedLogins: 5,
  lockMinutes: 15,
  resetTokenTtlMs: 30 * 60 * 1000,
  challengeTtlSeconds: 5 * 60,
} as const
