/**
 * lib/notifications/resend.provider.ts — Resend email provider.
 *
 * Activated when: EMAIL_PROVIDER=resend
 * Required: EMAIL_API_KEY (Resend API key), EMAIL_FROM
 *
 * Install before use: npm install resend
 * Docs: https://resend.com/docs
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NotificationProvider, EmailMessage, EmailResult } from './index'
import logger from '@/lib/logger'

export class ResendProvider implements NotificationProvider {
  private apiKey: string
  private from: string

  constructor() {
    const key  = process.env.EMAIL_API_KEY ?? ''
    const from = process.env.EMAIL_FROM ?? 'noreply@lifeflow.app'

    if (!key) {
      throw new Error('[Resend] EMAIL_API_KEY environment variable is required')
    }

    this.apiKey = key
    this.from   = from
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      // Use an indirect import to prevent Next.js from statically tracing
      // this optional dependency at build time when EMAIL_PROVIDER=smtp.
      // The package is only required at runtime when EMAIL_PROVIDER=resend.
      const pkg = 'resend'
      const { Resend } = await import(/* webpackIgnore: true */ pkg as any)
      const client     = new Resend(this.apiKey)

      const { data, error } = await client.emails.send({
        from:    message.from ?? this.from,
        to:      [message.to],
        subject: message.subject,
        text:    message.text,
        html:    message.html,
      })

      if (error) {
        logger.warn('[Resend] Send failed', { to: message.to, error: error.message })
        return { ok: false, error: error.message }
      }

      return { ok: true, messageId: data?.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('[Resend] Unexpected error', { to: message.to, errorMessage: msg })
      return { ok: false, error: msg }
    }
  }
}
