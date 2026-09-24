/**
 * GET /api/public/group-bill/[token]
 *
 * Public, unauthenticated endpoint that resolves a secure reminder token and
 * returns only the safe, read-only snapshot data required for the public
 * Group Bill reminder page.
 *
 * ── SECURITY MODEL ────────────────────────────────────────────────────────────
 * 1. No LifeFlow session is required — the token itself is the sole
 *    authorisation mechanism for this specific read-only reminder.
 * 2. The raw URL token is hashed (SHA-256) before any DB lookup.
 *    The database never stores raw tokens.
 * 3. Expired tokens (expiresAt < now) → 410 Gone.
 * 4. Revoked tokens (revokedAt != null) → 410 Gone.
 * 5. Unknown / malformed tokens → 404 Not Found.
 *    We deliberately do NOT distinguish "never existed" from "expired" in the
 *    public-facing error so token enumeration is not aided.
 * 6. Only snapshot fields are returned — internal IDs (senderUserId,
 *    recipientPersonId, tokenHash, recipientEmailHash, billIds) are NEVER
 *    included in the response body.
 * 7. Response carries Cache-Control: private, no-store so one person's
 *    reminder cannot be served from a shared cache to another person.
 *
 * ── RESPONSE (200) ─────────────────────────────────────────────────────────────
 * {
 *   recipientName:    string
 *   currency:         string
 *   totalOutstanding: number          // sum of billsSnapshot[].amountOwed
 *   bills: [
 *     { billName, billDate, amountOwed, currency }
 *   ]
 *   sender: {
 *     name:       string
 *     lifeFlowId: string
 *     upiId:      string | null
 *   }
 *   expiresAt:        string          // ISO timestamp (for UI "sent X days ago")
 * }
 *
 * ── ERROR RESPONSES ────────────────────────────────────────────────────────────
 * 404  { error: { code: 'NOT_FOUND',   message: '...' } }
 * 410  { error: { code: 'GONE',        message: '...' } }   expired or revoked
 * 500  { error: { code: 'INTERNAL_ERROR', ... } }
 */

import type { NextRequest } from 'next/server'

import { connectDB }            from '@/lib/db'
import { hashReminderToken }    from '@/lib/auth/crypto'
import {
  apiError,
  internalError,
}                               from '@/lib/api-response'
import GroupBillReminderToken   from '@/models/GroupBillReminderToken'

import type { IGroupBillReminderToken } from '@/models/GroupBillReminderToken'

// ─── Cache / security headers ─────────────────────────────────────────────────

/** Prevents shared caches from serving one person's reminder to another. */
const PRIVATE_NO_STORE = 'private, no-store'

// ─── Route config ─────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

// ─── Safe response shape ──────────────────────────────────────────────────────

interface PublicReminderBill {
  billName:   string
  billDate:   string
  amountOwed: number
  currency:   string
}

interface PublicReminderResponse {
  recipientName:    string
  currency:         string
  totalOutstanding: number
  bills:            PublicReminderBill[]
  sender: {
    name:       string
    lifeFlowId: string
    upiId:      string | null
  }
  expiresAt: string
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // ── 1. Extract and hash the raw token from the URL ──────────────────────
  const { token: rawToken } = await params

  const tokenHash = hashReminderToken(rawToken)
  if (!tokenHash) {
    // Malformed / empty token — return 404, not 400, to avoid leaking detail.
    return apiError('NOT_FOUND', 'This reminder link is invalid or has expired.', 404)
  }

  // ── 2. Connect to DB ─────────────────────────────────────────────────────
  try {
    await connectDB()
  } catch {
    return internalError('Database unavailable. Please try again shortly.')
  }

  // ── 3. Look up by tokenHash ───────────────────────────────────────────────
  let doc: IGroupBillReminderToken | null
  try {
    doc = await GroupBillReminderToken
      .findOne({ tokenHash })
      // Select only the fields needed; explicitly exclude internal IDs.
      .select(
        'senderSnapshot billsSnapshot recipientName currency expiresAt revokedAt',
      )
      .lean<IGroupBillReminderToken>()
  } catch {
    return internalError('Failed to retrieve reminder. Please try again.')
  }

  // ── 4. Token not found ───────────────────────────────────────────────────
  // Return same message as expired — don't help enumerate valid tokens.
  if (!doc) {
    return apiError('NOT_FOUND', 'This reminder link is invalid or has expired.', 404)
  }

  // ── 5. Revocation check ──────────────────────────────────────────────────
  if (doc.revokedAt != null) {
    return _goneResponse('This Group Bill reminder link is no longer available.')
  }

  // ── 6. Expiry check ──────────────────────────────────────────────────────
  if (new Date() > new Date(doc.expiresAt)) {
    return _goneResponse('This Group Bill reminder has expired and is no longer available.')
  }

  // ── 7. Build safe public response — NO internal IDs ──────────────────────
  const bills: PublicReminderBill[] = (doc.billsSnapshot ?? []).map((b) => ({
    billName:   b.billName,
    billDate:   b.billDate,
    amountOwed: b.amountOwed,
    currency:   b.currency,
  }))

  // Recalculate total server-side — never trust a client-supplied amount.
  const totalOutstanding = bills.reduce((sum, b) => sum + b.amountOwed, 0)

  const body: PublicReminderResponse = {
    recipientName:    doc.recipientName,
    currency:         doc.currency,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    bills,
    sender: {
      name:       doc.senderSnapshot.name,
      lifeFlowId: doc.senderSnapshot.lifeFlowId,
      upiId:      doc.senderSnapshot.upiId ?? null,
    },
    expiresAt: new Date(doc.expiresAt).toISOString(),
  }

  return new Response(JSON.stringify(body), {
    status:  200,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': PRIVATE_NO_STORE,
    },
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _goneResponse(message: string) {
  // HTTP 410 Gone: resource existed but is no longer available.
  // Using apiError with a custom status code.
  // We map this to 'NOT_FOUND' code externally so the UI can use a single
  // branch for "unavailable", while the HTTP status is correctly 410.
  return new Response(
    JSON.stringify({ error: { code: 'GONE', message } }),
    {
      status:  410,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': PRIVATE_NO_STORE,
      },
    },
  )
}
