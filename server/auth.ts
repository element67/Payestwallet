import type { AuthSuccess, PublicUser } from '../shared/schemas'
import { sql } from './db'
import { POLICY } from './env'
import { ApiError, deviceLabel, unauthorized, type Ctx, type Handler } from './http'
import { randomToken, sha256Hex, signAccessToken, verifyAccessToken } from './security'

export interface UserRow {
  id: string
  email: string
  password_hash: string
  display_name: string
  totp_secret_enc: string | null
  totp_pending_enc: string | null
  totp_enabled: boolean
  totp_last_step: string | number | null
  failed_logins: number
  lock_count: number
  locked_until: Date | null
  hide_balances_default: boolean
  preferred_chain_id: number | null
  created_at: Date
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    hideBalancesDefault: u.hide_balances_default,
    preferredChainId: u.preferred_chain_id,
    totpEnabled: u.totp_enabled,
    createdAt: new Date(u.created_at).toISOString(),
  }
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const rows = (await sql`select * from users where id = ${id}`) as UserRow[]
  return rows[0]
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = (await sql`select * from users where email = ${email}`) as UserRow[]
  return rows[0]
}

/* ------------------------------------------------- events and notifications */

export async function recordEvent(userId: string | null, type: string, ctx: Pick<Ctx, 'ip' | 'userAgent'>) {
  await sql`insert into security_events (user_id, type, ip, user_agent, device_label)
    values (${userId}, ${type}, ${ctx.ip}, ${ctx.userAgent}, ${deviceLabel(ctx.userAgent)})`
}

export async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  extra: { txHash?: string; chainId?: number } = {},
) {
  await sql`insert into notifications (user_id, type, title, body, tx_hash, chain_id)
    values (${userId}, ${type}, ${title}, ${body}, ${extra.txHash ?? null}, ${extra.chainId ?? null})`
}

/* ---------------------------------------------------------------- sessions */

function refreshExpiry(familyStartedAt: Date): Date {
  const idle = Date.now() + POLICY.refreshTtlMs
  const absolute = familyStartedAt.getTime() + POLICY.refreshAbsoluteMs
  return new Date(Math.min(idle, absolute))
}

async function insertSession(userId: string, familyId: string, familyStartedAt: Date, ctx: Ctx): Promise<string> {
  const refreshToken = randomToken(32)
  await sql`insert into sessions (user_id, family_id, refresh_hash, user_agent, device_label, ip, family_started_at, expires_at)
    values (${userId}, ${familyId}, ${sha256Hex(refreshToken)}, ${ctx.userAgent}, ${deviceLabel(ctx.userAgent)}, ${ctx.ip}, ${familyStartedAt}, ${refreshExpiry(familyStartedAt)})`
  return refreshToken
}

async function tokensFor(user: UserRow, familyId: string, refreshToken: string): Promise<AuthSuccess> {
  return {
    user: toPublicUser(user),
    accessToken: await signAccessToken(user.id, familyId),
    refreshToken,
    expiresIn: POLICY.accessTtlSeconds,
  }
}

/** Starts a brand-new login session and raises the login alerts. */
export async function startSession(user: UserRow, ctx: Ctx): Promise<AuthSuccess> {
  const label = deviceLabel(ctx.userAgent)
  const seen = (await sql`select 1 from sessions where user_id = ${user.id} and device_label = ${label} limit 1`) as unknown[]
  const familyId = crypto.randomUUID()
  const refreshToken = await insertSession(user.id, familyId, new Date(), ctx)
  await recordEvent(user.id, 'login', ctx)
  await notify(user.id, 'login', 'New sign-in', `Signed in on ${label}. If this was not you, change your password.`)
  if (seen.length === 0) {
    await recordEvent(user.id, 'new_device', ctx)
    await notify(user.id, 'security', 'New device', `A device you have not used before (${label}) signed in to your account.`)
  }
  return tokensFor(user, familyId, refreshToken)
}

interface SessionRow {
  id: string
  user_id: string
  family_id: string
  family_started_at: Date
  expires_at: Date
  revoked_at: Date | null
}

/** Rotates a refresh token. Presenting an already-used token revokes the whole family. */
export async function rotateSession(refreshToken: string, ctx: Ctx): Promise<AuthSuccess> {
  const hash = sha256Hex(refreshToken)
  const rows = (await sql`select * from sessions where refresh_hash = ${hash}`) as SessionRow[]
  const row = rows[0]
  if (!row) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED')

  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row.revoked_at) {
      await sql`update sessions set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'reuse_detected') where family_id = ${row.family_id}`
      await recordEvent(row.user_id, 'refresh_reuse_detected', ctx)
      await notify(row.user_id, 'security', 'Session closed', 'A previously used sign-in token was presented, so that session was closed for your safety.')
    }
    throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED')
  }

  // Atomically claim the token: only one concurrent caller can rotate it.
  const claimed = (await sql`update sessions set revoked_at = now(), revoked_reason = 'rotated'
    where id = ${row.id} and revoked_at is null returning id`) as unknown[]
  if (claimed.length === 0) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED')

  const user = await findUserById(row.user_id)
  if (!user) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED')
  const next = await insertSession(user.id, row.family_id, new Date(row.family_started_at), ctx)
  return tokensFor(user, row.family_id, next)
}

export async function revokeFamily(familyId: string, reason: string) {
  await sql`update sessions set revoked_at = now(), revoked_reason = ${reason} where family_id = ${familyId} and revoked_at is null`
}

export async function revokeAllForUser(userId: string, reason: string, exceptFamily?: string) {
  if (exceptFamily) {
    await sql`update sessions set revoked_at = now(), revoked_reason = ${reason}
      where user_id = ${userId} and revoked_at is null and family_id <> ${exceptFamily}`
  } else {
    await sql`update sessions set revoked_at = now(), revoked_reason = ${reason} where user_id = ${userId} and revoked_at is null`
  }
}

export async function familyFromRefreshToken(refreshToken: string): Promise<{ userId: string; familyId: string } | null> {
  const rows = (await sql`select user_id, family_id from sessions where refresh_hash = ${sha256Hex(refreshToken)}`) as { user_id: string; family_id: string }[]
  return rows[0] ? { userId: rows[0].user_id, familyId: rows[0].family_id } : null
}

/* ----------------------------------------------------------- authentication */

export async function authenticate(ctx: Ctx): Promise<void> {
  const header = ctx.req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/.exec(header)
  if (!match) throw unauthorized('Please sign in to continue.')
  const claims = await verifyAccessToken(match[1]!)
  if (!claims) throw unauthorized('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED')
  const live = (await sql`select 1 from sessions
    where family_id = ${claims.sessionId} and user_id = ${claims.userId} and revoked_at is null and expires_at > now() limit 1`) as unknown[]
  if (live.length === 0) throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED')
  ctx.user = { id: claims.userId, sessionId: claims.sessionId }
}

/** Wraps a handler so it only runs for an authenticated user. */
export const protect =
  (handler: (ctx: Ctx & { user: NonNullable<Ctx['user']> }) => Promise<unknown>): Handler =>
  async (ctx) => {
    await authenticate(ctx)
    return handler(ctx as Ctx & { user: NonNullable<Ctx['user']> })
  }

export function lockedError(until: Date): ApiError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000))
  return new ApiError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, undefined, {
    'Retry-After': String(minutes * 60),
  })
}
