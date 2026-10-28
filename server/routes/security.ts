import {
  clientSecurityEventSchema,
  paginationSchema,
  totpDisableSchema,
  totpEnableSchema,
  type SecurityEventDto,
  type SessionDto,
} from '../../shared/schemas'
import { findUserById, notify, protect, recordEvent, revokeFamily } from '../auth'
import { sql } from '../db'
import { ApiError, conflict, noContent, notFound, parseBody, parseQuery, LIMITS, unauthorized, type Router } from '../http'
import { decryptSecret, encryptSecret, newTotpSecret, totpUri, verifyPassword, verifyTotp } from '../security'
import { paged } from './account'

export function securityRoutes(r: Router) {
  r.add(
    'GET',
    '/security/events',
    protect(async (ctx) => {
      const q = parseQuery(ctx, paginationSchema)
      const total = ((await sql`select count(*)::int as n from security_events where user_id = ${ctx.user.id}`) as { n: number }[])[0]!.n
      const rows = (await sql`select id, type, ip, device_label, created_at from security_events where user_id = ${ctx.user.id}
        order by created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`) as {
        id: string
        type: string
        ip: string | null
        device_label: string | null
        created_at: Date
      }[]
      const data: SecurityEventDto[] = rows.map((e) => ({
        id: e.id,
        type: e.type,
        ip: e.ip,
        deviceLabel: e.device_label,
        createdAt: new Date(e.created_at).toISOString(),
      }))
      return paged(data, total, q.page, q.pageSize)
    }),
  )

  r.add(
    'POST',
    '/security/events',
    protect(async (ctx) => {
      const b = await parseBody(ctx, clientSecurityEventSchema)
      await recordEvent(ctx.user.id, b.type, ctx)
      if (b.type === 'pin_changed') await notify(ctx.user.id, 'security', 'Transaction PIN changed', 'The PIN on this device was changed.')
      if (b.type === 'phrase_viewed') await notify(ctx.user.id, 'security', 'Recovery phrase viewed', 'Your recovery phrase was displayed on this device.')
      return noContent()
    }),
    { name: 'client-events', max: 30, windowMs: 60_000 },
  )

  r.add(
    'GET',
    '/security/sessions',
    protect(async (ctx) => {
      const rows = (await sql`select family_id, device_label, ip, family_started_at, created_at from sessions
        where user_id = ${ctx.user.id} and revoked_at is null and expires_at > now() order by created_at desc limit 50`) as {
        family_id: string
        device_label: string
        ip: string | null
        family_started_at: Date
        created_at: Date
      }[]
      const data: SessionDto[] = rows.map((s) => ({
        id: s.family_id,
        deviceLabel: s.device_label,
        ip: s.ip,
        createdAt: new Date(s.family_started_at).toISOString(),
        lastUsedAt: new Date(s.created_at).toISOString(),
        current: s.family_id === ctx.user.sessionId,
      }))
      return { data }
    }),
  )

  r.add(
    'DELETE',
    '/security/sessions/:id',
    protect(async (ctx) => {
      const id = ctx.params.id!
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Session not found.')
      const own = (await sql`select 1 from sessions where family_id = ${id} and user_id = ${ctx.user.id} limit 1`) as unknown[]
      if (own.length === 0) throw notFound('Session not found.')
      await revokeFamily(id, 'revoked_by_user')
      await recordEvent(ctx.user.id, 'session_revoked', ctx)
      return noContent()
    }),
  )

  /* TOTP two-factor authentication */
  r.add(
    'POST',
    '/security/2fa/setup',
    protect(async (ctx) => {
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      if (user.totp_enabled) throw conflict('Two-factor authentication is already on.', 'TOTP_ALREADY_ENABLED')
      const secret = newTotpSecret()
      await sql`update users set totp_pending_enc = ${encryptSecret(secret)}, updated_at = now() where id = ${user.id}`
      return { secret, otpauthUri: totpUri(user.email, secret) }
    }),
    LIMITS.sensitive,
  )

  r.add(
    'POST',
    '/security/2fa/enable',
    protect(async (ctx) => {
      const b = await parseBody(ctx, totpEnableSchema)
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      if (user.totp_enabled) throw conflict('Two-factor authentication is already on.', 'TOTP_ALREADY_ENABLED')
      if (!user.totp_pending_enc) throw new ApiError(400, 'TOTP_NOT_STARTED', 'Start setup first.')
      const secret = decryptSecret(user.totp_pending_enc)
      const step = verifyTotp(secret, b.code)
      if (step === null) throw new ApiError(400, 'INVALID_CODE', 'That code is not correct. Check your authenticator app and try again.', { code: 'Incorrect code' })
      await sql`update users set totp_secret_enc = ${encryptSecret(secret)}, totp_pending_enc = null, totp_enabled = true, totp_last_step = ${step}, updated_at = now() where id = ${user.id}`
      await recordEvent(user.id, '2fa_enabled', ctx)
      await notify(user.id, 'security', 'Two-factor authentication on', 'Sign-in now needs a code from your authenticator app.')
      return { totpEnabled: true }
    }),
    LIMITS.sensitive,
  )

  r.add(
    'POST',
    '/security/2fa/disable',
    protect(async (ctx) => {
      const b = await parseBody(ctx, totpDisableSchema)
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      if (!user.totp_enabled || !user.totp_secret_enc) throw new ApiError(400, 'TOTP_NOT_ENABLED', 'Two-factor authentication is not on.')
      if (!(await verifyPassword(b.password, user.password_hash))) {
        throw new ApiError(400, 'INVALID_PASSWORD', 'Your password is not correct.', { password: 'Incorrect password' })
      }
      const last = user.totp_last_step == null ? null : Number(user.totp_last_step)
      if (verifyTotp(decryptSecret(user.totp_secret_enc), b.code, Date.now(), last) === null) {
        throw new ApiError(400, 'INVALID_CODE', 'That code is not correct or has expired.', { code: 'Incorrect code' })
      }
      await sql`update users set totp_enabled = false, totp_secret_enc = null, totp_pending_enc = null, totp_last_step = null, updated_at = now() where id = ${user.id}`
      await recordEvent(user.id, '2fa_disabled', ctx)
      await notify(user.id, 'security', 'Two-factor authentication off', 'Sign-in no longer needs an authenticator code.')
      return { totpEnabled: false }
    }),
    LIMITS.sensitive,
  )
}
