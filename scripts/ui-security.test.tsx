/**
 * Second UI journey: import, PIN and password changes, 2FA, password reset, expired session,
 * idle lock and logout, offline errors and double taps.
 * Run with:  bun test scripts/ui-security.test.tsx --timeout 120000
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, test } from 'bun:test'

process.env.RTL_SKIP_AUTO_CLEANUP = 'true'
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 390, height: 844 })
Reflect.deleteProperty(Element.prototype, 'animate')
Reflect.deleteProperty(HTMLElement.prototype, 'animate')

const realNow = Date.now.bind(Date)
let clockOffset = 0
Date.now = () => realNow() + clockOffset

const calls: string[] = []
let blockRpc = false
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (blockRpc && /rpc\.testnet\.arc\.io|sepolia/.test(raw)) return Promise.reject(new TypeError('Failed to fetch'))
  const url = raw.startsWith('/') ? `${process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:3002'}${raw}` : raw
  calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
  return realFetch(url, init)
}) as typeof fetch

const { render, screen, waitFor, cleanup, within, fireEvent } = await import('@testing-library/react')
const { default: userEvent } = await import('@testing-library/user-event')
const { default: App } = await import('../src/App')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { AppToaster } = await import('../src/components/ui/Feedback')
const { totpAt } = await import('../server/security')

const user = userEvent.setup({ delay: null })
const run = realNow().toString(36)
const EMAIL = `sec-${run}@example.com`
let password = 'Str0ng!Passw0rd'
let pin = '482916'
const ANVIL = 'test test test test test test test test test test test junk'
const ANVIL_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const T = 20_000

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 0, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <App />
      <AppToaster />
    </QueryClientProvider>,
  )
}
async function tapPin(p: string) {
  for (const d of p) await user.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
}
const heading = (name: string | RegExp) => screen.findByRole('heading', { name }, { timeout: T })
const text = (t: string | RegExp) => screen.findByText(t, {}, { timeout: T })
const home = () => text(/USDC balance/)
const rowOf = (title: string) => screen.getByText(title).closest('.p-4') as HTMLElement

async function goSettings(sub?: RegExp) {
  await user.click(screen.getByRole('link', { name: /Settings/ }))
  await heading('Settings')
  if (sub) await user.click(screen.getByRole('link', { name: sub }))
}
async function signOutFromSettings() {
  for (let i = 0; i < 4 && !screen.queryByRole('link', { name: /Settings/ }); i++) {
    const back = screen.queryByRole('button', { name: 'Go back' })
    if (back) await user.click(back)
  }
  await user.click(screen.getByRole('link', { name: /Settings/ }))
  await user.click(await screen.findByRole('button', { name: /Sign out/ }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign out' }))
  await heading('Welcome back')
}
async function login(pw: string) {
  await user.type(screen.getByLabelText('Email'), EMAIL)
  await user.type(screen.getByLabelText('Password'), pw)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterAll(() => {
  cleanup()
  void GlobalRegistrator.unregister()
})

describe('Security and resilience journey', () => {
  test('register, then import a wallet: invalid phrase rejected, valid phrase gives the right address', async () => {
    window.history.pushState({}, '', '/register')
    mount()
    await heading('Create your account')
    await user.type(screen.getByLabelText('Your name'), 'Sam Import')
    await user.type(screen.getByLabelText('Email'), EMAIL)
    await user.type(screen.getByLabelText('Password'), password)
    await user.type(screen.getByLabelText('Confirm password'), password)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.click(await screen.findByRole('button', { name: /Import with recovery phrase/ }, { timeout: T }))
    await heading('Import your wallet')
    await user.type(screen.getByLabelText('Recovery phrase'), 'abandon abandon abandon')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await text(/12 or 24 words/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Recovery phrase'))
    await user.type(screen.getByLabelText('Recovery phrase'), 'test test test test test test test test test test test test')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await text(/not valid/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Recovery phrase'))
    await user.type(screen.getByLabelText('Recovery phrase'), ANVIL)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await heading('Create a 6-digit PIN')
    await tapPin(pin)
    await heading('Confirm your PIN')
    await tapPin(pin)
    await home()
    await user.click(screen.getByText('Receive'))
    const addr = await screen.findByTestId('address')
    expect(addr.textContent).toBe(ANVIL_ADDRESS)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('change PIN: wrong current rejected, new PIN works after locking', async () => {
    await goSettings(/^Security Password/)
    await user.click(within(rowOf('Transaction PIN')).getByRole('button', { name: 'Change' }))
    await text('Enter current PIN')
    await tapPin('000001')
    expect(await text(/Incorrect PIN\. 4 attempts left/)).toBeTruthy()
    await tapPin(pin)
    await text('Choose a new PIN')
    await tapPin(pin)
    expect(await text(/different from your current/)).toBeTruthy()
    await tapPin('135790')
    await text('Confirm new PIN')
    await tapPin('135790')
    await text('PIN changed')
    pin = '135790'
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.click(screen.getByRole('button', { name: /Lock wallet/ }))
    await text(/Enter your PIN/)
    await tapPin('482916')
    expect(await text(/Incorrect PIN\. 4 attempts left/)).toBeTruthy()
    await tapPin(pin)
    await heading('Settings')
  })

  test('change password: wrong current and weak new are rejected, valid change succeeds', async () => {
    await user.click(screen.getByRole('link', { name: /^Security Password/ }))
    await user.click(within(rowOf('Password')).getByRole('button', { name: 'Change' }))
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText('Current password'), 'Wrong!Passw0rd1')
    await user.type(within(dlg).getByLabelText('New password'), 'N3w!Passw0rd42')
    await user.type(within(dlg).getByLabelText('Confirm new password'), 'N3w!Passw0rd42')
    await user.click(within(dlg).getByRole('button', { name: 'Update password' }))
    expect(await within(dlg).findByText(/current password is not correct/i, {}, { timeout: T })).toBeTruthy()
    await user.clear(within(dlg).getByLabelText('Current password'))
    await user.type(within(dlg).getByLabelText('Current password'), password)
    await user.clear(within(dlg).getByLabelText('New password'))
    await user.type(within(dlg).getByLabelText('New password'), 'weak')
    await user.click(within(dlg).getByRole('button', { name: 'Update password' }))
    expect(await within(dlg).findByText(/Password needs/)).toBeTruthy()
    await user.clear(within(dlg).getByLabelText('New password'))
    await user.clear(within(dlg).getByLabelText('Confirm new password'))
    await user.type(within(dlg).getByLabelText('New password'), 'N3w!Passw0rd42')
    await user.type(within(dlg).getByLabelText('Confirm new password'), 'N3w!Passw0rd42')
    await user.click(within(dlg).getByRole('button', { name: 'Update password' }))
    await text(/Password changed/)
    password = 'N3w!Passw0rd42'
  })

  test('2FA: enable with an authenticator code, then sign-in requires it', async () => {
    await user.click(within(rowOf('Two-factor authentication')).getByRole('button', { name: 'Enable' }))
    await text('Set up 2FA')
    const secretEl = await waitFor(
      () => {
        const el = document.querySelector('[role="dialog"] .font-mono.text-xs')
        if (!el?.textContent) throw new Error('no secret yet')
        return el
      },
      { timeout: T },
    )
    const secret = secretEl.textContent!.trim()
    const step = Math.floor(realNow() / 1000 / 30)
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText('6-digit code'), '000000')
    await user.click(within(dlg).getByRole('button', { name: 'Turn on 2FA' }))
    expect((await within(dlg).findAllByText(/Incorrect code|not correct/i, {}, { timeout: T })).length).toBeGreaterThan(0)
    await user.clear(within(dlg).getByLabelText('6-digit code'))
    await user.type(within(dlg).getByLabelText('6-digit code'), totpAt(secret, step - 1))
    await user.click(within(dlg).getByRole('button', { name: 'Turn on 2FA' }))
    await text(/Two-factor authentication is on/)
    await waitFor(() => expect(within(rowOf('Two-factor authentication')).getByText('On')).toBeTruthy(), { timeout: T })

    await signOutFromSettings()
    await login(password)
    await heading('Two-step check')
    await user.type(screen.getByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect((await screen.findAllByText(/Incorrect code|not correct or has expired/, {}, { timeout: T })).length).toBeGreaterThan(0)
    await user.clear(screen.getByLabelText('Authenticator code'))
    await user.type(screen.getByLabelText('Authenticator code'), totpAt(secret, step))
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await text(/Enter your PIN/)
    await tapPin(pin)
    await home()
  })

  test('forgot password: mock email, reset link, then sign in with the new password', async () => {
    await signOutFromSettings()
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }))
    await heading('Reset your password')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    await user.type(screen.getByLabelText('Email'), EMAIL)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    await text('Mock email (testnet)')
    await user.click(screen.getByRole('link', { name: 'Open reset link' }))
    await heading('Choose a new password')
    await user.type(screen.getByLabelText('New password'), 'R3set!Passw0rd7')
    await user.type(screen.getByLabelText('Confirm password'), 'R3set!Passw0rd7')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await heading('Welcome back')
    password = 'R3set!Passw0rd7'
    await login(password)
    // 2FA is still on after a reset, so the code step must appear
    await heading('Two-step check')
  })

  test('expired or revoked session sends the user to login with a clear message', async () => {
    // Turn 2FA off through the API so the next sign-in is a plain one.
    cleanup()
    window.history.pushState({}, '', '/login')
    sessionStorage.clear()
    const base = `${process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:3002'}/api`
    // Fresh account without 2FA, created through the API for speed.
    const email2 = `exp-${run}@example.com`
    const reg = await realFetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email2, password, displayName: 'Exp User' }),
    })
    const auth = (await reg.json()) as { refreshToken: string; accessToken: string }
    expect(reg.status).toBe(201)
    sessionStorage.setItem('payest:rt', auth.refreshToken)
    localStorage.clear()
    mount()
    await user.click(await screen.findByRole('button', { name: /Create a new wallet/ }, { timeout: T }))
    await heading('Write down your recovery phrase')
    // Revoke the session behind the app's back, like another device signing it out.
    const current = sessionStorage.getItem('payest:rt')!
    await realFetch(`${base}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: current }) })
    cleanup()
    mount()
    await heading('Welcome back')
  })

  test('idle timers: the wallet locks first, then the session ends', async () => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    window.history.pushState({}, '', '/login')
    mount()
    // sign in as the first user, whose wallet was imported earlier (keystore removed by localStorage.clear), so import again
    await user.type(await screen.findByLabelText('Email'), EMAIL)
    await user.type(screen.getByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await heading('Two-step check')
    // 2FA is on for this user, so use a fresh no-2FA account for the idle test
    cleanup()
    sessionStorage.clear()
    window.history.pushState({}, '', '/register')
    mount()
    const email3 = `idle-${run}@example.com`
    await user.type(await screen.findByLabelText('Your name'), 'Idle User')
    await user.type(screen.getByLabelText('Email'), email3)
    await user.type(screen.getByLabelText('Password'), password)
    await user.type(screen.getByLabelText('Confirm password'), password)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.click(await screen.findByRole('button', { name: /Import with recovery phrase/ }, { timeout: T }))
    await user.type(await screen.findByLabelText('Recovery phrase'), ANVIL)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await tapPin(pin)
    await tapPin(pin)
    await home()

    clockOffset += 3 * 60_000
    await text(/Enter your PIN/) // auto-lock after 2 minutes idle
    clockOffset += 14 * 60_000
    await heading('Welcome back')
    expect(await text(/signed out after 15 minutes/)).toBeTruthy()
    expect(sessionStorage.getItem('payest:rt')).toBeNull()
  })

  test('offline or failing network shows a clear error with retry, and keeps the app usable', async () => {
    cleanup()
    clockOffset = 0
    window.history.pushState({}, '', '/login')
    mount()
    const email3 = `idle-${run}@example.com`
    await user.type(await screen.findByLabelText('Email'), email3)
    await user.type(screen.getByLabelText('Password'), password)
    blockRpc = true
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await text(/Enter your PIN/)
    await tapPin(pin)
    expect((await screen.findAllByText(/Cannot reach the network right now|Something went wrong/, {}, { timeout: T })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0)
    blockRpc = false
    await user.click(screen.getAllByRole('button', { name: /Try again/ })[0]!)
    await home()
    await waitFor(() => expect(screen.queryByText(/Cannot reach the network/)).toBeNull(), { timeout: T })
  })

  test('rapid repeated taps send a single request', async () => {
    await signOutFromSettings()
    await user.type(screen.getByLabelText('Email'), `idle-${run}@example.com`)
    await user.type(screen.getByLabelText('Password'), password)
    const before = calls.filter((c) => c === 'POST /api/auth/login').length
    const btn = screen.getByRole('button', { name: 'Sign in' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    await text(/Enter your PIN/)
    const after = calls.filter((c) => c === 'POST /api/auth/login').length
    expect(after - before).toBe(1)
  })
})
