import { migrate, sql } from './db'
import { env } from './env'
import { createFetchHandler, Router } from './http'
import { accountRoutes } from './routes/account'
import { activityRoutes } from './routes/activity'
import { authRoutes } from './routes/auth'
import { securityRoutes } from './routes/security'

await migrate()

const router = new Router()
router.add('GET', '/health', async () => {
  await sql`select 1`
  return { status: 'ok', network: 'testnet' }
})
authRoutes(router)
accountRoutes(router)
activityRoutes(router)
securityRoutes(router)

const handle = createFetchHandler(router)

const server = Bun.serve({
  port: env.port,
  hostname: env.host,
  maxRequestBodySize: 64 * 1024,
  fetch: (req, srv) => handle(req, srv.requestIP(req)?.address),
})

console.log(`[api] Payest Wallet API (testnet) listening on http://${env.host}:${server.port}`)

const shutdown = async () => {
  server.stop()
  await sql.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
