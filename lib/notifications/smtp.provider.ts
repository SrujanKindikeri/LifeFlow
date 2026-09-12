/**
 * lib/notifications/smtp.provider.ts — SMTP email provider.
 *
 * Activated when: EMAIL_PROVIDER=smtp
 *
 * Required environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD (or SMTP_PASS), EMAIL_FROM
 *
 * Works with any SMTP relay: Gmail, AWS SES, Azure Communication Services, etc.
 *
 * Install before use: npm install nodemailer
 * For TypeScript types: npm install --save-dev @types/nodemailer
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NotificationProvider, EmailMessage, EmailResult } from './index'
import logger from '@/lib/logger'

export class SmtpProvider implements NotificationProvider {
  private host: string
  private port: number
  private user: string
  private pass: string
  private from: string

  constructor() {
    const host = process.env.SMTP_HOST ?? ''
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
    const user = process.env.SMTP_USER ?? ''
    const pass = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? ''
    const from = process.env.EMAIL_FROM ?? 'noreply@lifeflow.app'

    if (!host) throw new Error('[SMTP] SMTP_HOST environment variable is required')
    if (!user) throw new Error('[SMTP] SMTP_USER environment variable is required')
    if (!pass) throw new Error('[SMTP] SMTP_PASSWORD environment variable is required')

    this.host = host
    this.port = port
    this.user = user
    this.pass = pass
    this.from = from
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const nodemailer = await import('nodemailer' as any)

      const transporter = nodemailer.default.createTransport({
        host:   this.host,
        port:   this.port,
        secure: this.port === 465,
        auth: {
          user: this.user,
          pass: this.pass,
        },
      })

      const info = await transporter.sendMail({
        from:    message.from ?? this.from,
        to:      message.to,
        subject: message.subject,
        text:    message.text,
        html:    message.html,
      })

      logger.info('[SMTP] Message accepted', {
        provider:  'smtp',
        recipient: message.to,
        smtpHost:  this.host,
        smtpPort:  this.port,
        messageId: info.messageId,
      })

      return { ok: true, messageId: info.messageId }
    } catch (err) {
      // Extract safe diagnostics — never log SMTP_PASSWORD or auth credentials
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorCode    = (err as any)?.code ?? (err as any)?.responseCode ?? undefined

      logger.error('[SMTP] Delivery failed', {
        provider:     'smtp',
        recipient:    message.to,
        smtpHost:     this.host,
        smtpPort:     this.port,
        errorMessage,
        errorCode,
      })

      // Return a sanitised error — never expose raw SMTP errors to callers
      // that might forward them to the browser
      return { ok: false, error: 'SMTP delivery failed' }
    }
  }
}
