/**
 * End-to-end API test. Run with the API server up:  bun run test:api
 * Uses unique accounts and unique X-Forwarded-For addresses so rate limits do not interfere.
 */
import { totpAt } from './security'

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3002'
const ORIGIN = 'http://localhost:5173'
let ipCounter = 10
let passed = 0
let failed = 0

const run = Date.now().toString(36)
const PW = 'Str0ng!Passw0rd'

function ok(cond: boolean, name: string, extra?: unknown) {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}`, extra ?? '')
  }
}

interface Res {
  status: number
  body: any
  headers: Headers
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string; origin?: string | null; raw?: string; type?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'X-Forwarded-For': opts.ip ?? `10.0.0.${ipCounter++}`, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537' }
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  let body: string | undefined
  if (opts.raw !== undefined) {
    body = opts.raw
    headers['Content-Type'] = opts.type ?? 'application/json'
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body })
  const text = await res.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, headers: res.headers }
}

async function register(tag: string) {
  const email = `${tag}-${run}@example.com`
  const res = await call('POST', '/auth/register', { body: { email, password: PW, displayName: `Tester ${tag}` } })
  return { email, ...res }
}

console.log('Health, headers, CORS, validation')
{
  const h = await call('GET', '/health')
  ok(h.status === 200 && h.body.status === 'ok', 'health ok')
  ok(h.headers.get('x-content-type-options') === 'nosniff', 'nosniff header')
  ok(h.headers.get('content-security-policy')?.includes("default-src 'none'") === true, 'CSP header')
  ok(h.headers.get('x-frame-options') === 'DENY', 'frame options header')
  ok(h.headers.get('cache-control') === 'no-store', 'no-store header')
  ok(h.headers.get('access-control-allow-origin') === ORIGIN, 'CORS echoes allowed origin')
  const bad = await call('GET', '/health', { origin: 'https://evil.example' })
  ok(bad.status === 403 && bad.body.error.code === 'CORS_FORBIDDEN', 'CORS blocks other origin')
  ok(!bad.headers.get('access-control-allow-origin'), 'no ACAO for blocked origin')
  const pre = await call('OPTIONS', '/auth/login')
  ok(pre.status === 204, 'preflight 204')
  const nf = await call('GET', '/nope')
  ok(nf.status === 404 && nf.body.error.code === 'NOT_FOUND' && nf.body.error.requestId, 'consistent 404 error format')
  const badType = await call('POST', '/auth/login', { raw: '{}', type: 'text/plain' })
  ok(badType.status === 415, 'wrong content type -> 415')
  const badJson = await call('POST', '/auth/login', { raw: '{nope' })
  ok(badJson.status === 400, 'invalid JSON -> 400')
  const big = await call('POST', '/auth/login', { raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(40_000) }) })
  ok(big.status === 413 || big.status === 400, 'oversized body rejected', big.status)
}

console.log('Registration validation')
{
  const weak = await call('POST', '/auth/register', { body: { email: `weak-${run}@example.com`, password: 'short', displayName: 'W' } })
  ok(weak.status === 400 && weak.body.error.details?.password, 'weak password rejected', weak.body)
  const noSymbol = await call('POST', '/auth/register', { body: { email: `weak2-${run}@example.com`, password: 'Abcdefghij1', displayName: 'W' } })
  ok(noSymbol.status === 400, 'password without symbol rejected')
  const badEmail = await call('POST', '/auth/register', { body: { email: 'not-an-email', password: PW, displayName: 'W' } })
  ok(badEmail.status === 400 && badEmail.body.error.details?.email, 'bad email rejected')
  const xss = await call('POST', '/auth/register', { body: { email: `xss-${run}@example.com`, password: PW, displayName: '<script>' } })
  ok(xss.status === 400, 'html in name rejected')
}

console.log('Register, login, profile')
const a = await register('alice')
ok(a.status === 201 && a.body.accessToken && a.body.refreshToken, 'register returns tokens', a.body)
ok(!JSON.stringify(a.body).includes('password'), 'no password data in response')
{
  const dup = await register('alice')
  ok(dup.status === 409 && dup.body.error.code === 'EMAIL_TAKEN', 'duplicate email -> 409')
  const noAuth = await call('GET', '/me')
  ok(noAuth.status === 401, 'profile requires auth')
  const garbage = await call('GET', '/me', { token: 'abc.def.ghi' })
  ok(garbage.status === 401, 'garbage token rejected')
  const me = await call('GET', '/me', { token: a.body.accessToken })
  ok(me.status === 200 && me.body.user.email === a.email, 'GET /me')
  const upd = await call('PATCH', '/me', { token: a.body.accessToken, body: { displayName: 'Alice A', hideBalancesDefault: true, preferredChainId: 5042002 } })
  ok(upd.status === 200 && upd.body.user.displayName === 'Alice A' && upd.body.user.hideBalancesDefault === true, 'PATCH /me')
  const emptyUpd = await call('PATCH', '/me', { token: a.body.accessToken, body: {} })
  ok(emptyUpd.status === 400, 'empty profile update rejected')
  const login = await call('POST', '/auth/login', { body: { email: a.email, password: PW } })
  ok(login.status === 200 && login.body.accessToken, 'login ok')
  const wrong = await call('POST', '/auth/login', { body: { email: a.email, password: 'Wrong!Passw0rd1' } })
  ok(wrong.status === 401 && wrong.body.error.code === 'INVALID_CREDENTIALS', 'wrong password -> 401')
  const ghost = await call('POST', '/auth/login', { body: { email: `ghost-${run}@example.com`, password: PW } })
  ok(ghost.status === 401 && ghost.body.error.message === wrong.body.error.message, 'unknown email gives identical error')
}

console.log('Refresh token rotation and reuse detection')
{
  const first = await call('POST', '/auth/login', { body: { email: a.email, password: PW } })
  const r1 = first.body.refreshToken as string
  const rotated = await call('POST', '/auth/refresh', { body: { refreshToken: r1 } })
  ok(rotated.status === 200 && rotated.body.refreshToken !== r1 && rotated.body.accessToken, 'refresh rotates token')
  const meNew = await call('GET', '/me', { token: rotated.body.accessToken })
  ok(meNew.status === 200, 'new access token works')
  const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: r1 } })
  ok(reuse.status === 401, 'reused refresh token rejected')
  const afterReuse = await call('POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } })
  ok(afterReuse.status === 401, 'reuse revokes the whole session family')
  const accessAfter = await call('GET', '/me', { token: rotated.body.accessToken })
  ok(accessAfter.status === 401, 'access token dies with revoked family')
  const bogus = await call('POST', '/auth/refresh', { body: { refreshToken: 'x'.repeat(43) } })
  ok(bogus.status === 401, 'unknown refresh token rejected')
}

console.log('Logout')
{
  const s = await call('POST', '/auth/login', { body: { email: a.email, password: PW } })
  const out = await call('POST', '/auth/logout', { token: s.body.accessToken, body: {} })
  ok(out.status === 204, 'logout 204')
  const after = await call('GET', '/me', { token: s.body.accessToken })
  ok(after.status === 401, 'access token unusable after logout')
  const ref = await call('POST', '/auth/refresh', { body: { refreshToken: s.body.refreshToken } })
  ok(ref.status === 401, 'refresh token unusable after logout')
}

console.log('Brute-force lockout')
{
  const b = await register('bob')
  const ip = '10.9.9.9'
  let last: Res | undefined
  for (let i = 0; i < 5; i++) last = await call('POST', '/auth/login', { ip, body: { email: b.email, password: 'Wrong!Passw0rd1' } })
  ok(last?.status === 423 && last.body.error.code === 'ACCOUNT_LOCKED', '5th failure locks account', last?.body)
  const correct = await call('POST', '/auth/login', { ip: '10.9.9.10', body: { email: b.email, password: PW } })
  ok(correct.status === 423, 'correct password refused while locked')
  const tok = await call('POST', '/auth/login', { ip: '10.9.9.11', body: { email: b.email, password: PW } })
  ok(tok.status === 423 && Number(tok.headers.get('retry-after')) > 0, 'Retry-After header present')
}

console.log('Password change and reset')
{
  const c = await register('carol')
  const s2 = await call('POST', '/auth/login', { body: { email: c.email, password: PW } })
  const wrong = await call('POST', '/auth/change-password', { token: c.body.accessToken, body: { currentPassword: 'Wrong!Passw0rd1', newPassword: 'N3w!Passw0rd42' } })
  ok(wrong.status === 400 && wrong.body.error.code === 'INVALID_PASSWORD', 'change password needs current password')
  const weak = await call('POST', '/auth/change-password', { token: c.body.accessToken, body: { currentPassword: PW, newPassword: 'weak' } })
  ok(weak.status === 400, 'change password enforces strength')
  const good = await call('POST', '/auth/change-password', { token: c.body.accessToken, body: { currentPassword: PW, newPassword: 'N3w!Passw0rd42' } })
  ok(good.status === 200, 'change password ok')
  const stillMe = await call('GET', '/me', { token: c.body.accessToken })
  ok(stillMe.status === 200, 'current session survives password change')
  const otherDead = await call('GET', '/me', { token: s2.body.accessToken })
  ok(otherDead.status === 401, 'other sessions revoked after password change')
  const oldLogin = await call('POST', '/auth/login', { body: { email: c.email, password: PW } })
  ok(oldLogin.status === 401, 'old password no longer works')

  const fp = await call('POST', '/auth/forgot-password', { body: { email: c.email } })
  ok(fp.status === 200 && fp.body.mockEmail?.link, 'forgot password returns mock email')
  const unknown = await call('POST', '/auth/forgot-password', { body: { email: `nobody-${run}@example.com` } })
  ok(unknown.status === 200 && unknown.body.message === fp.body.message && unknown.body.mockEmail?.link, 'unknown email gets same response shape')
  const token = new URL(fp.body.mockEmail.link, 'http://x').searchParams.get('t')!
  const fakeReset = await call('POST', '/auth/reset-password', { body: { token: 'z'.repeat(43), password: 'R3set!Passw0rd7' } })
  ok(fakeReset.status === 400, 'invalid reset token rejected')
  const weakReset = await call('POST', '/auth/reset-password', { body: { token, password: 'weak' } })
  ok(weakReset.status === 400, 'reset enforces strength')
  const reset = await call('POST', '/auth/reset-password', { body: { token, password: 'R3set!Passw0rd7' } })
  ok(reset.status === 200, 'reset ok')
  const reuse = await call('POST', '/auth/reset-password', { body: { token, password: 'An0ther!Passw0rd' } })
  ok(reuse.status === 400, 'reset token is single use')
  const dead = await call('GET', '/me', { token: c.body.accessToken })
  ok(dead.status === 401, 'reset signs out all devices')
  const login = await call('POST', '/auth/login', { body: { email: c.email, password: 'R3set!Passw0rd7' } })
  ok(login.status === 200, 'login with reset password')
}

console.log('Two-factor authentication (TOTP)')
{
  const d = await register('dave')
  const t = d.body.accessToken as string
  const setup = await call('POST', '/security/2fa/setup', { token: t })
  ok(setup.status === 200 && setup.body.secret && setup.body.otpauthUri.startsWith('otpauth://'), '2FA setup')
  const secret = setup.body.secret as string
  const badCode = await call('POST', '/security/2fa/enable', { token: t, body: { code: '000000' } })
  ok(badCode.status === 400, 'wrong code cannot enable 2FA')
  const step = Math.floor(Date.now() / 1000 / 30)
  const enable = await call('POST', '/security/2fa/enable', { token: t, body: { code: totpAt(secret, step - 1) } })
  ok(enable.status === 200 && enable.body.totpEnabled === true, '2FA enabled')
  const login = await call('POST', '/auth/login', { body: { email: d.email, password: PW } })
  ok(login.status === 200 && login.body.requires2fa === true && login.body.challenge && !login.body.accessToken, 'login requires 2FA')
  const wrong = await call('POST', '/auth/login/2fa', { body: { challenge: login.body.challenge, code: '123456' } })
  ok(wrong.status === 401, 'wrong 2FA code rejected')
  const replay = await call('POST', '/auth/login/2fa', { body: { challenge: login.body.challenge, code: totpAt(secret, step - 1) } })
  ok(replay.status === 401, 'TOTP code used at setup cannot be replayed')
  const next = await call('POST', '/auth/login/2fa', { body: { challenge: login.body.challenge, code: totpAt(secret, step) } })
  ok(next.status === 200 && next.body.accessToken, '2FA login succeeds with a fresh code', next.body)
  const fakeChallenge = await call('POST', '/auth/login/2fa', { body: { challenge: 'abc.def.ghi-padding', code: '123456' } })
  ok(fakeChallenge.status === 401, 'forged challenge rejected')
  const dis = await call('POST', '/security/2fa/disable', { token: next.body.accessToken, body: { password: PW, code: totpAt(secret, step + 1) } })
  ok(dis.status === 200 && dis.body.totpEnabled === false, '2FA disabled with password + code', dis.body)
}

console.log('Wallets, transactions, notifications, contacts, security log')
{
  const e = await register('erin')
  const f = await register('frank')
  const t = e.body.accessToken as string
  const addr = '0x' + 'ab'.repeat(20)
  const w = await call('POST', '/wallets', { token: t, body: { address: addr, label: 'Main' } })
  ok(w.status === 201 && w.body.address === addr, 'create wallet (address only)')
  const w2 = await call('POST', '/wallets', { token: t, body: { address: addr } })
  ok(w2.status === 200 && w2.body.id === w.body.id, 'wallet create is idempotent')
  const badW = await call('POST', '/wallets', { token: t, body: { address: '0x123' } })
  ok(badW.status === 400, 'invalid wallet address rejected')
  const leak = await call('POST', '/wallets', { token: t, body: { address: addr, privateKey: '0x1' } })
  ok(leak.status === 200 || leak.status === 201, 'unknown fields are ignored, never stored')
  const list = await call('GET', '/wallets', { token: t })
  ok(list.status === 200 && list.body.data.length === 1 && list.body.pagination.total === 1, 'list wallets paginated')

  const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
  const base = { walletAddress: addr, chainId: 5042002, type: 'send', status: 'pending', tokenSymbol: 'USDC', amount: '1.5', fromAddress: addr, toAddress: '0x' + 'cd'.repeat(20) }
  const tx1 = await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(1) } })
  ok(tx1.status === 201 && tx1.body.status === 'pending', 'create transaction')
  const dup = await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(1) } })
  ok(dup.status === 200 && dup.body.id === tx1.body.id, 'duplicate transaction is idempotent')
  for (let i = 2; i <= 5; i++) await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(i), type: i % 2 ? 'receive' : 'send', status: 'confirmed' } })
  const foreign = await call('POST', '/transactions', { token: f.body.accessToken, body: { ...base, txHash: hash(99) } })
  ok(foreign.status === 403, 'cannot record transactions for a wallet you do not own')
  const badTx = await call('POST', '/transactions', { token: t, body: { ...base, txHash: 'nope' } })
  ok(badTx.status === 400, 'invalid tx hash rejected')
  const badAmt = await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(7), amount: '-1' } })
  ok(badAmt.status === 400, 'negative amount rejected')
  const bridgeNoDest = await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(8), type: 'bridge' } })
  ok(bridgeNoDest.status === 400, 'bridge needs destination chain')
  const p1 = await call('GET', '/transactions?pageSize=2&page=1', { token: t })
  ok(p1.status === 200 && p1.body.data.length === 2 && p1.body.pagination.total === 5 && p1.body.pagination.totalPages === 3, 'pagination metadata')
  const sends = await call('GET', '/transactions?type=send', { token: t })
  ok(sends.body.data.every((x: any) => x.type === 'send') && sends.body.data.length === 3, 'filter by type')
  const pend = await call('GET', '/transactions?status=pending', { token: t })
  ok(pend.body.pagination.total === 1, 'filter by status')
  const badPage = await call('GET', '/transactions?pageSize=500', { token: t })
  ok(badPage.status === 400, 'page size capped')
  const patch = await call('PATCH', '/transactions/' + tx1.body.id, { token: t, body: { status: 'confirmed' } })
  ok(patch.status === 200 && patch.body.status === 'confirmed', 'pending -> confirmed')
  const patch2 = await call('PATCH', '/transactions/' + tx1.body.id, { token: t, body: { status: 'failed' } })
  ok(patch2.status === 409, 'final transaction cannot change')
  const txNotes = await call('GET', '/notifications?pageSize=50', { token: t })
  const titles: string[] = txNotes.body.data.map((n: any) => n.title)
  ok(titles.some((x) => x.startsWith('Received')), 'incoming transfer raises a received notification')
  ok(titles.some((x) => x.startsWith('Sent')), 'confirmed send raises a sent notification')
  const failedTx = await call('POST', '/transactions', { token: t, body: { ...base, txHash: hash(40), status: 'pending' } })
  await call('PATCH', '/transactions/' + failedTx.body.id, { token: t, body: { status: 'failed', error: 'Reverted' } })
  const afterFail = await call('GET', '/notifications?pageSize=50', { token: t })
  ok(afterFail.body.data.some((n: any) => n.type === 'failed'), 'failed transaction raises a failed notification')
  const others = await call('GET', '/transactions/' + tx1.body.id, { token: f.body.accessToken })
  ok(others.status === 404, 'other users cannot read my transaction')

  const n = await call('GET', '/notifications', { token: t })
  ok(n.status === 200 && n.body.unreadCount >= 2 && n.body.pagination.total >= 2, 'notifications list with unread count', n.body.unreadCount)
  const first = n.body.data[0]
  const read = await call('POST', `/notifications/${first.id}/read`, { token: t })
  ok(read.status === 200 && read.body.read === true, 'mark one read')
  const otherRead = await call('POST', `/notifications/${first.id}/read`, { token: f.body.accessToken })
  ok(otherRead.status === 404, 'cannot read others notification')
  const newN = await call('POST', '/notifications', { token: t, body: { type: 'received', title: 'Received 1 USDC', body: 'From 0xcd..cd' } })
  ok(newN.status === 201, 'create client notification')
  const secType = await call('POST', '/notifications', { token: t, body: { type: 'security', title: 'x', body: 'y' } })
  ok(secType.status === 400, 'clients cannot forge security notifications')
  const all = await call('POST', '/notifications/read-all', { token: t })
  ok(all.status === 204, 'mark all read')
  const n2 = await call('GET', '/notifications?unreadOnly=true', { token: t })
  ok(n2.body.unreadCount === 0 && n2.body.data.length === 0, 'unread count reaches zero')

  const c1 = await call('POST', '/contacts', { token: t, body: { name: 'Mum', address: '0x' + '11'.repeat(20) } })
  ok(c1.status === 201, 'create contact')
  const c1dup = await call('POST', '/contacts', { token: t, body: { name: 'Mum 2', address: '0x' + '11'.repeat(20) } })
  ok(c1dup.status === 409, 'duplicate contact address -> 409')
  const c1bad = await call('POST', '/contacts', { token: t, body: { name: 'Bad', address: 'abc' } })
  ok(c1bad.status === 400, 'invalid contact address rejected')
  const c1up = await call('PATCH', '/contacts/' + c1.body.id, { token: t, body: { name: 'Mother', address: '0x' + '22'.repeat(20) } })
  ok(c1up.status === 200 && c1up.body.name === 'Mother', 'edit contact')
  const c1other = await call('DELETE', '/contacts/' + c1.body.id, { token: f.body.accessToken })
  ok(c1other.status === 404, 'cannot delete others contact')
  const c1del = await call('DELETE', '/contacts/' + c1.body.id, { token: t })
  ok(c1del.status === 204, 'delete contact')
  const cl = await call('GET', '/contacts', { token: t })
  ok(cl.body.data.length === 0, 'contact list empty after delete')

  const ev = await call('GET', '/security/events', { token: t })
  ok(ev.status === 200 && ev.body.data.some((x: any) => x.type === 'login') && ev.body.data.some((x: any) => x.type === 'register'), 'security log lists logins')
  const se = await call('POST', '/security/events', { token: t, body: { type: 'pin_changed' } })
  ok(se.status === 204, 'client security event accepted')
  const seBad = await call('POST', '/security/events', { token: t, body: { type: 'login' } })
  ok(seBad.status === 400, 'clients cannot forge login events')
  const sess = await call('GET', '/security/sessions', { token: t })
  ok(sess.status === 200 && sess.body.data.length >= 1 && sess.body.data[0].current === true, 'sessions list with current device', sess.body)
  const other = await call('POST', '/auth/login', { body: { email: e.email, password: PW } })
  const sess2 = await call('GET', '/security/sessions', { token: t })
  const victim = sess2.body.data.find((s: any) => !s.current)
  ok(Boolean(victim), 'second device listed')
  const rev = await call('DELETE', '/security/sessions/' + victim.id, { token: t })
  ok(rev.status === 204, 'revoke other device')
  const deadTok = await call('GET', '/me', { token: other.body.accessToken })
  ok(deadTok.status === 401, 'revoked device is signed out')
}

console.log('Public vs protected routes, preflight, account deletion')
{
  const pre = await call('OPTIONS', '/auth/register')
  ok(pre.status === 204 && (pre.headers.get('access-control-allow-headers') ?? '').includes('Authorization'), 'preflight allows Authorization and Content-Type')
  ok((pre.headers.get('access-control-allow-methods') ?? '').includes('DELETE'), 'preflight allows DELETE')
  ok(pre.headers.get('cross-origin-resource-policy') === 'cross-origin', 'CORP does not block a cross-site frontend')
  const publicRoutes: [string, string, unknown][] = [
    ['POST', '/auth/register', {}],
    ['POST', '/auth/login', {}],
    ['POST', '/auth/refresh', {}],
    ['POST', '/auth/forgot-password', {}],
    ['POST', '/auth/reset-password', {}],
  ]
  for (const [m, path, body] of publicRoutes) {
    const r = await call(m, path, { body, ip: '10.88.1.' + ++ipCounter })
    ok(r.status !== 401 && r.status !== 403, `${path} is public (got ${r.status})`)
  }
  const protectedRoutes: [string, string][] = [
    ['GET', '/me'], ['PATCH', '/me'], ['DELETE', '/me'], ['GET', '/wallets'], ['POST', '/wallets'],
    ['GET', '/transactions'], ['POST', '/transactions'], ['GET', '/notifications'], ['GET', '/contacts'],
    ['GET', '/security/events'], ['GET', '/security/sessions'], ['POST', '/auth/change-password'],
  ]
  for (const [m, path] of protectedRoutes) {
    const r = await call(m, path, { body: m === 'GET' ? undefined : {}, ip: '10.88.2.' + ++ipCounter })
    ok(r.status === 401 && r.body?.error?.code && r.body?.error?.message, `${m} ${path} requires a token and says why`, r.body)
  }
  const d = await register('del')
  const t = d.body.accessToken as string
  const bad = await call('DELETE', '/me', { token: t, body: { password: 'Wrong!Passw0rd1' } })
  ok(bad.status === 400 && bad.body.error.code === 'INVALID_PASSWORD', 'account deletion needs the right password')
  const del = await call('DELETE', '/me', { token: t, body: { password: PW } })
  ok(del.status === 204, 'account deletion succeeds')
  ok((await call('GET', '/me', { token: t })).status === 401, 'deleted account token is dead')
  const again = await call('POST', '/auth/login', { body: { email: d.email, password: PW }, ip: '10.88.3.' + ++ipCounter })
  ok(again.status === 401, 'deleted account cannot sign in')
}

console.log('Rate limiting')
{
  const ip = '10.77.7.7'
  const codes: number[] = []
  for (let i = 0; i < 16; i++) codes.push((await call('POST', '/auth/login', { ip, body: { email: `rl${i}-${run}@example.com`, password: PW } })).status)
  ok(codes.includes(429), 'login endpoint is rate limited', codes.join(','))
  const lim = await call('POST', '/auth/login', { ip, body: { email: `rlx-${run}@example.com`, password: PW } })
  ok(lim.status === 429 && Number(lim.headers.get('retry-after')) > 0, '429 carries Retry-After')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
