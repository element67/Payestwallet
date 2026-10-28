import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { env, POLICY } from './env'

/* ---------------------------------------------------------------- hashing */

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Argon2id via Bun's native implementation. */
export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 })

export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash)

/** A real argon2id hash used to equalise timing when the account does not exist. */
export const DUMMY_HASH = await hashPassword(randomToken(24))

/* -------------------------------------------------------------------- JWT */

const ISSUER = 'payest-wallet'

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('access')
    .setIssuedAt()
    .setExpirationTime(`${POLICY.accessTtlSeconds}s`)
    .sign(env.jwtSecret)
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret, { issuer: ISSUER, audience: 'access', algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
    return { userId: payload.sub, sessionId: payload.sid }
  } catch {
    return null
  }
}

export async function signChallenge(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('2fa-challenge')
    .setIssuedAt()
    .setExpirationTime(`${POLICY.challengeTtlSeconds}s`)
    .sign(env.jwtSecret)
}

export async function verifyChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret, { issuer: ISSUER, audience: '2fa-challenge', algorithms: ['HS256'] })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

/* ------------------------------------------- AES-256-GCM for secrets at rest */

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', env.totpKey, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !enc) throw new Error('Malformed secret')
  const decipher = createDecipheriv('aes-256-gcm', env.totpKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

/* ------------------------------------------------------------- TOTP (RFC 6238) */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(str: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const bin =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!
  return String(bin % 1_000_000).padStart(6, '0')
}

/** Returns the matched time step (for replay protection) or null. Accepts +/- one step of clock drift. */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), lastStep?: number | null): number | null {
  const current = Math.floor(now / 1000 / 30)
  const given = Buffer.from(code)
  for (const delta of [0, -1, 1]) {
    const step = current + delta
    if (lastStep != null && step <= lastStep) continue
    const expected = Buffer.from(totpAt(secretB32, step))
    if (expected.length === given.length && timingSafeEqual(expected, given)) return step
  }
  return null
}

export const totpUri = (email: string, secret: string) =>
  `otpauth://totp/Payest%20Wallet:${encodeURIComponent(email)}?secret=${secret}&issuer=Payest%20Wallet&algorithm=SHA1&digits=6&period=30`
