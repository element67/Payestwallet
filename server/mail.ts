/**
 * Mail providers. "mock" (testnet development only) sends nothing and hands the message back to the caller.
 * "resend" delivers through the Resend HTTPS API. Anything else only has to implement MailProvider.
 */
import { env } from './env'

export interface OutgoingMail {
  to: string
  subject: string
  text: string
  link?: string
}

export interface MailProvider {
  readonly mode: 'mock' | 'resend'
  send(mail: OutgoingMail): Promise<{ delivered: boolean; preview?: OutgoingMail }>
}

export class MockMailProvider implements MailProvider {
  readonly mode = 'mock' as const
  async send(mail: OutgoingMail) {
    return { delivered: false, preview: mail }
  }
}

export class ResendMailProvider implements MailProvider {
  readonly mode = 'resend' as const
  async send(mail: OutgoingMail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    })
    // Never log the response body or the message: both can contain the reset link.
    if (!res.ok) throw new Error(`mail provider rejected the message (HTTP ${res.status})`)
    return { delivered: true }
  }
}

export const mailer: MailProvider = env.mailMode === 'resend' ? new ResendMailProvider() : new MockMailProvider()
