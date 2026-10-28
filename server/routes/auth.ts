import {
  changePasswordSchema,
  forgotSchema,
  login2faSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetSchema,
} from '../../shared/schemas'
import {
  authenticate,
  familyFromRefreshToken,
  findUserByEmail,
  findUserById,
  lockedError,
  notify,
  protect,
  recordEvent,
  revokeAllForUser,
  revokeFamily,
  rotateSession,
  startSession,
  type UserRow,
} from '../auth'
import { sql } from '../db'
import { env, POLICY } from '../env'
import { ApiError, conflict, created, hit, LIMITS, noContent, parseBody, unauthorized, type Ctx, type Router } from '../http'
import { mailer } from '../mail'
import {
  DUMMY_HASH,
  decryptSecret,
  hashPassword,
  randomToken,
  sha256Hex,
  signChallenge,
  verifyChallenge,
  verifyPassword,
  verifyTotp,
} from '../security'

const INVALID = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.')

/** Counts a failed attempt and locks the account (with escalating duration) after too many. */
async function registerFailure(user: UserRow, ctx: Ctx, reason: string) {
  const failures = user.failed_logins + 1
  await recordEvent(user.id, reason, ctx)
  if (failures >= POLICY.maxFailedLogins) {
    const minutes = Math.min(POLICY.lockMinutes * 2 ** user.lock_count, 24 * 60)
    const until = new Date(Date.now() + minutes * 60_000)
    await sql`update users set failed_logins = 0, lock_count = lock_count + 1, locked_until = ${until}, updated_at = now() where id = ${user.id}`
    await recordEvent(user.id, 'account_locked', ctx)
    await notify(user.id, 'security', 'Account locked', `Too many failed sign-in attempts. Your account is locked for ${minutes} minutes.`)
    throw lockedError(until)
  }
  await sql`update users set failed_logins = ${failures}, updated_at = now() where id = ${user.id}`
}

async function clearFailures(userId: string) {
  await sql`update users set failed_logins = 0, lock_count = 0, locked_until = null, updated_at = now() where id = ${userId}`
}

