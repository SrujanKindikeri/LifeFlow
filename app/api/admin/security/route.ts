/**
 * GET /api/admin/security
 * Security dashboard: login activity, 2FA adoption, session stats.
 * Never exposes passwords, tokens, OTPs, or session secrets.
 */
import { NextResponse }                               from 'next/server'
import { requireAdmin, handleAdminAuthError }         from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import User                                            from '@/models/User'
import AuditLog                                        from '@/models/AuditLog'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const last7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000)

    const [
      userSecurityStats,
      adminLoginFails,
      adminLoginSuccess,
      recentAdminActivity,
    ] = await Promise.all([
      User.aggregate<{
        total: number;
        totpEnabled: number; emailOtpEnabled: number;
        emailVerified: number;
        deletedAccounts: number;
        pendingPasswordReset: number;
      }>([{
        $group: {
          _id: null,
          total:                { $sum: 1 },
          totpEnabled:          { $sum: { $cond: ['$twoFactorEnabled', 1, 0] } },
          emailOtpEnabled:      { $sum: { $cond: ['$emailOtpEnabled',  1, 0] } },
          emailVerified:        { $sum: { $cond: ['$emailVerified',    1, 0] } },
          deletedAccounts:      { $sum: { $cond: [{ $eq: ['$accountStatus', 'deleted'] }, 1, 0] } },
          pendingPasswordReset: {
            $sum: {
              $cond: [
                { $and: [
                  { $ne:  ['$passwordResetTokenHash', null] },
                  { $gt:  ['$passwordResetExpiresAt', new Date()] },
                ]},
                1, 0,
              ],
            },
          },
        },
      }]),

      AuditLog.countDocuments({ action: 'admin_login_failed', createdAt: { $gte: last24h } }),
      AuditLog.countDocuments({ action: 'admin_login',         result: 'success', createdAt: { $gte: last24h } }),

      AuditLog.find({ createdAt: { $gte: last7d } })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('actorName actorRole action result target createdAt')
        .lean(),
    ])

    const s = userSecurityStats[0] ?? {
      total: 0, totpEnabled: 0, emailOtpEnabled: 0,
      emailVerified: 0, deletedAccounts: 0, pendingPasswordReset: 0,
    }

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      users: {
        total:                s.total,
        emailVerified:        s.emailVerified,
        totpEnabled:          s.totpEnabled,
        emailOtpEnabled:      s.emailOtpEnabled,
        eitherTwoFaEnabled:   s.totpEnabled + s.emailOtpEnabled,  // may overlap
        deletedAccounts:      s.deletedAccounts,
        pendingPasswordReset: s.pendingPasswordReset,
      },
      adminActivity: {
        loginFailuresLast24h:  adminLoginFails,
        loginSuccessesLast24h: adminLoginSuccess,
      },
      recentActivity: recentAdminActivity.map((log) => ({
        actorName: (log as { actorName: string }).actorName,
        actorRole: (log as { actorRole: string }).actorRole,
        action:    (log as { action:    string }).action,
        result:    (log as { result:    string }).result,
        target:    (log as { target:    unknown }).target,
        at:        (log as { createdAt: Date }).createdAt?.toISOString(),
      })),
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
