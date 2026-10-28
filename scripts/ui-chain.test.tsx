/**
 * Real on-chain UI journey on Arc Testnet (and Base Sepolia for the bridge).
 * Drives the actual app screens in a simulated browser against the TEST API (database payest_test),
 * then checks the database, notifications and balances against the chain.
 *
 *   bun run server:test        # test API on port 3002 (separate database)
 *   bun run test:ui-chain      # needs the funded test wallet in /tmp/payest-test-mnemonic.txt
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { SQL } from 'bun'
import { erc20Abi, parseEventLogs } from 'viem'

process.env.RTL_SKIP_AUTO_CLEANUP = 'true'
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 390, height: 844 })
Reflect.deleteProperty(Element.prototype, 'animate')
Reflect.deleteProperty(HTMLElement.prototype, 'animate')

const API = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:3002'
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return realFetch(raw.startsWith('/') ? `${API}${raw}` : raw, init)
}) as typeof fetch

const { render, screen, waitFor, cleanup, within, fireEvent } = await import('@testing-library/react')
const { default: userEvent } = await import('@testing-library/user-event')
const { default: App } = await import('../src/App')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { AppToaster } = await import('../src/components/ui/Feedback')
const chainLib = await import('../src/lib/chain')
const keystore = await import('../src/lib/keystore')
const cfg = await import('../src/config/app')
const fmt = await import('../src/lib/format')
const facts = await import('../src/onchain-facts')
const { api } = await import('../src/lib/api')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const user = userEvent.setup({ delay: null })
const EMAIL = `chain-${Date.now().toString(36)}@example.com`
const PASSWORD = 'Str0ng!Passw0rd'
const PIN = '482916'
const T = 30_000
const ARC = cfg.DEFAULT_CHAIN_ID
const BASE_SEPOLIA = 84532
const usdc = cfg.getToken(ARC, 'USDC')!
const eurc = cfg.getToken(ARC, 'EURC')!

const mnemonic = readFileSync('/tmp/payest-test-mnemonic.txt', 'utf8').trim()
const W = keystore.accountFromMnemonic(mnemonic)
const W2 = keystore.accountFromMnemonic(keystore.newMnemonic())
const R = keystore.accountFromMnemonic(keystore.newMnemonic())
const db = new SQL(process.env.TEST_DATABASE_URL ?? '')

const bal = async (chainId: number, who: `0x${string}`) => {
  const b = await chainLib.readBalances(chainId, who)
  return { usdc: b.tokens.USDC ?? 0n, eurc: b.tokens.EURC ?? 0n }
}
const dec = (raw: bigint) => Number(raw) / 1e6
const heading = (name: string | RegExp, timeout = T) => screen.findByRole('heading', { name }, { timeout })
const text = (t: string | RegExp, timeout = T) => screen.findByText(t, {}, { timeout })
async function tapPin(p: string) {
  for (const d of p) await user.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
}
const bellCount = () => {
  const label = screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label') ?? ''
  return Number(/(\d+) unread/.exec(label)?.[1] ?? 0)
}
async function goHome() {
  for (let i = 0; i < 4 && !screen.queryByRole('link', { name: /Settings/ }); i++) {
    const back = screen.queryByRole('button', { name: 'Go back' })
    if (back) await user.click(back)
  }
  await user.click(screen.getByRole('link', { name: /Home/ }))
  await text(/USDC balance/)
}
async function confirmWithPin() {
  await user.click(await screen.findByRole('button', { name: 'Confirm with PIN' }, { timeout: T }))
  await tapPin(PIN)
}

const report: string[] = []
const note = (s: string) => {
  report.push(s)
  console.log('  NOTE', s)
}
let startUsdc = 0n
let startEurc = 0n
let startBaseUsdc = 0n
let userId = ''
const hashes: Record<string, `0x${string}`> = {}

afterAll(async () => {
  cleanup()
  await db.close()
  void GlobalRegistrator.unregister()
})

describe('On-chain journey', () => {
  // The test waits on the network without touching the screen; keep the idle timer from locking the wallet.
  const keepAlive = setInterval(() => window.dispatchEvent(new Event('pointerdown')), 15_000)
  afterAll(() => clearInterval(keepAlive))
  test('setup: fund a second wallet and read starting balances', async () => {
    const h = await chainLib.sendToken({ chainId: ARC, account: W, token: usdc, to: W2.address, amountRaw: 600_000n })
    expect((await chainLib.waitForReceipt(ARC, h)).status).toBe('confirmed')
    ;({ usdc: startUsdc, eurc: startEurc } = await bal(ARC, W.address))
    startBaseUsdc = (await bal(BASE_SEPOLIA, W.address)).usdc
    note(`start balances: ${dec(startUsdc)} USDC, ${dec(startEurc)} EURC on Arc; ${dec(startBaseUsdc)} USDC on Base Sepolia`)
    expect(startUsdc).toBeGreaterThan(8_000_000n)
  })

  test('register, import the funded wallet, home balance matches the chain', async () => {
    window.history.pushState({}, '', '/register')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 0, refetchOnWindowFocus: false } } })
    render(
      <QueryClientProvider client={qc}>
        <App />
        <AppToaster />
      </QueryClientProvider>,
    )
    await heading('Create your account')
    await user.type(screen.getByLabelText('Your name'), 'Chain Tester')
    await user.type(screen.getByLabelText('Email'), EMAIL)
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.click(await screen.findByRole('button', { name: /Import with recovery phrase/ }, { timeout: T }))
    await heading('Import your wallet')
    await user.type(screen.getByLabelText('Recovery phrase'), mnemonic)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await heading('Create a 6-digit PIN')
    await tapPin(PIN)
    await heading('Confirm your PIN')
    await tapPin(PIN)
    await text(/USDC balance/)
    const shown = fmt.formatToken(startUsdc, 6, 2, 2)
    expect(await screen.findAllByText(new RegExp(shown.replace('.', '\\.')), {}, { timeout: T })).toBeTruthy()
    userId = String((await db`select id from users where email = ${EMAIL}`)[0]?.id)
    expect(userId.length).toBeGreaterThan(10)
  })

  test('send 0.1 USDC through the UI to a fresh address', async () => {
    const before = await bal(ARC, W.address)
    await user.click(await screen.findByText('Send'))
    await heading('Send')
    await user.type(screen.getByLabelText('Recipient address'), R.address)
    await user.type(screen.getByLabelText('Amount'), '0.1')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false), { timeout: T })
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await heading('Review')
    await confirmWithPin()
    await heading('Transfer confirmed', 90_000)
    expect((await bal(ARC, R.address)).usdc).toBe(100_000n)
    const after = await bal(ARC, W.address)
    note(`send: wallet USDC ${dec(before.usdc)} -> ${dec(after.usdc)} (0.1 sent + network fee)`)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await text(/USDC balance/)
  })

  test('incoming transfer is detected, saved, and raises a notification and badge', async () => {
    await sleep(cfg.TIMING.incomingPollMs + 4000) // let the watcher take its starting position first
    const badgeBefore = bellCount()
    const h = await chainLib.sendToken({ chainId: ARC, account: W2, token: usdc, to: W.address, amountRaw: 50_000n })
    hashes.incoming = h
    expect((await chainLib.waitForReceipt(ARC, h)).status).toBe('confirmed')
    await waitFor(() => expect(bellCount()).toBeGreaterThan(badgeBefore), { timeout: 70_000, interval: 1000 })
    note(`badge ${badgeBefore} -> ${bellCount()} after the incoming transfer`)
  })

  test('swap 1 USDC for EURC through the UI', async () => {
    const before = await bal(ARC, W.address)
    await user.click(await screen.findByText('Swap'))
    await heading('Swap')
    await user.type(screen.getByLabelText('You pay (USDC)'), '1')
    const review = await screen.findByRole('button', { name: 'Review swap' }, { timeout: 60_000 })
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false), { timeout: 60_000 })
    await user.click(review)
    await heading('Review swap')
    await confirmWithPin()
    await heading('Swap confirmed', 120_000)
    const after = await bal(ARC, W.address)
    note(`swap: EURC ${dec(before.eurc)} -> ${dec(after.eurc)} (+${dec(after.eurc - before.eurc)}), USDC ${dec(before.usdc)} -> ${dec(after.usdc)}`)
    expect(after.eurc).toBeGreaterThan(before.eurc)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await text(/USDC balance/)
  })

  test('bridge 3 USDC from Arc Testnet to Base Sepolia through the UI', async () => {
    await user.click(await screen.findByText('Bridge'))
    await heading('Bridge')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: String(BASE_SEPOLIA) } })
    await user.type(screen.getByLabelText('Amount (USDC)'), '3')
    const review = await screen.findByRole('button', { name: 'Review bridge' }, { timeout: 90_000 })
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false), { timeout: 90_000 })
    await user.click(review)
    await heading('Review bridge')
    await confirmWithPin()
    await heading('Bridge complete', 300_000)
    const baseAfter = (await bal(BASE_SEPOLIA, W.address)).usdc
    note(`bridge: Base Sepolia USDC ${dec(startBaseUsdc)} -> ${dec(baseAfter)}`)
    expect(baseAfter).toBeGreaterThan(startBaseUsdc)
  }, 360_000)

  test('a transaction that reverts on-chain is settled as failed by the app', async () => {
    const { createWalletClient, http } = await import('viem')
    const client = chainLib.publicClientFor(ARC)
    const wallet = createWalletClient({ account: W, chain: client.chain, transport: http(client.transport.url as string) })
    // A fixed gas limit skips estimation, so the transfer is broadcast and reverts for lack of balance.
    const hash = await wallet.writeContract({ address: usdc.address as `0x${string}`, abi: erc20Abi, functionName: 'transfer', args: [R.address, 10n ** 15n], gas: 120_000n })
    hashes.failed = hash
    await api.recordTransaction({ walletAddress: W.address, chainId: ARC, type: 'send', status: 'pending', tokenSymbol: 'USDC', amount: '1000000000', fromAddress: W.address, toAddress: R.address, txHash: hash })
    const badge = bellCount()
    await waitFor(async () => {
      const rows = await db`select status from transactions where tx_hash = ${hash}`
      expect(rows[0]?.status).toBe('failed')
    }, { timeout: 90_000, interval: 2000 })
    await waitFor(() => expect(bellCount()).toBeGreaterThan(badge), { timeout: 30_000, interval: 1000 })
    note(`failed tx settled by the app; badge ${badge} -> ${bellCount()}`)
  }, 200_000)

  test('database rows match the chain: status, amount, token, addresses, explorer link', async () => {
    const rows = await db`select * from transactions where user_id = ${userId} order by created_at`
    const byType = (t: string) => rows.filter((r: { type: string }) => r.type === t)
    console.log('       rows:', rows.map((r: { type: string; status: string; amount: string; token_symbol: string }) => `${r.type}/${r.status}/${r.amount} ${r.token_symbol}`).join(' | '))
    expect(rows.length).toBe(5)
    const pc = chainLib.publicClientFor(ARC)
    const check = async (r: { tx_hash: string; chain_id: number; status: string; amount: string; from_address: string; to_address: string; token_symbol: string }, expectOnchain: 'success' | 'reverted') => {
      const rc = await chainLib.publicClientFor(r.chain_id).getTransactionReceipt({ hash: r.tx_hash as `0x${string}` })
      expect(rc.status).toBe(expectOnchain)
      expect(r.status).toBe(expectOnchain === 'success' ? 'confirmed' : 'failed')
      expect(rc.from.toLowerCase()).toBe(r.from_address.toLowerCase())
      const url = facts.buildTxExplorerUrl(r.chain_id, r.tx_hash)
      const head = Number(new TextDecoder().decode(Bun.spawnSync(['curl', '-s', '-o', '/dev/null', '-m', '20', '-L', '-w', '%{http_code}', url]).stdout))
      note(`explorer ${url.slice(0, 60)}… -> HTTP ${head}`)
      return rc
    }
    const send = byType('send').find((r: { status: string }) => r.status === 'confirmed')
    expect(send.token_symbol).toBe('USDC')
    expect(Number(send.amount)).toBe(0.1)
    expect(send.to_address.toLowerCase()).toBe(R.address.toLowerCase())
    const sendRc = await check(send, 'success')
    const [t] = parseEventLogs({ abi: erc20Abi, logs: sendRc.logs, eventName: 'Transfer' }).filter((l) => l.address.toLowerCase() === usdc.address.toLowerCase())
    expect(t?.args.value).toBe(100_000n)
    expect(t?.args.to.toLowerCase()).toBe(R.address.toLowerCase())
    expect(Number(send.fee)).toBeGreaterThan(0)

    const recv = byType('receive')[0]
    expect(recv.status).toBe('confirmed')
    expect(Number(recv.amount)).toBe(0.05)
    expect(recv.from_address.toLowerCase()).toBe(W2.address.toLowerCase())
    expect(recv.to_address.toLowerCase()).toBe(W.address.toLowerCase())
    expect(recv.tx_hash).toBe(hashes.incoming)
    await check(recv, 'success')

    const swap = byType('swap')[0]
    expect(swap.token_symbol).toBe('USDC')
    expect(Number(swap.amount)).toBe(1)
    expect(swap.to_token_symbol).toBe('EURC')
    const swapRc = await check(swap, 'success')
    const eurcIn = parseEventLogs({ abi: erc20Abi, logs: swapRc.logs, eventName: 'Transfer' }).filter((l) => l.address.toLowerCase() === eurc.address.toLowerCase() && l.args.to.toLowerCase() === W.address.toLowerCase())
    const actualOut = eurcIn.reduce((a, l) => a + l.args.value, 0n)
    note(`swap: recorded toAmount ${swap.to_amount} EURC, actual received on-chain ${dec(actualOut)} EURC`)
    expect(Number(swap.to_amount)).toBeCloseTo(dec(actualOut), 4)

    const bridge = byType('bridge')[0]
    expect(bridge.status).toBe('confirmed')
    expect(Number(bridge.amount)).toBe(3)
    expect(Number(bridge.chain_id)).toBe(ARC)
    expect(Number(bridge.dest_chain_id)).toBe(BASE_SEPOLIA)
    expect(bridge.dest_tx_hash).toBeTruthy()
    await check(bridge, 'success')
    const destRc = await chainLib.publicClientFor(BASE_SEPOLIA).getTransactionReceipt({ hash: bridge.dest_tx_hash as `0x${string}` })
    expect(destRc.status).toBe('success')

    const failed = rows.find((r: { tx_hash: string }) => r.tx_hash === hashes.failed)
    expect(failed.status).toBe('failed')
    await check(failed, 'reverted')
    expect(pc).toBeTruthy()
  }, 120_000)

  test('notifications match the transactions and the unread badge matches the API', async () => {
    const list = await api.notifications({ pageSize: 50 })
    const titles = list.data.map((n) => n.title)
    console.log('       notifications:', titles.join(' | '))
    for (const prefix of ['Sent', 'Received', 'Swapped', 'Bridged', 'Send failed']) expect(titles.some((x) => x.startsWith(prefix))).toBe(true)
    const rows = await db`select count(*)::int as n from notifications where user_id = ${userId} and read = false`
    expect(list.unreadCount).toBe(rows[0]?.n)
    await goHome()
    await waitFor(() => expect(bellCount()).toBe(list.unreadCount), { timeout: 40_000, interval: 1000 })
    note(`unread badge ${bellCount()} equals API and database (${rows[0]?.n})`)
  })

  test('history from the API matches the database and the chain; balances reconcile', async () => {
    const hist = await api.transactions({ pageSize: 50 })
    const rows = await db`select tx_hash, status, amount from transactions where user_id = ${userId}`
    expect(hist.pagination.total).toBe(rows.length)
    for (const h of hist.data) {
      const r = rows.find((x: { tx_hash: string }) => x.tx_hash === h.txHash)
      expect(r?.status).toBe(h.status)
      expect(r?.amount).toBe(h.amount)
    }
    const now = await bal(ARC, W.address)
    const fees = await db`select coalesce(sum(fee::numeric), 0)::text as f from transactions where user_id = ${userId}`
    const feeUsdc = Number(fees[0]?.f)
    const expected = dec(startUsdc) - 0.1 + 0.05 - 1 - 3 - feeUsdc
    note(`USDC reconciliation: on-chain ${dec(now.usdc)}, expected from history ${expected.toFixed(6)} (recorded fees ${feeUsdc.toFixed(6)}; bridge approve and burn gas is not recorded)`)
    expect(Math.abs(dec(now.usdc) - expected)).toBeLessThan(0.05)
  })
})
