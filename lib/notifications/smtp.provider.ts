/**
 * lib/notifications/smtp.provider.ts — SMTP email provider.
 *
 * Activated when: EMAIL_PROVIDER=smtp
 *
 * Required environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD (or SMTP_PASS), EMAIL_FROM
 *
 * Works with any SMTP relay: Gmail, AWS SES, Azure Communication Services,
 * Brevo, Mailgun, Postfix, or any standard SMTP server.
 * Not tied to any specific provider — configure via env vars.
 *
 * Security:
 *   - SMTP credentials are read from environment variables only.
 *   - Credentials are NEVER logged — only safe diagnostics (host, port,
 *     recipient, messageId, errorCode) appear in log output.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NotificationProvider, EmailMessage, EmailResult } from './index'
import logger from '@/lib/logger'

/**
 * Validate that all required SMTP environment variables are present.
 * Throws with a clear message if any are missing.
 */
function getSmtpConfig(): {
  host: string
  port: number
  user: string
  smtpAuth: { user: string; pass: string }
  from: string
} {
  const host = process.env.SMTP_HOST ?? ''
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
  const user = process.env.SMTP_USER ?? ''
  const credential = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? ''
  const from = process.env.EMAIL_FROM ?? 'noreply@lifeflow.app'

  if (!host) throw new Error('[SMTP] SMTP_HOST environment variable is required')
  if (!user) throw new Error('[SMTP] SMTP_USER environment variable is required')
  if (!credential) throw new Error('[SMTP] SMTP_PASSWORD environment variable is required')

  return {
    host,
    port,
    user,
    smtpAuth: { user, pass: credential },  // passed directly to nodemailer, never logged
    from,
  }
}

export class SmtpProvider implements NotificationProvider {
  constructor() {
    // Validate configuration at construction time so misconfigured deployments
    // fail loudly on startup rather than silently on first send.
    getSmtpConfig()
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    // Re-read config on each send so hot-reloaded env vars are picked up.
    const cfg = getSmtpConfig()

    try {
      const nodemailer = await import('nodemailer' as any)

      const transporter = nodemailer.default.createTransport({
        host:   cfg.host,
        port:   cfg.port,
        secure: cfg.port === 465,   // implicit TLS on 465, STARTTLS on 587
        auth:   cfg.smtpAuth,        // credentials — never referenced in logger calls below
      })

      const info = await transporter.sendMail({
        from:    message.from ?? cfg.from,
        to:      message.to,
        subject: message.subject,
        text:    message.text,
        html:    message.html,
      })

      logger.info('[SMTP] Message accepted', {
        provider:  'smtp',
        recipient: message.to,
        smtpHost:  cfg.host,
        smtpPort:  cfg.port,
        messageId: info.messageId,
      })

      return { ok: true, messageId: info.messageId }
    } catch (err) {
      // Extract safe diagnostics — SMTP credentials are NEVER included here.
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorCode    = (err as any)?.code ?? (err as any)?.responseCode ?? undefined

      logger.error('[SMTP] Delivery failed', {
        provider: 'smtp',
        to: message.to,
        smtpHost: cfg.host,
        smtpPort: cfg.port,
        errorMessage,
        errorCode,
      })

      // Return a sanitised error — never expose raw SMTP errors to callers
      // that might surface them in browser responses.
      return { ok: false, error: 'SMTP delivery failed' }
    }
  }
}
