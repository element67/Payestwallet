/**
 * Validation schemas shared by the browser and the API server.
 * Every input is validated on both sides with the exact same rules.
 */
import { z } from 'zod'

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
export const DECIMAL_RE = /^\d{1,18}(\.\d{1,18})?$/

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'))

export const PASSWORD_RULES = [
  { id: 'len', label: 'At least 10 characters', test: (p: string) => p.length >= 10 },
  { id: 'lower', label: 'A lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', label: 'An uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'digit', label: 'A number', test: (p: string) => /\d/.test(p) },
  { id: 'symbol', label: 'A symbol (e.g. ! ? # $)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const

export const passwordSchema = z
  .string()
  .max(128, 'Password is too long')
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) {
        ctx.addIssue({ code: 'custom', message: `Password needs: ${rule.label.toLowerCase()}` })
        return
      }
    }
  })

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(60, 'Name is too long')
  .regex(/^[^<>]*$/, 'Name contains invalid characters')

export const addressSchema = z.string().trim().regex(EVM_ADDRESS_RE, 'Enter a valid 0x wallet address')
export const txHashSchema = z.string().trim().regex(TX_HASH_RE, 'Invalid transaction hash')
export const amountSchema = z.string().trim().regex(DECIMAL_RE, 'Invalid amount')
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code')

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
})

export const login2faSchema = z.object({
  challenge: z.string().min(10).max(2000),
  code: totpCodeSchema,
})

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) })
export const logoutSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() })
export const forgotSchema = z.object({ email: emailSchema })
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: passwordSchema,
})

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    hideBalancesDefault: z.boolean().optional(),
    preferredChainId: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const createWalletSchema = z.object({
  address: addressSchema,
  label: z.string().trim().max(40).optional(),
})

export const TX_TYPES = ['send', 'receive', 'swap', 'bridge'] as const
export const TX_STATUSES = ['pending', 'confirmed', 'failed'] as const
export type TxType = (typeof TX_TYPES)[number]
export type TxStatus = (typeof TX_STATUSES)[number]

export const createTransactionSchema = z.object({
  walletAddress: addressSchema,
  chainId: z.number().int().positive(),
  destChainId: z.number().int().positive().optional(),
  type: z.enum(TX_TYPES),
  status: z.enum(TX_STATUSES),
  tokenSymbol: z.string().trim().min(1).max(12),
  amount: amountSchema,
  toTokenSymbol: z.string().trim().min(1).max(12).optional(),
  toAmount: amountSchema.optional(),
  fromAddress: addressSchema,
  toAddress: addressSchema,
  txHash: txHashSchema,
  destTxHash: txHashSchema.optional(),
  fee: z.string().trim().max(40).optional(),
  feeSymbol: z.string().trim().max(12).optional(),
  note: z.string().trim().max(140).optional(),
  error: z.string().trim().max(300).optional(),
})

export type CreateTransactionInput = z.input<typeof createTransactionSchema>

export const patchTransactionSchema = z
  .object({
    status: z.enum(TX_STATUSES).optional(),
    destTxHash: txHashSchema.optional(),
    toAmount: amountSchema.optional(),
    fee: z.string().trim().max(40).optional(),
    error: z.string().trim().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const NOTIFICATION_TYPES = ['sent', 'received', 'failed', 'security', 'login', 'swap', 'bridge'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
export const CLIENT_NOTIFICATION_TYPES = ['sent', 'received', 'failed', 'swap', 'bridge'] as const

export const createNotificationSchema = z.object({
  type: z.enum(CLIENT_NOTIFICATION_TYPES),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(240),
  txHash: txHashSchema.optional(),
  chainId: z.number().int().positive().optional(),
})

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name')
    .max(40, 'Name is too long')
    .regex(/^[^<>]*$/, 'Name contains invalid characters'),
  address: addressSchema,
})

export const totpEnableSchema = z.object({ code: totpCodeSchema })
export const totpDisableSchema = z.object({ password: z.string().min(1).max(128), code: totpCodeSchema })

export const CLIENT_SECURITY_EVENTS = [
  'wallet_created',
  'wallet_imported',
  'pin_set',
  'pin_changed',
  'pin_failed',
  'phrase_viewed',
  'wallet_unlocked',
  'wallet_locked',
] as const
export const clientSecurityEventSchema = z.object({ type: z.enum(CLIENT_SECURITY_EVENTS) })

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export const transactionListSchema = paginationSchema.extend({
  type: z.enum(TX_TYPES).optional(),
  status: z.enum(TX_STATUSES).optional(),
  chainId: z.coerce.number().int().positive().optional(),
})

export const notificationListSchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export interface Paginated<T> {
  data: T[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, string>; requestId?: string }
}

export interface PublicUser {
  id: string
  email: string
  displayName: string
  hideBalancesDefault: boolean
  preferredChainId: number | null
  totpEnabled: boolean
  createdAt: string
}

export interface WalletDto {
  id: string
  address: string
  label: string | null
  createdAt: string
}

export interface TransactionDto {
  id: string
  walletAddress: string
  chainId: number
  destChainId: number | null
  type: TxType
  status: TxStatus
  tokenSymbol: string
  amount: string
  toTokenSymbol: string | null
  toAmount: string | null
  fromAddress: string
  toAddress: string
  txHash: string
  destTxHash: string | null
  fee: string | null
  feeSymbol: string | null
  note: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface NotificationDto {
  id: string
  type: NotificationType
  title: string
  body: string
  txHash: string | null
  chainId: number | null
  read: boolean
  createdAt: string
}

export interface ContactDto {
  id: string
  name: string
  address: string
  createdAt: string
}

export interface SecurityEventDto {
  id: string
  type: string
  ip: string | null
  deviceLabel: string | null
  createdAt: string
}

export interface SessionDto {
  id: string
  deviceLabel: string
  ip: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

export interface AuthSuccess {
  user: PublicUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export type LoginResponse = AuthSuccess | { requires2fa: true; challenge: string }

export const deleteAccountSchema = z.object({ password: z.string().min(1, 'Enter your password').max(128) })
