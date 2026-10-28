/**
 * Browser-like UI journey, run with:  bun test scripts/ui-journey.test.tsx
 * Runs against the TEST API on port 3002 (database payest_test), never the main database. Start it with: bun run server:test
 * Renders the real app in happy-dom and drives it like a user.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

process.env.RTL_SKIP_AUTO_CLEANUP = 'true'
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 390, height: 844 })

// happy-dom's Web Animations cancel rejects unhandled; framer-motion falls back to JS animation without it.
Reflect.deleteProperty(Element.prototype, 'animate')
Reflect.deleteProperty(HTMLElement.prototype, 'animate')

// Route relative /api calls through the running Vite proxy, like a browser would.
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:3002'}${input}` : input
  return realFetch(url as RequestInfo, init)
}) as typeof fetch

const consoleErrors: string[] = []
const origError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
  if (!/not wrapped in act|ReactDOMTestUtils|Warning: An update/.test(text)) consoleErrors.push(text)
  origError(...args)
}

const { render, screen, waitFor, cleanup, within } = await import('@testing-library/react')
const { default: userEvent } = await import('@testing-library/user-event')
const { default: App } = await import('../src/App')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { AppToaster } = await import('../src/components/ui/Feedback')

const user = userEvent.setup({ delay: null })
const run = Date.now().toString(36)
const EMAIL = `ui-${run}@example.com`
const PASSWORD = 'Str0ng!Passw0rd'
const PIN = '482916'
let phrase: string[] = []

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 0, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <App />
      <AppToaster />
    </QueryClientProvider>,
  )
}

async function tapPin(pin: string) {
  for (const d of pin) await user.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
}

const T = 20_000
const find = (text: string | RegExp, role: 'heading' | 'button' | 'link' | 'alert' | 'status' | 'dialog' = 'heading') =>
  screen.findByRole(role, { name: text }, { timeout: T })

beforeAll(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => {
  cleanup()
  void GlobalRegistrator.unregister()
})

describe('Payest Wallet UI journey', () => {
  test('anonymous visitors land on login with the testnet badge and warning', async () => {
    window.history.pushState({}, '', '/')
    mount()
    await find('Welcome back')
    expect(screen.getAllByText('Testnet').length).toBeGreaterThan(0)
    expect(screen.getByText(/Test tokens have no real value/)).toBeTruthy()
  })

  test('login validates inputs and shows a clear error for wrong credentials', async () => {
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/valid email/i)).toBeTruthy()
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await user.type(screen.getByLabelText('Password'), 'Wrong!Passw0rd1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Incorrect email or password.', {}, { timeout: T })).toBeTruthy()
  })

  test('register enforces password rules, then creates the account', async () => {
    await user.click(screen.getByRole('link', { name: 'Create an account' }))
    await find('Create your account')
    await user.type(screen.getByLabelText('Your name'), 'Ada Okafor')
    await user.type(screen.getByLabelText('Email'), EMAIL)
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/Password needs/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Password'))
    await user.clear(screen.getByLabelText('Confirm password'))
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await find(/set up your wallet/i)
  })

  test('create wallet: backup phrase, quiz (wrong then right), PIN', async () => {
    await user.click(screen.getByRole('button', { name: /Create a new wallet/ }))
    await find('Write down your recovery phrase')
    const saved = screen.getByRole('button', { name: 'I saved it' }) as HTMLButtonElement
    expect(saved.disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /Tap to reveal/ }))
    phrase = Array.from(document.querySelectorAll('.font-mono.text-sm.font-medium')).map((n) => n.textContent ?? '')
    expect(phrase.length).toBe(12)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'I saved it' }))
    await find('Quick check')

    const labels = screen.getAllByLabelText(/Word #/)
    const idx = labels.map((l) => Number((l.closest('div')?.parentElement?.querySelector('label')?.textContent ?? '').replace(/\D/g, '')) - 1)
    // wrong answers first
    for (const l of labels) await user.type(l, 'zzz')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/do not match/)).toBeTruthy()
    for (const [n, l] of labels.entries()) {
      await user.clear(l)
      await user.type(l, phrase[idx[n]!]!)
    }
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await find('Create a 6-digit PIN')

    await tapPin('123456')
    expect(await screen.findByText(/simple sequence/)).toBeTruthy()
    await tapPin(PIN)
    await find('Confirm your PIN')
    await tapPin('111222')
    expect(await screen.findByText(/PINs do not match/)).toBeTruthy()
    await find('Create a 6-digit PIN')
    await tapPin(PIN)
    await find('Confirm your PIN')
    await tapPin(PIN)
    await screen.findByText(/USDC balance/, {}, { timeout: T })
  })

  test('home shows the wallet, balance controls and faucet link', async () => {
    expect(screen.getByRole('button', { name: /Hide balance/ })).toBeTruthy()
    const faucet = screen.getByText('Get test tokens').closest('a')
    expect(faucet?.getAttribute('href')).toBe('https://faucet.circle.com')
    expect(screen.getByText(/NGN balance/)).toBeTruthy()
    // zero balance: the 24h change must not render
    await waitFor(() => expect(screen.queryByText(/24h/)).toBeNull(), { timeout: T })
    await user.click(screen.getByRole('button', { name: /Hide balance/ }))
    expect(screen.getByRole('button', { name: /Show balance/ })).toBeTruthy()
    for (const label of ['Send', 'Receive', 'Swap', 'Bridge']) expect(screen.getByText(label)).toBeTruthy()
    for (const label of ['Exchange', 'P2P', 'DeFi', 'Deposit NGN', 'More']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText('No activity yet')).toBeTruthy(), { timeout: T })
  })

  test('receive shows the address and a QR code', async () => {
    await user.click(screen.getByText('Receive'))
    await find('Receive')
    const addr = await screen.findByTestId('address')
    expect(addr.textContent).toMatch(/^0x[0-9a-fA-F]{40}$/)
    await waitFor(() => expect(document.querySelector('img[alt^="QR code"]')).toBeTruthy(), { timeout: T })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('send validates address and amount and blocks insufficient funds', async () => {
    await user.click(await screen.findByText('Send'))
    await find('Send')
    const review = () => screen.getByRole('button', { name: 'Review' })
    await user.click(review())
    // fee estimate may still be loading; wait until the form can be submitted
    await waitFor(() => expect((review() as HTMLButtonElement).disabled).toBe(false), { timeout: T })
    await user.click(review())
    expect(await screen.findByText(/Enter a recipient address|valid 0x wallet address/)).toBeTruthy()
    await user.type(screen.getByLabelText('Recipient address'), '0x123')
    expect(screen.getAllByText(/valid 0x wallet address/).length).toBeGreaterThan(0)
    await user.clear(screen.getByLabelText('Recipient address'))
    await user.type(screen.getByLabelText('Recipient address'), '0x000000000000000000000000000000000000dEaD')
    await user.type(screen.getByLabelText('Amount'), '0')
    await user.click(review())
    expect(await screen.findByText(/greater than zero/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '5')
    await user.click(review())
    expect(await screen.findByText(/Insufficient USDC balance/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('bridge and swap screens load with their controls', async () => {
    await screen.findByText(/USDC balance/, {}, { timeout: T })
    await user.click(screen.getByText('Bridge'))
    await find('Bridge')
    expect(screen.getByLabelText('From')).toBeTruthy()
    expect(screen.getByLabelText('To')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enter an amount to bridge|Choose two different/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await screen.findByText(/USDC balance/, {}, { timeout: T })
    await user.click(screen.getByText('Swap'))
    await find('Swap')
    expect(screen.getByText('Slippage tolerance')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Flip tokens' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enter an amount to swap/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('coming soon screens', async () => {
    await screen.findByText(/USDC balance/, {}, { timeout: T })
    await user.click(screen.getAllByText('Deposit NGN')[0]!)
    expect((await screen.findAllByRole('heading', { name: 'Deposit NGN' }, { timeout: T })).length).toBeGreaterThan(0)
    expect(screen.getByText('Coming soon')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to home' }))
  })

  test('activity and notifications show empty/real states with an unread badge', async () => {
    const t0 = Date.now()
    const lap = (n: string) => console.log('LAP', n, Date.now() - t0)
    await user.click(screen.getByRole('link', { name: /Activity/ }))
    await find('Activity')
    lap('activity heading')
    await waitFor(() => expect(screen.getByText('No transactions yet')).toBeTruthy(), { timeout: T })
    lap('empty')
    await user.click(screen.getByRole('button', { name: 'Sent' }))
    await waitFor(() => expect(screen.getByText('No matching transactions')).toBeTruthy(), { timeout: T })
    lap('filtered')
    await user.click(screen.getByRole('link', { name: /Alerts/ }))
    await find('Notifications')
    await waitFor(() => expect(screen.getAllByText(/Welcome to Payest Wallet|New sign-in/).length).toBeGreaterThan(0), { timeout: T })
    lap('notifs')
    await user.click(screen.getByRole('button', { name: /Mark all read/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mark all read/ })).toBeNull(), { timeout: T })
    lap('done')
  })

  test('settings: address book add, edit, delete', async () => {
    await user.click(screen.getByRole('link', { name: /Settings/ }))
    await find('Settings')
    await user.click(screen.getByRole('link', { name: /Address book/ }))
    await find('Address book')
    await waitFor(() => expect(screen.getByText('No contacts yet')).toBeTruthy(), { timeout: T })
    await user.click(screen.getAllByRole('button', { name: /Add/ })[0]!)
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText('Name'), 'Mum')
    await user.type(within(dlg).getByLabelText('Wallet address'), 'bad')
    await user.click(within(dlg).getByRole('button', { name: 'Save contact' }))
    expect(await within(dlg).findByText(/valid 0x wallet address/)).toBeTruthy()
    await user.clear(within(dlg).getByLabelText('Wallet address'))
    await user.type(within(dlg).getByLabelText('Wallet address'), '0x000000000000000000000000000000000000dEaD')
    await user.click(within(dlg).getByRole('button', { name: 'Save contact' }))
    await screen.findByText('Mum', {}, { timeout: T })
    await user.click(screen.getByRole('button', { name: 'Edit Mum' }))
    const dlg2 = await screen.findByRole('dialog')
    await user.clear(within(dlg2).getByLabelText('Name'))
    await user.type(within(dlg2).getByLabelText('Name'), 'Mother')
    await user.click(within(dlg2).getByRole('button', { name: 'Save contact' }))
    await screen.findByText('Mother', {}, { timeout: T })
    await user.click(screen.getByRole('button', { name: 'Delete Mother' }))
    const dlg3 = await screen.findByRole('dialog')
    await user.click(within(dlg3).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('No contacts yet')).toBeTruthy(), { timeout: T })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('settings: security page, recovery phrase needs the PIN (wrong then right)', async () => {
    await user.click(screen.getByRole('link', { name: /^Security Password/ }))
    await find('Security')
    const row = screen.getByText('Recovery phrase').closest('div')!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Show' }))
    await screen.findByText('Enter PIN to view')
    await tapPin('000001')
    expect(await screen.findByText(/Incorrect PIN\. 4 attempts left/)).toBeTruthy()
    await tapPin(PIN)
    await screen.findByText(/Never share these words/, {}, { timeout: T })
    const shown = Array.from(document.querySelectorAll('.font-mono.text-sm.font-medium')).map((n) => n.textContent)
    expect(shown.join(' ')).toBe(phrase.join(' '))
    await user.click(screen.getByRole('button', { name: 'Hide now' }))
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('network switcher offers testnets only', async () => {
    await user.click(screen.getByRole('link', { name: /Network/ }))
    await find('Network')
    expect(screen.getByText(/Mainnet networks are not available/)).toBeTruthy()
    expect(screen.queryByText(/^Ethereum$/)).toBeNull()
    expect(screen.getByText('Base Sepolia')).toBeTruthy()
    await user.click(screen.getByText('Base Sepolia'))
    await waitFor(() => expect(screen.getAllByText('Base Sepolia').length).toBeGreaterThan(1), { timeout: T })
    await user.click(screen.getByText('Arc Testnet'))
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('security log lists this device and sign-ins', async () => {
    await user.click(screen.getByRole('link', { name: /Security log/ }))
    await find('Security log')
    await screen.findByText('This device', {}, { timeout: T })
    await waitFor(() => expect(screen.getAllByText('Signed in').length).toBeGreaterThan(0), { timeout: T })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })

  test('lock and unlock: wrong PIN is rejected, right PIN restores the session', async () => {
    await user.click(screen.getByRole('button', { name: /Lock wallet/ }))
    await screen.findByText(/Enter your PIN/)
    await tapPin('000002')
    expect(await screen.findByText(/Incorrect PIN\. 4 attempts left/)).toBeTruthy()
    await tapPin(PIN)
    await find('Settings')
  })

  test('sign out returns to login; signing back in asks for the PIN', async () => {
    await user.click(screen.getByRole('button', { name: /Sign out/ }))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Sign out' }))
    await find('Welcome back')
    expect(sessionStorage.getItem('payest:rt')).toBeNull()
    await user.type(screen.getByLabelText('Email'), EMAIL)
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText(/Enter your PIN/, {}, { timeout: T })
    await tapPin(PIN)
    await screen.findByText(/USDC balance/, {}, { timeout: T })
  })

  test('session survives a reload through the refresh token', async () => {
    cleanup()
    mount()
    await screen.findByText(/Enter your PIN/, {}, { timeout: T })
  })

  test('no unexpected console errors during the journey', () => {
    const real = consoleErrors.filter((e) => !/Failed to load resource|favicon|fonts\.g|401 \(Unauthorized\)/.test(e))
    expect(real).toEqual([])
  })
})
