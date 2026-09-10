/**
 * lib/notifications/sendgrid.provider.ts — SendGrid email provider.
 *
 * Activated when: EMAIL_PROVIDER=sendgrid
 * Required: EMAIL_API_KEY (SendGrid API key), EMAIL_FROM
 *
 * Install before use: npm install @sendgrid/mail
 * Docs: https://docs.sendgrid.com/for-developers/sending-email/quickstart-nodejs
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NotificationProvider, EmailMessage, EmailResult } from './index'
import logger from '@/lib/logger'

export class SendGridProvider implements NotificationProvider {
  private apiKey: string
  private from: string

  constructor() {
    const key  = process.env.EMAIL_API_KEY ?? ''
    const from = process.env.EMAIL_FROM ?? 'noreply@lifeflow.app'

    if (!key) {
      throw new Error('[SendGrid] EMAIL_API_KEY environment variable is required')
    }

    this.apiKey = key
    this.from   = from
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const sgMail = await import('@sendgrid/mail' as any)
      sgMail.default.setApiKey(this.apiKey)

      await sgMail.default.send({
        from:    message.from ?? this.from,
        to:      message.to,
        subject: message.subject,
        text:    message.text,
        html:    message.html,
      })

      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('[SendGrid] Send failed', { to: message.to, errorMessage: msg })
      return { ok: false, error: msg }
    }
  }
}
