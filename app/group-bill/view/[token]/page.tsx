/**
 * /group-bill/view/[token]
 *
 * Public, read-only Group Bill Reminder page.
 *
 * ── WHAT THIS PAGE IS ──────────────────────────────────────────────────────────
 * A standalone page that the recipient opens directly from their email without
 * signing in to LifeFlow.  It shows ONLY the reminder context that was
 * captured at send time — the sender, their UPI ID, and the recipient's
 * outstanding Group Bills.
 *
 * ── WHAT THIS PAGE IS NOT ─────────────────────────────────────────────────────
 * • Not the authenticated dashboard
 * • Not the Group Bills management page
 * • Not the expenses tab
 * No sidebar, no navigation, no profile, no personal dashboard.
 *
 * ── SECURITY ──────────────────────────────────────────────────────────────────
 * • No requireAuth() — the secure token IS the authorisation.
 * • Data is fetched server-side; no token is forwarded to the browser DOM.
 * • Only snapshot fields are rendered — no internal IDs, no email addresses.
 * • Cache-Control: private, no-store via Next.js export const dynamic.
 * • UPI QR is generated server-side from the authorised snapshot amount and
 *   UPI ID.  The raw UPI payment URI is never logged.
 *
 * ── DATA FLOW ─────────────────────────────────────────────────────────────────
 * URL token → SHA-256 hash → MongoDB lookup → expiry/revocation check
 *   → render snapshot fields OR show expired/invalid state
 *
 * This Server Component queries MongoDB directly (same process as other
 * server-side page.tsx files in this project) rather than making an HTTP
 * request to /api/public/group-bill/[token].  This is the correct App Router
 * pattern and avoids a self-referential HTTP hop.
 *
 * ── UPI PAYMENT QR ────────────────────────────────────────────────────────────
 * The QR code is generated server-side in loadReminder() using the `qrcode`
 * package.  The resulting PNG data-URL is passed as a prop to the client
 * UpiPaymentModal component.  The payment URI encodes only:
 *   pa (UPI ID), pn (payee name), am (amount), cu (INR)
 * No secrets, no internal IDs, no session tokens.
 *
 * The UPI payment URI is also passed as upiDeepLink for the "Open UPI App"
 * button on mobile — it is NOT logged anywhere.
 *
 * Payment completion is NOT tracked here.  Generating or scanning the QR
 * does not mark any bill as paid.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import { connectDB }            from '@/lib/db'
import { hashReminderToken }    from '@/lib/auth/crypto'
import GroupBillReminderToken   from '@/models/GroupBillReminderToken'
import UpiPaymentModal          from '@/components/group-bill/UpiPaymentModal'

import type { IGroupBillReminderToken, IBillSnapshot, ISenderSnapshot } from '@/models/GroupBillReminderToken'

// ─── Next.js cache config ─────────────────────────────────────────────────────
// force-dynamic: never cache this page.  Each request must validate the token.
// private, no-store is enforced by dynamic rendering (no static generation).
export const dynamic = 'force-dynamic'

// ─── Page metadata ────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title:       'Group Bill Reminder — LifeFlow',
  description: 'View your Group Bill reminder.',
  robots:      'noindex, nofollow',   // never index public financial pages
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ReminderState =
  | { status: 'ok';      data: ReminderData }
  | { status: 'expired'; message: string }
  | { status: 'invalid'; message: string }

interface ReminderData {
  recipientName:    string
  currency:         string
  totalOutstanding: number
  bills:            IBillSnapshot[]
  sender:           ISenderSnapshot
  expiresAt:        Date
  /** Base64 PNG data-URL of the UPI QR code, or null if not applicable. */
  upiQrDataUrl:     string | null
  /**
   * UPI deep-link URI for "Open UPI App" on mobile.
   * Null when upiId is absent or amount ≤ 0.
   * Contains only: pa, pn, am, cu — no secrets or internal IDs.
   */
  upiDeepLink:      string | null
}

// ─── UPI URI builder ──────────────────────────────────────────────────────────

