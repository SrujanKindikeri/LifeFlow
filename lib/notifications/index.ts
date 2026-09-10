/**
 * lib/notifications/index.ts — Provider-neutral notification service.
 *
 * Application code calls:
 *   const notifier = await getNotificationService()
 *   await notifier.send({ to, subject, text, html })
 *
 * The provider is selected via EMAIL_PROVIDER:
 *   none     — no emails (default; in-app notifications only via Notification model)
 *   resend   — Resend.com  (EMAIL_API_KEY required)
 *   sendgrid — SendGrid    (EMAIL_API_KEY required)
 *   smtp     — SMTP relay  (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS required)
 *
 * In-app notifications (the Notification Mongoose model) are always created
 * by the business logic layer — this service is only for EMAIL delivery.
 */

export interface EmailMessage {
  /** Recipient email address */
  to: string
  /** Email subject line */
  subject: string
  /** Plain-text body */
  text: string
  /** Optional HTML body */
  html?: string
  /** Sender address (defaults to EMAIL_FROM env var or noreply@lifeflow.app) */
  from?: string
}

export interface EmailResult {
  ok: boolean
  messageId?: string
  error?: string
}

export interface NotificationProvider {
  send(message: EmailMessage): Promise<EmailResult>
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: NotificationProvider | null = null

export async function getNotificationService(): Promise<NotificationProvider> {
  if (_instance) return _instance

  const provider = (process.env.EMAIL_PROVIDER ?? 'none').toLowerCase()

  switch (provider) {
    case 'resend': {
      const { ResendProvider } = await import('./resend.provider')
      _instance = new ResendProvider()
      break
    }
    case 'sendgrid': {
      const { SendGridProvider } = await import('./sendgrid.provider')
      _instance = new SendGridProvider()
      break
    }
    case 'smtp': {
      const { SmtpProvider } = await import('./smtp.provider')
      _instance = new SmtpProvider()
      break
    }
    case 'none':
    default: {
      const { NoOpProvider } = await import('./noop.provider')
      _instance = new NoOpProvider()
      break
    }
  }

  return _instance
}

export function resetNotificationService(): void {
  _instance = null
}
