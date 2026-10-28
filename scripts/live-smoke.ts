/**
 * Smoke test for a DEPLOYED API. It creates one throwaway user, exercises the public and protected
 * endpoints the way the frontend does, and always deletes the user again.
 *
 *   LIVE_API_URL=https://payest-api.onrender.com/api LIVE_APP_ORIGIN=https://your-app.netlify.app bun run test:live
 *
 * Nothing sensitive is printed: no passwords, no tokens, no emails.
 */
const API = (process.env.LIVE_API_URL ?? '').replace(/\/$/, '')
const ORIGIN = (process.env.LIVE_APP_ORIGIN ?? '').replace(/\/$/, '')
if (!API || !ORIGIN) {
  console.error('Set LIVE_API_URL (ending in /api) and LIVE_APP_ORIGIN (the Netlify URL).')
  process.exit(2)
}

let passed = 0
let failed = 0
const ok = (cond: boolean, name: string, extra?: unknown) => {
  if (cond) passed++
  else failed++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(extra ?? '')}`}`)
}

interface Res { status: number; body: Record<string, any> | null; headers: Headers }
async function call(method: string, path: string, opts: { token?: string; body?: unknown; origin?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(API + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(30_000) })
  let body: Record<string, any> | null = null
  try { body = (await res.json()) as Record<string, any> } catch { /* 204 */ }
  return { status: res.status, body, headers: res.headers }
}

const stamp = Date.now().toString(36)
const email = `smoke-${stamp}@payest-smoke.invalid`
const password = `Sm0ke!${crypto.randomUUID().slice(0, 12)}`
let token = ''

console.log(`Live smoke test against ${new URL(API).host}`)
const health = await call('GET', '/health')
ok(health.status === 200 && health.body?.status === 'ok', 'API and database answer /health', health.status)
const pre = await fetch(API + '/auth/register', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } })
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'preflight allows the Netlify origin', pre.status)
const evil = await call('GET', '/health', { origin: 'https://evil.example' })
ok(evil.status === 403, 'other origins are refused', evil.status)

try {
  const reg = await call('POST', '/auth/register', { body: { email, password, displayName: 'Smoke Test' } })
  ok(reg.status === 201 && Boolean(reg.body?.accessToken), 'register', reg.body?.error ?? reg.status)
  token = reg.body?.accessToken ?? ''
  const refresh1 = reg.body?.refreshToken as string
  ok((await call('GET', '/me')).status === 401, 'protected route without token is 401 with a message')
  ok((await call('GET', '/me', { token })).status === 200, 'profile with token')
  const login = await call('POST', '/auth/login', { body: { email, password } })
  ok(login.status === 200 && Boolean(login.body?.accessToken), 'login', login.body?.error ?? login.status)
  const rot = await call('POST', '/auth/refresh', { body: { refreshToken: refresh1 } })
  ok(rot.status === 200 && rot.body?.refreshToken !== refresh1, 'refresh rotates the token', rot.status)
  const addr = '0x' + 'ab'.repeat(20)
  const w = await call('POST', '/wallets', { token: rot.body?.accessToken, body: { address: addr } })
  ok(w.status === 201 || w.status === 200, 'wallet address saved', w.body?.error ?? w.status)
  const list = await call('GET', '/wallets', { token: rot.body?.accessToken })
  ok(list.status === 200 && list.body?.data?.length === 1, 'wallet listed', list.status)
  // Replaying an old refresh token must be refused, and it ends that whole session on purpose.
  ok((await call('POST', '/auth/refresh', { body: { refreshToken: refresh1 } })).status === 401, 'reused refresh token is rejected')
  const forgot = await call('POST', '/auth/forgot-password', { body: { email } })
  ok(forgot.status === 200 && !forgot.body?.mockEmail, 'forgot-password answers and does not leak the reset link')
  const second = await call('POST', '/auth/login', { body: { email, password } })
  token = second.body?.accessToken ?? ''
  ok((await call('POST', '/auth/logout', { token, body: { refreshToken: second.body?.refreshToken } })).status === 204, 'logout')
} finally {
  // Always remove the throwaway user.
  const relog = await call('POST', '/auth/login', { body: { email, password } })
  const del = relog.body?.accessToken ? await call('DELETE', '/me', { token: relog.body.accessToken, body: { password } }) : null
  ok(del?.status === 204, 'throwaway user deleted from the live database', del?.status ?? relog.status)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