/**
 * Build a standard UPI payment URI.
 * Spec: upi://pay?pa=<upiId>&pn=<name>&am=<amount>&cu=INR
 *
 * Returns null when upiId is absent or amount is not a positive finite number.
 * The returned URI must NEVER be logged — it is safe for QR / href only.
 */
function buildUpiUri(
  upiId: string | null,
  payeeName: string,
  amount: number,
  currency: string,
): string | null {
  // Validate pre-conditions (requirement §17)
  if (!upiId || !upiId.trim()) return null
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (currency !== 'INR') return null   // only INR is supported for UPI

  // Round to 2 decimal places to avoid floating-point artefacts in the URI
  const amountStr = (Math.round(amount * 100) / 100).toFixed(2)

  const params = new URLSearchParams()
  params.set('pa', upiId.trim())
  params.set('pn', payeeName.trim())
  params.set('am', amountStr)
  params.set('cu', 'INR')

  return `upi://pay?${params.toString()}`
}

// ─── QR generator ─────────────────────────────────────────────────────────────

/**
 * Generate a QR code PNG as a base64 data-URL from any string.
 * Uses the `qrcode` package (already a production dependency).
 * Returns null on error — the page degrades gracefully without the QR.
 *
 * The upiUri parameter must NOT be logged anywhere in this function.
 */
async function generateQrDataUrl(upiUri: string): Promise<string | null> {
  try {
    const QRCode = await import('qrcode')
    const dataUrl = await QRCode.default.toDataURL(upiUri, {
      width:        280,
      margin:       2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    })
    return dataUrl
  } catch {
    // Non-fatal — the modal still shows UPI ID and Copy/Open buttons
    return null
  }
}

// ─── Data loader ─────────────────────────────────────────────────────────────

async function loadReminder(rawToken: string): Promise<ReminderState> {
  const tokenHash = hashReminderToken(rawToken)
  if (!tokenHash) {
    return { status: 'invalid', message: 'This reminder link is invalid or has expired.' }
  }

  try {
    await connectDB()
  } catch {
    // Treat DB errors the same as invalid — never expose infra details.
    return { status: 'invalid', message: 'Unable to load reminder. Please try again.' }
  }

  let doc: IGroupBillReminderToken | null
  try {
    doc = await GroupBillReminderToken
      .findOne({ tokenHash })
      .select('senderSnapshot billsSnapshot recipientName currency expiresAt revokedAt')
      .lean<IGroupBillReminderToken>()
  } catch {
    return { status: 'invalid', message: 'Unable to load reminder. Please try again.' }
  }

  if (!doc) {
    return { status: 'invalid', message: 'This reminder link is invalid or has expired.' }
  }

  if (doc.revokedAt != null) {
    return { status: 'expired', message: 'This Group Bill reminder is no longer available.' }
  }

  if (new Date() > new Date(doc.expiresAt)) {
    return { status: 'expired', message: 'This Group Bill reminder has expired.' }
  }

  // Recalculate total server-side — never trust a URL parameter.
  const totalOutstanding = Math.round(
    (doc.billsSnapshot ?? []).reduce((sum, b) => sum + b.amountOwed, 0) * 100,
  ) / 100

  // ── UPI QR generation (server-side) ─────────────────────────────────────
  // Amount and UPI ID both come from the immutable snapshot captured at
  // send time.  If the sender changes their UPI ID later, this reminder
  // continues to show the original UPI ID (historical snapshot behaviour).
  const upiUri = buildUpiUri(
    doc.senderSnapshot?.upiId ?? null,
    doc.senderSnapshot?.name  ?? '',
    totalOutstanding,
    doc.currency,
  )

  // Generate QR data-URL server-side — never sent as a raw URI to the client.
  // upiUri must not be logged.
  const upiQrDataUrl = upiUri ? await generateQrDataUrl(upiUri) : null

  // The deep-link is passed to the client for the "Open UPI App" button.
  // It contains only: pa, pn, am, cu — no secrets.
  const upiDeepLink = upiUri ?? null

  return {
    status: 'ok',
    data: {
      recipientName:    doc.recipientName,
      currency:         doc.currency,
      totalOutstanding,
      bills:            doc.billsSnapshot ?? [],
      sender:           doc.senderSnapshot,
      expiresAt:        new Date(doc.expiresAt),
      upiQrDataUrl,
      upiDeepLink,
    },
  }
}

