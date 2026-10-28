import {
  createNotificationSchema,
  createTransactionSchema,
  notificationListSchema,
  patchTransactionSchema,
  transactionListSchema,
  type NotificationDto,
  type NotificationType,
  type TransactionDto,
  type TxStatus,
  type TxType,
} from '../../shared/schemas'
import { notify, protect } from '../auth'
import { sql } from '../db'
import { ApiError, conflict, created, noContent, notFound, parseBody, parseQuery, type Router } from '../http'
import { paged } from './account'

interface TxRow {
  id: string
  wallet_address: string
  chain_id: number
  dest_chain_id: number | null
  type: TxType
  status: TxStatus
  token_symbol: string
  amount: string
  to_token_symbol: string | null
  to_amount: string | null
  from_address: string
  to_address: string
  tx_hash: string
  dest_tx_hash: string | null
  fee: string | null
  fee_symbol: string | null
  note: string | null
  error: string | null
  created_at: Date
  updated_at: Date
}

const txDto = (t: TxRow): TransactionDto => ({
  id: t.id,
  walletAddress: t.wallet_address,
  chainId: t.chain_id,
  destChainId: t.dest_chain_id,
  type: t.type,
  status: t.status,
  tokenSymbol: t.token_symbol,
  amount: t.amount,
  toTokenSymbol: t.to_token_symbol,
  toAmount: t.to_amount,
  fromAddress: t.from_address,
  toAddress: t.to_address,
  txHash: t.tx_hash,
  destTxHash: t.dest_tx_hash,
  fee: t.fee,
  feeSymbol: t.fee_symbol,
  note: t.note,
  error: t.error,
  createdAt: new Date(t.created_at).toISOString(),
  updatedAt: new Date(t.updated_at).toISOString(),
})

interface NotifRow {
  id: string
  type: NotificationType
  title: string
  body: string
  tx_hash: string | null
  chain_id: number | null
  read: boolean
  created_at: Date
}
const notifDto = (n: NotifRow): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  txHash: n.tx_hash,
  chainId: n.chain_id,
  read: n.read,
  createdAt: new Date(n.created_at).toISOString(),
})


const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Builds the in-app notification for a transaction that has just reached a visible state. */
function txNotice(t: TxRow): { type: NotificationType; title: string; body: string } | null {
  if (t.status === 'pending') return null
  const amt = `${t.amount} ${t.token_symbol}`
  if (t.status === 'failed') {
    return { type: 'failed', title: `${t.type[0]!.toUpperCase()}${t.type.slice(1)} failed`, body: `Your ${t.type} of ${amt} did not complete.${t.error ? ` ${t.error}` : ''}` }
  }
  switch (t.type) {
    case 'send':
      return { type: 'sent', title: `Sent ${amt}`, body: `To ${short(t.to_address)}.` }
    case 'receive':
      return { type: 'received', title: `Received ${amt}`, body: `From ${short(t.from_address)}.` }
    case 'swap':
      return { type: 'swap', title: `Swapped ${amt}`, body: t.to_amount ? `You received ${t.to_amount} ${t.to_token_symbol ?? ''}.` : 'Swap completed.' }
    case 'bridge':
      return { type: 'bridge', title: `Bridged ${amt}`, body: 'Your USDC arrived on the destination network.' }
  }
}

async function notifyForTx(userId: string, t: TxRow) {
  const n = txNotice(t)
  if (n) await notify(userId, n.type, n.title, n.body, { txHash: t.tx_hash, chainId: t.chain_id })
}

