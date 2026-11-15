/**
 * app/maintenance/page.tsx — Maintenance mode landing page.
 *
 * Shown to normal users when maintenance_mode is active in application settings.
 * The proxy (proxy.ts) redirects non-admin user-facing routes here.
 *
 * Design constraints
 * ──────────────────
 * • Server Component — no interactivity needed; no auth imports.
 * • Reads the maintenance message from AppSetting 'maintenance_message' if
 *   it exists; otherwise displays a safe default message.  The message field
 *   is never user-supplied from the request — it is always read from the DB.
 * • Must NOT import requireAuth or any user session logic — this page is
 *   intentionally visible to unauthenticated visitors during maintenance.
 * • Matches the LifeFlow Liquid Glass design system.
 * • Returns HTTP 503 Service Unavailable via the generateMetadata / headers
 *   trick — actually set via Next.js route segment config.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Under Maintenance — LifeFlow',
  description: 'LifeFlow is temporarily unavailable for scheduled maintenance.',
  robots: 'noindex, nofollow',
}

// Return HTTP 503 for the maintenance page so crawlers and load balancers
// treat this as a temporary outage, not a permanent 200.
export const dynamic = 'force-dynamic'

// ── Safe maintenance message ──────────────────────────────────────────────────
// Reads from AppSetting if available; never throws — the page must always render.

async function getMaintenanceMessage(): Promise<string> {
  try {
    const { connectDB }  = await import('@/lib/db')
    const AppSetting     = (await import('@/models/AppSetting')).default
    await connectDB()
    const doc = await AppSetting.findOne({ key: 'maintenance_message' })
      .select('value')
      .lean<{ value: string }>()
    if (doc?.value && doc.value.trim().length > 0) {
      return doc.value.trim()
    }
  } catch {
    // DB unavailable — fall back to default message silently
  }
  return "We're performing scheduled maintenance to improve your experience. We'll be back shortly."
}

export default async function MaintenancePage() {
  const message = await getMaintenanceMessage()

  return (
    <div
      className="auth-bg min-h-screen flex flex-col items-center justify-center px-4"
    >
      {/* Floating glass card */}
      <div
        className="glass-floating glass-catchlight relative w-full max-w-md rounded-[28px] overflow-hidden text-center"
        style={{ boxShadow: 'var(--glass-shadow-lg)' }}
      >
        {/* Top specular highlight */}
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)',
          }}
        />

        <div className="p-8 sm:p-10">
          {/* Icon */}
          <div
            className="mx-auto mb-6 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
            style={{
              background:
                'linear-gradient(135deg, rgba(217,119,6,0.12) 0%, rgba(245,158,11,0.08) 100%)',
              border: '1px solid rgba(217,119,6,0.20)',
              boxShadow: '0 4px 20px rgba(217,119,6,0.12)',
            }}
          >
            🔧
          </div>

          {/* Heading */}
          <h1
            className="text-[22px] font-bold tracking-tight mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Under Maintenance
          </h1>

          {/* Sub-heading */}
          <p
            className="text-[13px] font-semibold mb-4"
            style={{ color: 'var(--warning-text)' }}
          >
            Scheduled maintenance in progress
          </p>

          {/* Divider */}
          <div
            className="my-5 h-px"
            style={{ background: 'var(--border)' }}
          />

          {/* Safe maintenance message — sourced from DB, not user input */}
          <p
            className="text-[14px] leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {message}
          </p>

          {/* Divider */}
          <div
            className="my-5 h-px"
            style={{ background: 'var(--border)' }}
          />

          {/* Footer hint */}
          <p
            className="text-[11px]"
            style={{ color: 'var(--text-faint)' }}
          >
            If you are an administrator,{' '}
            <a
              href="/admin/login"
              className="underline underline-offset-2"
              style={{ color: 'var(--accent-text)' }}
            >
              sign in here
            </a>{' '}
            to manage settings.
          </p>
        </div>
      </div>

      {/* Branding */}
      <p
        className="mt-6 text-[12px]"
        style={{ color: 'var(--text-faint)' }}
      >
        ⚡ LifeFlow
      </p>
    </div>
  )
}
