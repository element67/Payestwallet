import { SQL } from 'bun'
import { env } from './env'

export const sql = new SQL({ url: env.databaseUrl, max: 10, idleTimeout: 30, connectionTimeout: 10 })

const MIGRATIONS: { id: number; name: string; statements: string[] }[] = [
  {
    id: 1,
    name: 'initial schema',
    statements: [
      `create extension if not exists pgcrypto`,
      `create table users (
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        password_hash text not null,
        display_name text not null,
        totp_secret_enc text,
        totp_pending_enc text,
        totp_enabled boolean not null default false,
        totp_last_step bigint,
        failed_logins integer not null default 0,
        lock_count integer not null default 0,
        locked_until timestamptz,
        hide_balances_default boolean not null default false,
        preferred_chain_id integer,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table wallets (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        address text not null,
        label text,
        created_at timestamptz not null default now(),
        unique (user_id, address)
      )`,
      `create table transactions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        wallet_address text not null,
        chain_id integer not null,
        dest_chain_id integer,
        type text not null check (type in ('send','receive','swap','bridge')),
        status text not null check (status in ('pending','confirmed','failed')),
        token_symbol text not null,
        amount text not null,
        to_token_symbol text,
        to_amount text,
        from_address text not null,
        to_address text not null,
        tx_hash text not null,
        dest_tx_hash text,
        fee text,
        fee_symbol text,
        note text,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (user_id, chain_id, tx_hash, type)
      )`,
      `create index transactions_user_created on transactions (user_id, created_at desc)`,
      `create table notifications (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        type text not null,
        title text not null,
        body text not null,
        tx_hash text,
        chain_id integer,
        read boolean not null default false,
        created_at timestamptz not null default now()
      )`,
      `create index notifications_user_created on notifications (user_id, created_at desc)`,
      `create table sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        family_id uuid not null,
        refresh_hash text not null unique,
        user_agent text,
        device_label text not null,
        ip text,
        created_at timestamptz not null default now(),
        family_started_at timestamptz not null default now(),
        last_used_at timestamptz not null default now(),
        expires_at timestamptz not null,
        revoked_at timestamptz,
        revoked_reason text
      )`,
      `create index sessions_user on sessions (user_id, created_at desc)`,
      `create index sessions_family on sessions (family_id)`,
      `create table security_events (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references users(id) on delete cascade,
        type text not null,
        ip text,
        user_agent text,
        device_label text,
        created_at timestamptz not null default now()
      )`,
      `create index security_events_user on security_events (user_id, created_at desc)`,
      `create table contacts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        name text not null,
        address text not null,
        created_at timestamptz not null default now(),
        unique (user_id, address)
      )`,
      `create table password_resets (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        used_at timestamptz,
        created_at timestamptz not null default now()
      )`,
    ],
  },
]

/** Applies pending migrations inside a transaction each. Safe to call on every boot. */
export async function migrate(): Promise<void> {
  await sql`create table if not exists schema_migrations (id integer primary key, name text not null, applied_at timestamptz not null default now())`
  const rows = (await sql`select id from schema_migrations`) as { id: number }[]
  const applied = new Set(rows.map((r) => r.id))
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    await sql.begin(async (tx) => {
      for (const statement of m.statements) await tx.unsafe(statement)
      await tx`insert into schema_migrations (id, name) values (${m.id}, ${m.name})`
    })
    console.log(`[db] applied migration ${m.id}: ${m.name}`)
  }
}