export function activityRoutes(r: Router) {
  r.add(
    'GET',
    '/transactions',
    protect(async (ctx) => {
      const q = parseQuery(ctx, transactionListSchema)
      const type = q.type ?? null
      const status = q.status ?? null
      const chainId = q.chainId ?? null
      const total = (
        (await sql`select count(*)::int as n from transactions where user_id = ${ctx.user.id}
          and (${type}::text is null or type = ${type}) and (${status}::text is null or status = ${status})
          and (${chainId}::integer is null or chain_id = ${chainId})`) as { n: number }[]
      )[0]!.n
      const rows = (await sql`select * from transactions where user_id = ${ctx.user.id}
        and (${type}::text is null or type = ${type}) and (${status}::text is null or status = ${status})
        and (${chainId}::integer is null or chain_id = ${chainId})
        order by created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`) as TxRow[]
      return paged(rows.map(txDto), total, q.page, q.pageSize)
    }),
  )

  r.add(
    'GET',
    '/transactions/:id',
    protect(async (ctx) => {
      if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id!)) throw notFound('Transaction not found.')
      const rows = (await sql`select * from transactions where id = ${ctx.params.id!} and user_id = ${ctx.user.id}`) as TxRow[]
      if (!rows[0]) throw notFound('Transaction not found.')
      return txDto(rows[0])
    }),
  )

  r.add(
    'POST',
    '/transactions',
    protect(async (ctx) => {
      const b = await parseBody(ctx, createTransactionSchema)
      const wallet = b.walletAddress.toLowerCase()
      const owns = (await sql`select 1 from wallets where user_id = ${ctx.user.id} and address = ${wallet}`) as unknown[]
      if (owns.length === 0) throw new ApiError(403, 'FORBIDDEN', 'That wallet is not registered to your account.')
      if (b.type === 'bridge' && !b.destChainId) throw new ApiError(400, 'VALIDATION_ERROR', 'Bridge transactions need a destination chain.', { destChainId: 'Required' })
      const hash = b.txHash.toLowerCase()
      const inserted = (await sql`insert into transactions
        (user_id, wallet_address, chain_id, dest_chain_id, type, status, token_symbol, amount, to_token_symbol, to_amount,
         from_address, to_address, tx_hash, dest_tx_hash, fee, fee_symbol, note, error)
        values (${ctx.user.id}, ${wallet}, ${b.chainId}, ${b.destChainId ?? null}, ${b.type}, ${b.status}, ${b.tokenSymbol}, ${b.amount},
         ${b.toTokenSymbol ?? null}, ${b.toAmount ?? null}, ${b.fromAddress.toLowerCase()}, ${b.toAddress.toLowerCase()}, ${hash},
         ${b.destTxHash?.toLowerCase() ?? null}, ${b.fee ?? null}, ${b.feeSymbol ?? null}, ${b.note ?? null}, ${b.error ?? null})
        on conflict (user_id, chain_id, tx_hash, type) do nothing returning *`) as TxRow[]
      if (inserted[0]) {
        await notifyForTx(ctx.user.id, inserted[0])
        return created(txDto(inserted[0]))
      }
      const existing = (await sql`select * from transactions where user_id = ${ctx.user.id} and chain_id = ${b.chainId} and tx_hash = ${hash} and type = ${b.type}`) as TxRow[]
      return txDto(existing[0]!)
    }),
  )

  r.add(
    'PATCH',
    '/transactions/:id',
    protect(async (ctx) => {
      if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id!)) throw notFound('Transaction not found.')
      const b = await parseBody(ctx, patchTransactionSchema)
      const rows = (await sql`select * from transactions where id = ${ctx.params.id!} and user_id = ${ctx.user.id}`) as TxRow[]
      const tx = rows[0]
      if (!tx) throw notFound('Transaction not found.')
      // Final states are immutable: a confirmed or failed record cannot be rewritten.
      if (b.status && tx.status !== 'pending' && b.status !== tx.status) throw conflict('This transaction is already final.', 'TX_FINAL')
      const updated = (await sql`update transactions set
        status = coalesce(${b.status ?? null}::text, status),
        dest_tx_hash = coalesce(${b.destTxHash?.toLowerCase() ?? null}::text, dest_tx_hash),
        to_amount = coalesce(${b.toAmount ?? null}::text, to_amount),
        fee = coalesce(${b.fee ?? null}::text, fee),
        error = coalesce(${b.error ?? null}::text, error),
        updated_at = now()
        where id = ${tx.id} returning *`) as TxRow[]
      if (tx.status === 'pending' && updated[0]!.status !== 'pending') await notifyForTx(ctx.user.id, updated[0]!)
      return txDto(updated[0]!)
    }),
  )

  /* Notifications */
  r.add(
    'GET',
    '/notifications',
    protect(async (ctx) => {
      const q = parseQuery(ctx, notificationListSchema)
      const unreadOnly = q.unreadOnly
      const total = (
        (await sql`select count(*)::int as n from notifications where user_id = ${ctx.user.id} and (${!unreadOnly}::boolean or read = false)`) as { n: number }[]
      )[0]!.n
      const unread = ((await sql`select count(*)::int as n from notifications where user_id = ${ctx.user.id} and read = false`) as { n: number }[])[0]!.n
      const rows = (await sql`select * from notifications where user_id = ${ctx.user.id} and (${!unreadOnly}::boolean or read = false)
        order by created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`) as NotifRow[]
      return { ...paged(rows.map(notifDto), total, q.page, q.pageSize), unreadCount: unread }
    }),
  )

  r.add(
    'POST',
    '/notifications',
    protect(async (ctx) => {
      const b = await parseBody(ctx, createNotificationSchema)
      await notify(ctx.user.id, b.type, b.title, b.body, { txHash: b.txHash?.toLowerCase(), chainId: b.chainId })
      return created({ ok: true })
    }),
  )

  r.add(
    'POST',
    '/notifications/read-all',
    protect(async (ctx) => {
      await sql`update notifications set read = true where user_id = ${ctx.user.id} and read = false`
      return noContent()
    }),
  )

  r.add(
    'POST',
    '/notifications/:id/read',
    protect(async (ctx) => {
      if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id!)) throw notFound('Notification not found.')
      const rows = (await sql`update notifications set read = true where id = ${ctx.params.id!} and user_id = ${ctx.user.id} returning *`) as NotifRow[]
      if (!rows[0]) throw notFound('Notification not found.')
      return notifDto(rows[0])
    }),
  )
}
