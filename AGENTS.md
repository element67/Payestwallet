# Payest Wallet

> Built with Arc Studio

Testnet-only, non-custodial wallet with a real backend.

## Architecture

- `src/` React app. `src/config/app.ts` is the single config for chains, tokens, timing and API.
- `server/` Bun API (Postgres via Bun.sql). Routes in `server/routes/*`. Auth/session logic in `server/auth.ts`.
- `shared/schemas.ts` Zod schemas and DTO types used by both sides.
- Wallet keys: generated in the browser, encrypted with the 6-digit PIN (PBKDF2 600k + AES-GCM) in localStorage (`src/lib/keystore.ts`). The server only ever sees the public address.
- Swap and bridge: Circle App Kit with a viem private-key adapter built from the in-memory key (`src/services`). Swap is Arc Testnet only.
- Fiat (NGN) goes through `FiatProvider` in `src/services/fiat.ts` (mock implementation).
- `src/tracing.ts` redacts first-party `/api/` request and response bodies before they reach the trace panel.

## Run

- Postgres: `docker compose up -d --wait` (or the `payest-pg` container used in the sandbox)
- API: `bun run server` (port 3001, Vite proxies `/api`)
- Tests: `bun run test:api`, `bun run scripts/test-onchain.ts`

## Decisions

- Refresh tokens live in sessionStorage and rotate on every use. Reuse revokes the session family.
- Server creates transaction notifications (sent, received, failed, swap, bridge) when a record is created or settles.
- Password reset email is mocked: the API returns the message to the app when `MAIL_MODE=mock`.
- No smart contracts are authored. Swap and bridge use Circle's audited contracts through App Kit.

## Tests
- Tests use database `payest_test` and API on port 3002 (`bun run server:test`, config in `.env.test`, gitignored). Main API: port 3001, database `payest`.
- Throwaway test wallet on Arc Testnet: 0x7f50A5b307B88472f818Dc32b13D5f397Cb18D81 (phrase kept only in /tmp, never in the repo).
- Public RPC rate-limits (429) occasionally; viem retries handle it.

## Deployment status
- Frontend: Netlify (static). API and Postgres: NOT deployed from Arc Studio (no host integration available). Artifacts: Dockerfile, render.yaml, netlify.toml, docs/DEPLOY.md, `bun run test:live`.
- 401 on the Netlify site came from Netlify site access control (HTML login page) plus no API behind the site, not from the API.
