# Deploying Payest Wallet

The frontend (Netlify) and the backend (API plus Postgres) are deployed separately. Netlify only serves static files, so sign-up cannot work until the API is live and the frontend points at it.

## 1. Backend on Render (API + managed Postgres)

Render runs the API as a Docker web service and gives you a managed Postgres database, HTTPS, health checks and secret storage in one Blueprint (`render.yaml`).

1. Push this repository to GitHub.
2. Render dashboard: **New > Blueprint**, choose the repository. It creates `payest-db` (Postgres) and `payest-api`.
3. Fill the variables Render asks for:

| Variable | Value |
|---|---|
| `ALLOWED_ORIGINS` | Your exact Netlify origin, for example `https://your-app.netlify.app` (no trailing slash, no wildcard, https only) |
| `APP_URL` | The same Netlify URL. Used in password reset emails |
| `RESEND_API_KEY` | API key from resend.com |
| `MAIL_FROM` | A sender verified in Resend, for example `Payest Wallet <no-reply@yourdomain.com>` |

Render generates `JWT_ACCESS_SECRET` and `TOTP_ENC_KEY` itself and injects `DATABASE_URL`. Never rotate `TOTP_ENC_KEY` after users enable 2FA.

4. Tables are created automatically: the API applies its migrations every time it boots (`schema_migrations` records them). Check the deploy log for `[db] applied migration`.
5. Open `https://<your-api>.onrender.com/api/health`. It must return `{"status":"ok","network":"testnet"}`, which also proves the database connection.

The API refuses to start in production with mock email, localhost or wildcard origins, or missing secrets, so a misconfiguration fails loudly at boot instead of silently.

### Rate limiting behind a proxy
`TRUST_PROXY=true` and `TRUST_PROXY_HOPS=1` make the API read the client IP from the last `X-Forwarded-For` entry added by the host. After your first sign-in, open Settings > Security log: the IP shown must be your own. If it is a Render or Cloudflare address, raise `TRUST_PROXY_HOPS` to 2. Never set `TRUST_PROXY=true` when the API is reachable without a proxy.

## 2. Frontend on Netlify

1. Site configuration > Environment variables: `VITE_API_BASE_URL` = `https://<your-api>.onrender.com/api`
2. Redeploy (the value is read at build time).
3. Site configuration > Access control must be **Open**. If visitors must log in to Netlify, every request, including `/api`, is answered with a Netlify login page and HTTP 401.

## 3. Verify the live deployment

```
LIVE_API_URL=https://<your-api>.onrender.com/api \
LIVE_APP_ORIGIN=https://your-app.netlify.app \
bun run test:live
```

It registers a throwaway user, checks CORS, public and protected routes, refresh rotation, wallet storage, forgot-password and logout, then deletes the user again (`DELETE /api/me`). Nothing sensitive is printed.

## Other hosts
Any host that runs the Dockerfile and provides Postgres works (Railway, Fly.io). Set the same variables. For an external Postgres add `?sslmode=require` to `DATABASE_URL`.
