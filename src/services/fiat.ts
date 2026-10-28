/**
 * Everything fiat (NGN) goes through FiatProvider. The UI only ever talks to this interface,
 * so a real provider (bank rails, P2P escrow, off-ramp) can replace MockFiatProvider
 * by changing the single `fiatProvider` export. No screen needs to change.
 */
export type FiatFeatureId = 'exchange' | 'p2p' | 'defi' | 'deposit' | 'more'

export interface FiatRate {
  /** Fiat units per 1 USDC. */
  rate: number
  currency: string
  asOf: string
  /** True while the rate is a fixed placeholder, not a market price. */
  isMock: boolean
}

export interface FiatFeature {
  id: FiatFeatureId
  title: string
  description: string
  available: boolean
}

export class FiatUnavailableError extends Error {
  constructor(feature: FiatFeatureId) {
    super(`${feature} is not available yet`)
    this.name = 'FiatUnavailableError'
  }
}

export interface ExchangeQuote {
  usdcAmount: string
  fiatAmount: string
  rate: number
  expiresAt: string
}

export interface DepositInstructions {
  bankName: string
  accountNumber: string
  reference: string
}

export interface FiatProvider {
  readonly id: string
  getRate(): Promise<FiatRate>
  listFeatures(): FiatFeature[]
  /** Crypto to fiat. */
  quoteExchange(usdcAmount: string): Promise<ExchangeQuote>
  /** Fiat funding. */
  getDepositInstructions(userId: string): Promise<DepositInstructions>
}

const MOCK_RATE_NGN_PER_USDC = 1500

export class MockFiatProvider implements FiatProvider {
  readonly id = 'mock'

  getRate(): Promise<FiatRate> {
    return Promise.resolve({ rate: MOCK_RATE_NGN_PER_USDC, currency: 'NGN', asOf: new Date().toISOString(), isMock: true })
  }

  listFeatures(): FiatFeature[] {
    return [
      { id: 'exchange', title: 'Exchange', description: 'Sell USDC and receive Naira in your bank account.', available: false },
      { id: 'p2p', title: 'P2P', description: 'Trade directly with other people with escrow protection.', available: false },
      { id: 'defi', title: 'DeFi', description: 'Earn yield on your stablecoins with audited protocols.', available: false },
      { id: 'deposit', title: 'Deposit NGN', description: 'Fund your wallet from a Nigerian bank account.', available: false },
      { id: 'more', title: 'More', description: 'Bill payments, cards and savings goals are on the way.', available: false },
    ]
  }

  quoteExchange(): Promise<ExchangeQuote> {
    return Promise.reject(new FiatUnavailableError('exchange'))
  }

  getDepositInstructions(): Promise<DepositInstructions> {
    return Promise.reject(new FiatUnavailableError('deposit'))
  }
}

/** Swap this line to plug in a real provider. */
export const fiatProvider: FiatProvider = new MockFiatProvider()
