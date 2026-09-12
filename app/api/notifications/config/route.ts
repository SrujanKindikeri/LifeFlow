/**
 * GET /api/notifications/config
 *
 * Returns safe, public notification configuration for the browser.
 *
 * WHAT IT EXPOSES
 * ───────────────
 * - configured: boolean — whether VAPID push is configured on the server
 * - vapidPublicKey: string | null — the public VAPID key (safe to share)
 *
 * WHAT IT NEVER EXPOSES
 * ─────────────────────
 * - VAPID_PRIVATE_KEY  — server-only, never returned
 * - SMTP credentials
 * - Session secrets
 * - Any other server-only environment variable
 *
 * WHY THIS EXISTS
 * ───────────────
 * NEXT_PUBLIC_* vars are embedded into the JS bundle at build time.
 * On Docker/EC2 deployments the image is built once and the VAPID key is
 * injected at runtime via environment variables.  Fetching from this
 * endpoint at subscribe-time gives us the current runtime value rather
 * than a potentially stale build-time value, and also lets the browser
 * know whether push is properly configured before attempting to subscribe.
 *
 * NO AUTH REQUIRED
 * ────────────────
 * The VAPID public key is not sensitive — it must be shared with the browser
 * to create push subscriptions.  This endpoint is intentionally unauthenticated
 * so it can be called before the user initiates the subscribe flow.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const vapidPublicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? null

  // Only report as configured when BOTH keys are present — the server needs
  // the private key to send push messages; a public-key-only setup is useless.
  const configured = !!(vapidPublicKey && vapidPrivateKey)

  return NextResponse.json(
    {
      configured,
      // Return the public key only; never the private key.
      vapidPublicKey: configured ? vapidPublicKey : null,
    },
    {
      status: 200,
      headers: {
        // 5-minute cache — the key rarely changes; short enough that a rotation
        // propagates quickly without hammering the server on every page load.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    }
  )
}
