import {
  contactSchema,
  createWalletSchema,
  paginationSchema,
  deleteAccountSchema,
  updateProfileSchema,
  type ContactDto,
  type Paginated,
  type WalletDto,
} from '../../shared/schemas'
import { findUserById, protect, toPublicUser } from '../auth'
import { sql } from '../db'
import { verifyPassword } from '../security'
import { ApiError, conflict, created, noContent, notFound, parseBody, parseQuery, unauthorized, type Router } from '../http'

export function paged<T>(data: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }
}

interface WalletRow {
  id: string
  address: string
  label: string | null
  created_at: Date
}
const walletDto = (w: WalletRow): WalletDto => ({
  id: w.id,
  address: w.address,
  label: w.label,
  createdAt: new Date(w.created_at).toISOString(),
})

interface ContactRow {
  id: string
  name: string
  address: string
  created_at: Date
}
const contactDto = (c: ContactRow): ContactDto => ({
  id: c.id,
  name: c.name,
  address: c.address,
  createdAt: new Date(c.created_at).toISOString(),
})

export function accountRoutes(r: Router) {
  r.add(
    'GET',
    '/me',
    protect(async (ctx) => {
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      return { user: toPublicUser(user) }
    }),
  )

  r.add(
    'PATCH',
    '/me',
    protect(async (ctx) => {
      const body = await parseBody(ctx, updateProfileSchema)
      await sql`update users set
        display_name = coalesce(${body.displayName ?? null}::text, display_name),
        hide_balances_default = coalesce(${body.hideBalancesDefault ?? null}::boolean, hide_balances_default),
        preferred_chain_id = coalesce(${body.preferredChainId ?? null}::integer, preferred_chain_id),
        updated_at = now()
        where id = ${ctx.user.id}`
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      return { user: toPublicUser(user) }
    }),
  )

  /** Permanently deletes the account and all server-side records. The wallet on the device is untouched. */
  r.add(
    'DELETE',
    '/me',
    protect(async (ctx) => {
      const body = await parseBody(ctx, deleteAccountSchema)
      const user = await findUserById(ctx.user.id)
      if (!user) throw unauthorized()
      if (!(await verifyPassword(body.password, user.password_hash))) {
        throw new ApiError(400, 'INVALID_PASSWORD', 'That password is not correct.', { password: 'Incorrect password' })
      }
      await sql`delete from users where id = ${ctx.user.id}`
      return noContent()
    }),
  )

  /* Wallets: public addresses only. Keys and phrases never leave the device. */
  r.add(
    'GET',
    '/wallets',
    protect(async (ctx) => {
      const q = parseQuery(ctx, paginationSchema)
      const total = ((await sql`select count(*)::int as n from wallets where user_id = ${ctx.user.id}`) as { n: number }[])[0]!.n
      const rows = (await sql`select id, address, label, created_at from wallets where user_id = ${ctx.user.id}
        order by created_at asc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`) as WalletRow[]
      return paged(rows.map(walletDto), total, q.page, q.pageSize)
    }),
  )

  r.add(
    'POST',
    '/wallets',
    protect(async (ctx) => {
      const body = await parseBody(ctx, createWalletSchema)
      const address = body.address.toLowerCase()
      // Two screens can register the same address at the same moment, so let the database arbitrate.
      const rows = (await sql`insert into wallets (user_id, address, label) values (${ctx.user.id}, ${address}, ${body.label ?? null})
        on conflict (user_id, address) do nothing
        returning id, address, label, created_at`) as WalletRow[]
      if (rows[0]) return created(walletDto(rows[0]))
      const existing = (await sql`select id, address, label, created_at from wallets where user_id = ${ctx.user.id} and address = ${address}`) as WalletRow[]
      return walletDto(existing[0]!)
    }),
  )

  /* Address book */
  r.add(
    'GET',
    '/contacts',
    protect(async (ctx) => {
      const q = parseQuery(ctx, paginationSchema)
      const total = ((await sql`select count(*)::int as n from contacts where user_id = ${ctx.user.id}`) as { n: number }[])[0]!.n
      const rows = (await sql`select id, name, address, created_at from contacts where user_id = ${ctx.user.id}
        order by lower(name) asc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`) as ContactRow[]
      return paged(rows.map(contactDto), total, q.page, q.pageSize)
    }),
  )

  r.add(
    'POST',
    '/contacts',
    protect(async (ctx) => {
      const body = await parseBody(ctx, contactSchema)
      const address = body.address.toLowerCase()
      const count = ((await sql`select count(*)::int as n from contacts where user_id = ${ctx.user.id}`) as { n: number }[])[0]!.n
      if (count >= 200) throw conflict('You have reached the contact limit.', 'LIMIT_REACHED')
      try {
        const rows = (await sql`insert into contacts (user_id, name, address) values (${ctx.user.id}, ${body.name}, ${address})
          returning id, name, address, created_at`) as ContactRow[]
        return created(contactDto(rows[0]!))
      } catch {
        throw conflict('That address is already in your address book.', 'CONTACT_EXISTS')
      }
    }),
  )

  r.add(
    'PATCH',
    '/contacts/:id',
    protect(async (ctx) => {
      const body = await parseBody(ctx, contactSchema)
      try {
        const rows = (await sql`update contacts set name = ${body.name}, address = ${body.address.toLowerCase()}
          where id = ${ctx.params.id!} and user_id = ${ctx.user.id} returning id, name, address, created_at`) as ContactRow[]
        if (!rows[0]) throw notFound('Contact not found.')
        return contactDto(rows[0])
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw conflict('That address is already in your address book.', 'CONTACT_EXISTS')
      }
    }),
  )

  r.add(
    'DELETE',
    '/contacts/:id',
    protect(async (ctx) => {
      const rows = (await sql`delete from contacts where id = ${ctx.params.id!} and user_id = ${ctx.user.id} returning id`) as unknown[]
      if (rows.length === 0) throw notFound('Contact not found.')
      return noContent()
    }),
  )
}
