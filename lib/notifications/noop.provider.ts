/**
 * lib/notifications/noop.provider.ts — No-op email provider (default).
 *
 * When EMAIL_PROVIDER=none (or is unset), emails are silently dropped.
 * LifeFlow's in-app Notification model still records notifications — this
 * only affects external email delivery.
 */

import type { NotificationProvider, EmailMessage, EmailResult } from './index'
import logger from '@/lib/logger'

export class NoOpProvider implements NotificationProvider {
  async send(message: EmailMessage): Promise<EmailResult> {
    logger.debug('[Notifications] No-op provider — email not sent', {
      to: message.to,
      subject: message.subject,
    })
    return { ok: true, messageId: 'noop' }
  }
}