export function authRoutes(r: Router) {
  r.add(
    'POST',
    '/auth/register',
    async (ctx) => {
      const body = await parseBody(ctx, registerSchema)
      if (body.password.toLowerCase().includes(body.email.split('@')[0]!.toLowerCase()) && body.email.split('@')[0]!.length >= 4) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Password must not contain your email name.', { password: 'Password must not contain your email name.' })
      }
      if (await findUserByEmail(body.email)) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN')
      const hash = await hashPassword(body.password)
      let user: UserRow | undefined
      try {
        const rows = (await sql`insert into users (email, password_hash, display_name)
          values (${body.email}, ${hash}, ${body.displayName}) returning *`) as UserRow[]
        user = rows[0]
      } catch {
        throw conflict('An account with this email already exists.', 'EMAIL_TAKEN')
      }
      if (!user) throw new Error('Insert failed')
      await recordEvent(user.id, 'register', ctx)
      await notify(user.id, 'security', 'Welcome to Payest Wallet', 'Your account is ready. Set up your wallet and back up your recovery phrase.')
      return created(await startSession(user, ctx))
    },
    LIMITS.auth,
  )

  r.add(
    'POST',
    '/auth/login',
    async (ctx) => {
      const body = await parseBody(ctx, loginSchema)
      const wait = hit(`login-email:${body.email}`, 20, 15 * 60_000)
      if (wait) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.', undefined, { 'Retry-After': String(wait) })

      const user = await findUserByEmail(body.email)
      if (!user) {
        await verifyPassword(body.password, DUMMY_HASH)
        throw INVALID()
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw lockedError(new Date(user.locked_until))

      const ok = await verifyPassword(body.password, user.password_hash)
      if (!ok) {
        await registerFailure(user, ctx, 'login_failed')
        throw INVALID()
      }
      if (user.totp_enabled) {
        return { requires2fa: true, challenge: await signChallenge(user.id) }
      }
      await clearFailures(user.id)
      return startSession(user, ctx)
    },
    LIMITS.auth,
  )

  r.add(
    'POST',
    '/auth/login/2fa',
    async (ctx) => {
      const body = await parseBody(ctx, login2faSchema)
      const userId = await verifyChallenge(body.challenge)
      if (!userId) throw unauthorized('Your verification expired. Please sign in again.', 'CHALLENGE_EXPIRED')
      const user = await findUserById(userId)
      if (!user || !user.totp_enabled || !user.totp_secret_enc) throw unauthorized('Please sign in again.', 'CHALLENGE_EXPIRED')
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw lockedError(new Date(user.locked_until))

      const last = user.totp_last_step == null ? null : Number(user.totp_last_step)
      const step = verifyTotp(decryptSecret(user.totp_secret_enc), body.code, Date.now(), last)
      if (step === null) {
        await registerFailure(user, ctx, '2fa_failed')
        throw new ApiError(401, 'INVALID_CODE', 'That code is not correct or has expired.')
      }
      await sql`update users set totp_last_step = ${step} where id = ${user.id}`
      await clearFailures(user.id)
      return startSession(user, ctx)
    },
    LIMITS.auth,
  )

  r.add('POST', '/auth/refresh', async (ctx) => {
    const body = await parseBody(ctx, refreshSchema)
    return rotateSession(body.refreshToken, ctx)
  }, { name: 'refresh', max: 30, windowMs: 60_000 })

  r.add('POST', '/auth/logout', async (ctx) => {
    const body = await parseBody(ctx, logoutSchema)
    let familyId: string | undefined
    let userId: string | undefined
    try {
      await authenticate(ctx)
      familyId = ctx.user?.sessionId
      userId = ctx.user?.id
    } catch {
      if (body.refreshToken) {
        const found = await familyFromRefreshToken(body.refreshToken)
        familyId = found?.familyId
        userId = found?.userId
      }
    }
    if (familyId) await revokeFamily(familyId, 'logout')
    if (userId) await recordEvent(userId, 'logout', ctx)
    return noContent()
  })

  r.add(
    'POST',
    '/auth/forgot-password',
    async (ctx) => {
      const body = await parseBody(ctx, forgotSchema)
      const user = await findUserByEmail(body.email)
      const token = randomToken(32)
      if (user) {
        await sql`update password_resets set used_at = now() where user_id = ${user.id} and used_at is null`
        await sql`insert into password_resets (user_id, token_hash, expires_at)
          values (${user.id}, ${sha256Hex(token)}, ${new Date(Date.now() + POLICY.resetTokenTtlMs)})`
        await recordEvent(user.id, 'password_reset_requested', ctx)
      }
      // Identical response for known and unknown emails.
      const message = 'If an account exists for that email, a reset link is on its way.'
      if (mailer.mode === 'mock') {
        // Testnet development only: the "email" is handed back to the app. Refused in production at boot.
        const sent = await mailer.send({
          to: body.email,
          subject: 'Reset your Payest Wallet password',
          text: 'Use this link to choose a new password. It expires in 30 minutes. This is a testnet mock email.',
          link: `/reset-password?t=${token}`,
        })
        return { message, mockEmail: sent.preview }
      }
      if (user) {
        try {
          await mailer.send({
            to: body.email,
            subject: 'Reset your Payest Wallet password',
            text: `Use this link to choose a new password. It expires in 30 minutes.\n\n${env.appUrl}/reset-password?t=${token}\n\nIf you did not ask for this, ignore this email. Your wallet is not affected: its keys never leave your device.`,
          })
        } catch (err) {
          console.error(`[mail] reset email could not be delivered: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      }
      return { message }
    },
    LIMITS.sensitive,
  )

  r.add(
    'POST',
    '/auth/reset-password',
    async (ctx) => {
      const body = await parseBody(ctx, resetSchema)
      const rows = (await sql`select id, user_id from password_resets
        where token_hash = ${sha256Hex(body.token)} and used_at is null and expires_at > now()`) as { id: string; user_id: string }[]
      const reset = rows[0]
      if (!reset) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.')
      const hash = await hashPassword(body.password)
      await sql.begin(async (tx) => {
        const claimed = (await tx`update password_resets set used_at = now() where id = ${reset.id} and used_at is null returning id`) as unknown[]
        if (claimed.length === 0) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.')
        await tx`update users set password_hash = ${hash}, failed_logins = 0, lock_count = 0, locked_until = null, updated_at = now() where id = ${reset.user_id}`
      })
      await revokeAllForUser(reset.user_id, 'password_reset')
      await recordEvent(reset.user_id, 'password_reset', ctx)
      await notify(reset.user_id, 'security', 'Password reset', 'Your password was reset and all devices were signed out.')
      return { message: 'Password updated. You can sign in now.' }
    },
    LIMITS.sensitive,
  )

  r.add(
    'POST',
    '/auth/change-password',
    protect(async (ctx) => {
      const body = await parseBody(ctx, changePasswordSchema)
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
        await recordEvent(user.id, 'password_change_failed', ctx)
        throw new ApiError(400, 'INVALID_PASSWORD', 'Your current password is not correct.', { currentPassword: 'Incorrect password' })
      }
      if (body.currentPassword === body.newPassword) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a password you have not used.', { newPassword: 'Must be different' })
      }
      await sql`update users set password_hash = ${await hashPassword(body.newPassword)}, updated_at = now() where id = ${user.id}`
      await revokeAllForUser(user.id, 'password_changed', ctx.user.sessionId)
      await recordEvent(user.id, 'password_changed', ctx)
      await notify(user.id, 'security', 'Password changed', 'Your password was changed and other devices were signed out.')
      return { message: 'Password updated.' }
    }),
    LIMITS.sensitive,
  )
}