// ─── Currency formatter ───────────────────────────────────────────────────────

function fmtAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  const sym = symbols[currency] ?? currency
  return `${sym}${Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function fmtDate(billDate: string): string {
  try {
    const [y, m, d] = billDate.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch {
    return billDate
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function GroupBillReminderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token: rawToken } = await params
  const result = await loadReminder(rawToken)

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-4 py-10"
      style={{ background: 'var(--bg-base, #F4F5FA)' }}
    >
      {/* ── Brand header ─────────────────────────────────────────────────── */}
      <header className="mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          {/* Lightning bolt logo — matches the email template SVG */}
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, background: '#2563eb' }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="17,4 10,15.5 14.2,15.5 11,24 19.5,12 15,12" fill="#ffffff" />
            </svg>
          </div>
          <span
            className="font-bold tracking-tight"
            style={{ fontSize: 20, color: '#0f172a', letterSpacing: '-0.4px' }}
          >
            LifeFlow
          </span>
        </div>
        <p
          className="uppercase tracking-widest"
          style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em' }}
        >
          Plan. Focus. Achieve.
        </p>
      </header>

      {/* ── Main card ────────────────────────────────────────────────────── */}
      <main
        className="w-full rounded-2xl overflow-hidden"
        style={{
          maxWidth: 520,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        {result.status === 'ok'
          ? <ReminderContent data={result.data} />
          : <UnavailableContent state={result} />
        }
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="mt-8 text-center" style={{ maxWidth: 520 }}>
        <p style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
          This is a read-only Group Bill reminder.
          {' '}
          <Link
            href="/login"
            style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
          >
            Open LifeFlow
          </Link>
          {' '}to manage your bills and mark payments as settled.
        </p>
      </footer>
    </div>
  )
}

// ─── Reminder content (happy path) ────────────────────────────────────────────

function ReminderContent({ data }: { data: ReminderData }) {
  const { recipientName, currency, totalOutstanding, bills, sender, upiQrDataUrl, upiDeepLink } = data
  const firstName = recipientName.split(' ')[0] ?? recipientName
  const formattedAmount = fmtAmount(totalOutstanding, currency)

  return (
    <>
      {/* Card header */}
      <div
        className="px-6 py-5 text-center"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}
      >
        <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>
          Group Bill Reminder
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, lineHeight: 1.3 }}>
          Hi {firstName},
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '6px 0 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#111827' }}>{sender.name}</strong> sent you a Group Bill reminder.
        </p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-5">

        {/* Total outstanding card */}
        <section
          className="rounded-xl p-5 text-center"
          style={{ background: '#fef2f2', border: '1px solid #fecaca' }}
          aria-label="Total outstanding amount"
        >
          <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>
            Total Outstanding
          </p>
          <p style={{ fontSize: 36, fontWeight: 700, color: '#dc2626', margin: 0, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
            {formattedAmount}
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '5px 0 0' }}>
            across {bills.length} bill{bills.length !== 1 ? 's' : ''}
          </p>
        </section>

        {/* Per-bill breakdown */}
        <section aria-label="Outstanding bills">
          <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>
            Your Outstanding Bills
          </p>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid #e5e7eb', background: '#ffffff' }}
          >
            {/* Header row */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: '1fr auto',
                padding: '8px 16px',
                background: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bill</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</span>
            </div>

            {/* Bill rows */}
            {bills.map((bill, idx) => (
              <div
                key={`${bill.billId}-${idx}`}
                className="grid"
                style={{
                  gridTemplateColumns: '1fr auto',
                  padding: '10px 16px',
                  borderBottom: idx < bills.length - 1 ? '1px solid #f3f4f6' : 'none',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p style={{ fontSize: 14, color: '#111827', margin: 0, fontWeight: 500 }}>
                    {bill.billName}
                  </p>
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>
                    {fmtDate(bill.billDate)}
                  </p>
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAmount(bill.amountOwed, bill.currency)}
                </p>
              </div>
            ))}

            {/* Total row */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: '1fr auto',
                padding: '10px 16px',
                background: '#f9fafb',
                borderTop: '2px solid #e5e7eb',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Total</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmtAmount(totalOutstanding, currency)}
              </span>
            </div>
          </div>
        </section>

        {/* ── Pay To + UPI payment section ─────────────────────────────── */}
        <section aria-label="Payment details">
          <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>
            Pay To
          </p>
          <div
            className="rounded-xl"
            style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '16px 20px' }}
          >
            <div className="flex flex-col gap-2">

              {/* Sender name */}
              <div className="flex justify-between items-center">
                <span style={{ fontSize: 12, color: '#6b7280' }}>Name</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', textAlign: 'right' }}>
                  {sender.name}
                </span>
              </div>

              {/* LifeFlow ID */}
              <div className="flex justify-between items-center">
                <span style={{ fontSize: 12, color: '#6b7280' }}>LifeFlow ID</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#4b5563',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {sender.lifeFlowId}
                </span>
              </div>

              {/* UPI ID — only if configured */}
              {sender.upiId ? (
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 12, color: '#6b7280' }}>UPI ID</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#111827',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {sender.upiId}
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', margin: '2px 0 0' }}>
                  UPI not configured — contact {sender.name} for payment details.
                </p>
              )}

              {/* Divider + amount */}
              <div
                style={{ borderTop: '1px solid #d1fae5', paddingTop: 10, marginTop: 4 }}
                className="flex justify-between items-center"
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#15803d' }}>Amount to Pay</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>
                  {formattedAmount}
                </span>
              </div>

            </div>
          </div>

          {/* ── Pay via UPI button / modal ──────────────────────────────── */}
          {/*
            UpiPaymentModal is a 'use client' component.
            All sensitive computation (QR generation, URI building) is done
            above in the Server Component.  Only display-safe values are
            passed as props:
              - formattedAmount  : pre-formatted string, e.g. "₹1,791.40"
              - payeeName        : sender's display name from snapshot
              - upiId            : sender's UPI ID from snapshot (or null)
              - qrDataUrl        : PNG data-URL generated server-side (or null)
              - upiDeepLink      : UPI URI for mobile "Open UPI App" (or null)
              - totalOutstanding : numeric total for zero-check inside modal
          */}
          <div style={{ marginTop: 12 }}>
            <UpiPaymentModal
              formattedAmount={formattedAmount}
              payeeName={sender.name}
              upiId={sender.upiId ?? null}
              qrDataUrl={upiQrDataUrl}
              upiDeepLink={upiDeepLink}
              totalOutstanding={totalOutstanding}
            />
          </div>
        </section>

      </div>
    </>
  )
}

// ─── Unavailable / expired / invalid state ────────────────────────────────────

function UnavailableContent({ state }: { state: { status: 'expired' | 'invalid'; message: string } }) {
  const isExpired = state.status === 'expired'

  return (
    <div
      className="px-6 py-10 flex flex-col items-center text-center gap-4"
      role="alert"
      aria-live="polite"
    >
      {/* Icon */}
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          background: isExpired ? '#fef3c7' : '#fef2f2',
          color:      isExpired ? '#d97706' : '#dc2626',
        }}
        aria-hidden="true"
      >
        {isExpired ? (
          // Clock icon for expired
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        ) : (
          // X-circle icon for invalid
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        )}
      </div>

      {/* Heading */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
          {isExpired ? 'Reminder Expired' : 'Link Unavailable'}
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.6, maxWidth: 340 }}>
          {state.message}
        </p>
      </div>

      {/* Subtle note — does NOT reveal whether the token ever existed */}
      <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, maxWidth: 340, lineHeight: 1.6 }}>
        {isExpired
          ? 'Group Bill reminder links expire after 7 days for your security.'
          : 'If you believe this is an error, please ask the sender to resend the reminder.'}
      </p>

      {/* Optional: open LifeFlow CTA */}
      <Link
        href="/login"
        className="inline-block mt-2 rounded-lg px-6 py-3 font-semibold text-white no-underline"
        style={{ background: '#2563eb', fontSize: 14 }}
      >
        Open LifeFlow
      </Link>
    </div>
  )
}
