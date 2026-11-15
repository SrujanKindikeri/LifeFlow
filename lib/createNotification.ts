/**
 * lib/createNotification.ts — Server-side helper for creating in-app notifications
 * for any user (not just the authenticated caller).
 *
 * Use this in Route Handlers when you need to notify a DIFFERENT user
 * (e.g. notify the project owner when a member accepts an invitation).
 *
 * SERVER-ONLY. Never import from client components.
 */

import { connectDB } from '@/lib/db'
import Notification from '@/models/Notification'
import User from '@/models/User'
import type { NotificationType } from '@/models/Notification'
import logger from '@/lib/logger'

export interface CreateNotificationInput {
  /** MongoDB ObjectId string of the recipient */
  userId: string
  title: string
  message: string
  type?: NotificationType
}

/**
 * Create an in-app notification for any user by their userId.
 * Resolves the user's lifeFlowId from the DB so it is always server-derived.
 * Silently returns null on failure — notification creation must never block
 * the primary business action (invitation send, chat message, etc.).
 */
export async function createNotificationForUser(
  input: CreateNotificationInput,
): Promise<boolean> {
  try {
    await connectDB()

    const user = await User.findById(input.userId)
      .select('publicId accountStatus')
      .lean<{ publicId: string; accountStatus?: string } | null>()

    if (!user || (user.accountStatus ?? 'active') !== 'active') {
      return false
    }

    await Notification.create({
      userId:     input.userId,
      lifeFlowId: user.publicId,
      title:      input.title,
      message:    input.message,
      type:       input.type ?? 'project',
    })

    return true
  } catch (err) {
    // Non-fatal: log but never throw — the caller's primary action should
    // not fail because a notification could not be created.
    logger.error('[createNotification] Failed to create notification', {
      userId:       input.userId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
