/**
 * Testnet integration test for the wallet core, run outside the browser with bun:
 *   bun run scripts/test-onchain.ts [keystore|balances|send|swap|bridge|all]
 * Uses a throwaway test wallet stored in /tmp (never in the repo). Fund it from the Circle faucet.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Minimal browser shims so the app's own modules can be imported unchanged.
const store = new Map<string, string>()
const mem = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
Object.assign(globalThis, {
  window: { addEventListener() {}, parent: { postMessage() {} }, location: { href: 'http://localhost:5173/', ancestorOrigins: [] } },
  document: { referrer: '' },
  localStorage: mem,
  sessionStorage: mem,
  navigator: { onLine: true },
})

const keystore = await import('../src/lib/keystore')
const chainLib = await import('../src/lib/chain')
const cfg = await import('../src/config/app')
const money = await import('../src/onchain-money')
const swapSvc = await import('../src/services/swap')
const bridgeSvc = await import('../src/services/bridge')
const { createLocalAdapter } = await import('../src/services/adapter')

let passed = 0
let failed = 0
const ok = (cond: boolean, name: string, extra?: unknown) => {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}`, extra ?? '')
  }
}

const stage = process.argv[2] ?? 'all'
const want = (s: string) => stage === 'all' || stage === s

const FILE = '/tmp/payest-test-mnemonic.txt'
const mnemonic = existsSync(FILE) ? readFileSync(FILE, 'utf8').trim() : keystore.newMnemonic()
if (!existsSync(FILE)) writeFileSync(FILE, mnemonic, { mode: 0o600 })
const account = keystore.accountFromMnemonic(mnemonic)
console.log('Test wallet address:', account.address)

if (want('keystore')) {
  console.log('Keystore')
  ok(keystore.isValidMnemonic(mnemonic), 'generated mnemonic is valid BIP-39')
  ok(mnemonic.split(' ').length === 12, '12 words')
  ok(!keystore.isValidMnemonic('abandon abandon abandon'), 'invalid phrase rejected')
  ok(keystore.pinWeakness('123456') !== null && keystore.pinWeakness('111111') !== null && keystore.pinWeakness('12345') !== null, 'weak PINs rejected')
  ok(keystore.pinWeakness('482916') === null, 'normal PIN accepted')
  const t0 = Date.now()
  const rec = await keystore.encryptMnemonic(mnemonic, '482916')
  console.log(`       (PBKDF2 ${cfg.PIN_KDF_ITERATIONS} iterations took ${Date.now() - t0} ms)`)
  ok(!JSON.stringify(rec).includes(mnemonic.split(' ')[0]! + ' '), 'ciphertext does not contain the phrase')
  ok(rec.address === account.address, 'keystore stores the public address')
  ok((await keystore.decryptMnemonic(rec, '482916')) === mnemonic, 'right PIN decrypts')
  let wrong = false
  try {
    await keystore.decryptMnemonic(rec, '000001')
  } catch (e) {
    wrong = e instanceof keystore.WrongPinError
  }
  ok(wrong, 'wrong PIN is rejected')
  const tampered = { ...rec, ct: rec.ct.slice(0, -4) + 'AAAA' }
  let tamperRejected = false
  try {
    await keystore.decryptMnemonic(tampered, '482916')
  } catch {
    tamperRejected = true
  }
  ok(tamperRejected, 'tampered ciphertext is rejected')
  keystore.saveKeystore('u1', rec)
  ok(keystore.loadKeystore('u1')?.address === account.address, 'save and load keystore')
  let locked = false
  for (let i = 0; i < 5; i++) {
    try {
      await keystore.verifyPin('u1', rec, '000002')
    } catch (e) {
      locked = e instanceof keystore.PinLockedError
    }
  }
  ok(locked, 'five wrong PINs trigger a temporary lockout')
  let blocked = false
  try {
    await keystore.verifyPin('u1', rec, '482916')
  } catch (e) {
    blocked = e instanceof keystore.PinLockedError
  }
  ok(blocked, 'correct PIN is refused during lockout')
  const q = keystore.pickQuizIndexes(12)
  ok(q.length === 3 && new Set(q).size === 3 && q.every((n) => n >= 0 && n < 12), 'backup quiz picks 3 distinct words')
}

const chainId = cfg.DEFAULT_CHAIN_ID
const usdc = cfg.getToken(chainId, 'USDC')!
const eurc = cfg.getToken(chainId, 'EURC')!

if (want('balances') || want('send') || want('swap') || want('bridge')) {
  console.log('Balances and fees (Arc Testnet)')
  const b = await chainLib.readBalances(chainId, account.address)
  const usdcBal = b.tokens.USDC ?? 0n
  console.log(`       USDC ${money.formatUnitsExact(usdcBal, 6)}  EURC ${money.formatUnitsExact(b.tokens.EURC ?? 0n, 6)}`)
  ok(typeof usdcBal === 'bigint', 'live USDC balance read from chain')
  const fee = await chainLib.estimateTransferFee(chainId, usdc, account.address, account.address, 1n)
  ok(fee.gas > 0n && fee.feeNative > 0n, 'transfer fee estimated', fee)
  ok(fee.feeUsdcRaw !== null && fee.feeUsdcRaw < 1_000_000n, `fee shown in USDC 6-decimal view (${fee.feeUsdcRaw} raw)`)
  if (usdcBal === 0n) {
    console.log('\nWallet has no USDC. Fund it from the faucet, then re-run.')
  }

  if (usdcBal > 0n && want('send')) {
    console.log('Send')
    const recipient = keystore.accountFromMnemonic(keystore.newMnemonic()).address
    const amount = 100_000n // 0.1 USDC
    const hash = await chainLib.sendToken({ chainId, account, token: usdc, to: recipient, amountRaw: amount })
    ok(/^0x[0-9a-f]{64}$/.test(hash), 'send returns a transaction hash', hash)
    const r = await chainLib.waitForReceipt(chainId, hash)
    ok(r.status === 'confirmed', 'receipt confirms the transfer', r)
    const after = await chainLib.readBalances(chainId, recipient)
    ok(after.tokens.USDC === amount, 'recipient balance equals the amount sent', after.tokens.USDC)
    const head = await chainLib.publicClientFor(chainId).getBlockNumber()
    const scan = await chainLib.scanIncoming(chainId, recipient, head - 200n)
    ok(scan.transfers.some((t) => t.hash === hash && t.value === amount && t.token.symbol === 'USDC'), 'incoming transfer is detected from logs')
    let failedAsExpected = false
    try {
      await chainLib.sendToken({ chainId, account, token: usdc, to: recipient, amountRaw: 10n ** 15n })
    } catch {
      failedAsExpected = true
    }
    ok(failedAsExpected, 'sending more than the balance fails before broadcasting')
  }

  const adapter = createLocalAdapter(keystore.privateKeyOf(account))

  if (usdcBal > 2_000_000n && want('swap')) {
    console.log('Swap (USDC to EURC)')
    const quote = await swapSvc.quoteSwap(adapter, 'USDC', 'EURC', '1', 100)
    console.log('       quote:', quote.estimatedOut, 'EURC, min', quote.minimumOut, 'impact', quote.priceImpactPct.toFixed(3), '%')
    ok(Number(quote.estimatedOut) > 0, 'live quote returns an output amount')
    ok(Number(quote.minimumOut) <= Number(quote.estimatedOut), 'minimum received is not above the estimate')
    const out = await swapSvc.executeSwap(adapter, 'USDC', 'EURC', '1', 100)
    ok(/^0x[0-9a-f]{64}$/.test(out.txHash), 'swap returns a transaction hash', out)
    const r = await chainLib.waitForReceipt(chainId, out.txHash as `0x${string}`)
    ok(r.status === 'confirmed', 'swap transaction confirms', r)
    const after = await chainLib.readBalances(chainId, account.address)
    ok((after.tokens.EURC ?? 0n) > (b.tokens.EURC ?? 0n), 'EURC balance increased after the swap')
  }

  if (usdcBal > 3_000_000n && want('bridge')) {
    console.log('Bridge (Arc Testnet to Base Sepolia)')
    const est = await bridgeSvc.estimateBridge(adapter, chainId, 84532, '1')
    console.log('       estimate:', JSON.stringify({ fees: est.usdcFees, receive: est.youReceive, gas: est.gas }))
    ok(Number(est.youReceive) > 0 && Number(est.youReceive) <= 1, 'bridge estimate returns fee and amount received')
    const steps: string[] = []
    const out = await bridgeSvc.executeBridge(adapter, chainId, 84532, '1', (s) => steps.push(`${s.name}:${s.state}`))
    console.log('       steps:', steps.join(', '))
    ok(out.state === 'success', 'bridge completes', out.error ?? out.state)
    ok(Boolean(out.sourceTxHash), 'source burn transaction recorded', out.sourceTxHash)
    const dest = await chainLib.readBalances(84532, account.address)
    ok((dest.tokens.USDC ?? 0n) > 0n, 'USDC arrived on Base Sepolia', dest.tokens.USDC)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
