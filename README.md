# Payest Wallet

A testnet-only crypto wallet. Create or import a wallet on your device, then send, receive, swap and bridge test USDC and EURC. Your account, history, alerts and address book live in a secure backend, while your recovery phrase and keys never leave your device.

Built with [Arc Studio](https://studio.arc.io)

Testnet only. Test tokens have no real value. There is no mainnet support anywhere in the app.

## What you can do

- Sign up, sign in, reset your password, turn on two-factor authentication
- Create a wallet (recovery phrase backup and quiz) or import one, protected by a 6-digit PIN
- See live USDC and EURC balances, with hide/show, pull-to-refresh and auto-refresh
- Send, receive (QR and share), swap and bridge, each confirmed with your PIN
- Browse and filter your transaction history, with explorer links
- In-app notifications, address book, security log with signed-in devices
- Switch between supported testnets: Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji
- Exchange, P2P, DeFi, Deposit NGN and More are shown as "Coming soon"

## Tech stack

- React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query
- viem for wallet keys and chain access, Circle App Kit for swap and bridge
- Bun API server with PostgreSQL, argon2id password hashing, JWT access tokens and rotating refresh tokens
- Zod schemas shared by the browser and the API

## Development

Prerequisites: Bun 1.3 or newer, Docker (for PostgreSQL).

1. Install dependencies: `bun install`
2. Start the database: `bun run db:up`
3. Create `.env` from `.env.example` and fill in the values (see below)
4. Start the API: `bun run server`
5. Start the app: `bun run dev` and open http://localhost:5173

The Vite dev server forwards `/api` requests to the API server.

### Environment variables

Server (required unless noted):

- `DATABASE_URL`: PostgreSQL connection string
- `API_PORT`: API port, defaults to 3001
- `JWT_ACCESS_SECRET`: at least 32 random characters, signs access tokens
- `TOTP_ENC_KEY`: 64 hex characters, encrypts two-factor secrets at rest
- `ALLOWED_ORIGINS`: comma separated browser origins allowed to call the API
- `TRUST_PROXY`: set to `true` when the API sits behind a proxy that sets `X-Forwarded-For`
- `MAIL_MODE`: `mock` returns password reset emails to the app instead of sending them (testnet only)

App (all optional):

- `VITE_API_BASE_URL`: API base path, defaults to `/api`
- `VITE_RPC_ARC_TESTNET`, `VITE_RPC_ETHEREUM_SEPOLIA`, `VITE_RPC_BASE_SEPOLIA`, `VITE_RPC_ARBITRUM_SEPOLIA`, `VITE_RPC_OP_SEPOLIA`, `VITE_RPC_AVALANCHE_FUJI`: HTTPS RPC URL overrides for each testnet
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio, optional elsewhere

### Scripts

- `bun run dev`: start the app
- `bun run server`: start the API (`bun run server:dev` restarts on change)
- `bun run db:up`: start PostgreSQL with Docker
- `bun run check`: lint and typecheck
- `bun run test:api`: end-to-end API tests (API must be running)
- `bun run scripts/test-onchain.ts [keystore|balances|send|swap|bridge|all]`: testnet wallet tests with a throwaway wallet
- `bun run build`: production build is `bunx vite build`

## Getting test tokens

Use the "Get test tokens" button in the app, which opens the Circle faucet.

## Testing

Tests never touch your real database. They run against a separate `payest_test` database served by a second API instance.

1. Create the test database and copy `.env.test` settings from `.env.example` (database URL, `API_PORT=3002`, plus the secrets).
2. Start the test API: `bun run server:test`
3. Run the suites: `bun run test:api`, `bun run test:ui`, `bun run test:ui-security`
4. On-chain suite (needs a funded Arc Testnet wallet whose recovery phrase is in `/tmp/payest-test-mnemonic.txt`): `bun run test:ui-chain`

Run `bun run check` for lint and typecheck.

## Deployment

The API (`server/`) needs Postgres and runs as a normal Bun service, so it is deployed separately from the static frontend. See [docs/DEPLOY.md](docs/DEPLOY.md) for Render (API and managed Postgres) and Netlify (frontend), including every environment variable. Set `VITE_API_BASE_URL` for the frontend build and `ALLOWED_ORIGINS` for the API.
