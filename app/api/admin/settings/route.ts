/**
 * GET   /api/admin/settings  — list all app settings with live metadata
 * PATCH /api/admin/settings  — update a single setting value
 *
 * Authorization
 * ─────────────
 * GET:   any authenticated admin (all roles)
 * PATCH: super_admin only — enforced both by role check and readOnly flag
 *
 * After a successful PATCH the in-process settings cache is immediately
 * invalidated so enforcement code (proxy, signup route, scheduler) picks
 * up the new value within the next 30-second TTL window.
 *
 * The confirmed saved document is returned in every successful PATCH
 * response — the UI must display this value, not the value it submitted.
 *
 * Never stores secrets.  Never exposes raw environment variables.
 */
import { NextRequest, NextResponse }                          from 'next/server'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog, hasRole }                             from '@/lib/admin-auth'
import { connectDB }                                          from '@/lib/db'
import AppSetting, { DEFAULT_SETTINGS,
                     validateSettingValue }                   from '@/models/AppSetting'
import { invalidateSettingsCache, countActiveUsers }          from '@/lib/settings'
import { z }                                                  from 'zod'
import logger                                                 from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ── Input schema ──────────────────────────────────────────────────────────────

const updateSchema = z.object({
  key:   z.string().min(1).max(100),
  value: z.string().max(5000),
})

// ── Seed helper ───────────────────────────────────────────────────────────────

/**
 * Upsert default settings on first access.
 * Uses $setOnInsert so existing values are NEVER overwritten.
 */
async function ensureDefaultSettings(): Promise<void> {
  for (const setting of DEFAULT_SETTINGS) {
    await AppSetting.updateOne(
      { key: setting.key },
      { $setOnInsert: setting },
      { upsert: true }
    )
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()
    await ensureDefaultSettings()

    const [settings, activeUserCount] = await Promise.all([
      AppSetting.find().sort({ key: 1 }).lean(),
      countActiveUsers(),
    ])

    // Inject the live build version into the app_version document so the UI
    // always shows the running version, not a stale value from a previous deploy.
    const buildVersion = process.env.npm_package_version ?? '0.1.0'
    const enriched = settings.map((s) => {
      if (s.key === 'app_version') {
        return { ...s, value: buildVersion, readOnly: true }
      }
      return s
    })

    return NextResponse.json({
      settings: enriched,
      meta: {
        activeUserCount,
        buildVersion,
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let actor: Awaited<ReturnType<typeof requireAdmin>> | null = null

  try {
    actor = await requireAdmin()

    if (!hasRole(actor.role, 'super_admin')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only super_admin can modify settings.' } },
        { status: 403 }
      )
    }

    await connectDB()

    const body   = await req.json().catch(() => ({}))
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code:    'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid input.',
          },
        },
        { status: 400 }
      )
    }

    const { key, value } = parsed.data

    // Look up the setting
    const setting = await AppSetting.findOne({ key })
    if (!setting) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Setting '${key}' not found.` } },
        { status: 404 }
      )
    }

    // Block writes to read-only settings
    if (setting.readOnly) {
      return NextResponse.json(
        {
          error: {
            code:    'FORBIDDEN',
            message: `Setting '${key}' is read-only and cannot be modified.`,
          },
        },
        { status: 403 }
      )
    }

    // Type-aware + key-specific validation (includes max_users integer check)
    const validationError = validateSettingValue(key, value, setting.valueType)
    if (validationError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: validationError } },
        { status: 400 }
      )
    }

    // Persist — capture old value for audit
    const oldValue        = setting.value
    setting.value         = value.trim()
    setting.lastChangedBy = actor.adminId
    await setting.save()

    // Immediately invalidate the in-process cache so enforcement code
    // (proxy, signup route, notification scheduler) picks up the new value
    // on the very next request rather than waiting for the 30-second TTL.
    invalidateSettingsCache()

    logger.info('[settings] Setting updated', {
      key,
      oldValue,
      newValue: value,
      actorId:  actor.adminId,
    })

    await writeAuditLog({
      actor,
      action:   'setting_updated',
      result:   'success',
      target:   { type: 'setting', id: key },
      metadata: {
        key,
        oldValue,
        newValue:  value,
        valueType: setting.valueType,
      },
    })

    // Return the confirmed saved document so the UI displays the server value
    return NextResponse.json({ ok: true, setting })
  } catch (err) {
    // Attempt an audit log entry on unexpected failure
    if (actor) {
      await writeAuditLog({
        actor,
        action:   'setting_updated',
        result:   'failure',
        metadata: { errorMessage: err instanceof Error ? err.message : String(err) },
      }).catch(() => undefined)
    }
    return handleAdminAuthError(err)
  }
}
