'use client'

/**
 * UpiPaymentModal.tsx
 *
 * Client Component — interactive UPI payment UI for the public Group Bill
 * Reminder page.
 *
 * RESPONSIBILITIES
 * ─────────────────
 * • Renders the "Pay via UPI" button (or "Nothing outstanding" / "UPI not
 *   configured" messages when appropriate).
 * • On button click, shows a modal/drawer with:
 *     - QR code image (pre-generated server-side, passed as a data-URL prop)
 *     - Payment details (payee name, UPI ID, amount)
 *     - "Copy UPI ID" button with confirmation feedback
 *     - "Open UPI App" button (mobile deep-link; gracefully hidden if unsupported)
 *     - "Close" button
 * • Never marks any bill as paid — QR generation ≠ payment completion.
 * • Never logs or exposes the UPI payment URI — only the QR image and
 *   display-safe fields are handled here.
 *
 * SECURITY CONTRACT
 * ──────────────────
 * • The QR data-URL is generated server-side from the authorised snapshot.
 * • The UPI payment URI is passed as a prop only for the "Open UPI App"
 *   deep-link; it contains only pa (UPI ID), pn (payee name), am (amount),
 *   cu (INR) — no secrets, no internal IDs.
 * • Amount is derived server-side; this component never recalculates it.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UpiPaymentModalProps {
  /** Pre-formatted display amount, e.g. "₹1,791.40". Never recalculated here. */
  formattedAmount: string
  /** Sender's display name, e.g. "Kindikeri Srujan Kumar Reddy". */
  payeeName: string
  /**
   * Sender's UPI ID, e.g. "9640404455@upi".
   * Null = UPI not configured for this reminder; show informational message.
   */
  upiId: string | null
  /**
   * QR code as a base64 PNG data-URL generated server-side.
   * Null when upiId is null OR amount ≤ 0 (no payment possible).
   */
  qrDataUrl: string | null
  /**
   * UPI deep-link URI for "Open UPI App" on mobile.
   * e.g. "upi://pay?pa=9640404455%40upi&pn=Kindikeri...&am=1791.40&cu=INR"
   * Null when payment is not possible.
   */
  upiDeepLink: string | null
  /** Raw numeric outstanding amount (used only to decide whether to show button). */
  totalOutstanding: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UpiPaymentModal({
  formattedAmount,
  payeeName,
  upiId,
  qrDataUrl,
  upiDeepLink,
  totalOutstanding,
}: UpiPaymentModalProps) {
  const [open, setOpen]         = useState(false)
  const [copied, setCopied]     = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openBtnRef = useRef<HTMLButtonElement>(null)

  // Detect mobile on mount (for "Open UPI App" button visibility)
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
  }, [])

  // Trap focus inside modal and close on Escape
  useEffect(() => {
    if (!open) return

    // Focus the close button when modal opens
    const timer = setTimeout(() => closeRef.current?.focus(), 50)

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
      // Basic focus trap — Tab cycles within modal
      if (e.key === 'Tab') {
        const modal = document.getElementById('upi-payment-modal')
        if (!modal) return
        const focusable = modal.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last  = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKey)
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden'

    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setOpen(false)
    setCopied(false)
    // Return focus to the trigger button
    setTimeout(() => openBtnRef.current?.focus(), 50)
  }, [])

  async function handleCopyUpi() {
    if (!upiId) return
    try {
      await navigator.clipboard.writeText(upiId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS iframe) — silently fail
    }
  }

  // ── Render: UPI not configured ────────────────────────────────────────────
  if (!upiId) {
    return (
      <div
        className="rounded-xl"
        style={{
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          padding: '14px 18px',
          marginTop: 2,
        }}
        role="status"
        aria-label="UPI payment not configured"
      >
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
          UPI payment is not configured for this reminder.
        </p>
      </div>
    )
  }

  // ── Render: nothing outstanding ───────────────────────────────────────────
  if (totalOutstanding <= 0) {
    return (
      <div
        className="rounded-xl"
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          padding: '14px 18px',
          marginTop: 2,
        }}
        role="status"
        aria-label="No outstanding balance"
      >
        <p style={{ fontSize: 13, color: '#15803d', margin: 0, fontWeight: 500 }}>
          Nothing is currently outstanding.
        </p>
      </div>
    )
  }

  // ── Render: Pay via UPI button + modal ────────────────────────────────────
  return (
    <>
      {/* ── Pay via UPI trigger button ─────────────────────────────────── */}
      <button
        ref={openBtnRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Pay via UPI — ${formattedAmount} to ${payeeName}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '13px 20px',
          background: '#16a34a',
          color: '#ffffff',
          border: 'none',
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '-0.1px',
          transition: 'background 0.15s',
          marginTop: 2,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#15803d')}
        onMouseLeave={e => (e.currentTarget.style.background = '#16a34a')}
      >
        {/* UPI scanner icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h2v2h-2zM18 14h3M14 18h2M18 18h3v3M14 21h2" />
        </svg>
        Pay via UPI
      </button>

      {/* ── Modal backdrop + panel ─────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`UPI payment for ${formattedAmount}`}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',    // drawer from bottom on all screen sizes
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            padding: '0 0 0 0',
          }}
          onClick={e => { if (e.target === e.currentTarget) handleClose() }}
        >
          <div
            id="upi-payment-modal"
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#ffffff',
              borderRadius: '20px 20px 0 0',
              padding: '0 0 env(safe-area-inset-bottom, 20px)',
              boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              maxHeight: '92dvh',
              overflowY: 'auto',
              // Centre on desktop
              // (handled by the flex container on wider viewports)
            }}
          >

            {/* ── Drag handle (cosmetic) ──────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }} aria-hidden="true">
              <div style={{ width: 40, height: 4, background: '#e5e7eb', borderRadius: 99 }} />
            </div>

            {/* ── Header ──────────────────────────────────────────────── */}
            <div style={{ padding: '12px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: 0,
              }}>
                Pay via UPI
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={handleClose}
                aria-label="Close UPI payment panel"
                style={{
                  background: '#f3f4f6',
                  border: 'none',
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6b7280',
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Body ────────────────────────────────────────────────── */}
            <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>

              {/* QR code */}
              {qrDataUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      padding: 16,
                      background: '#ffffff',
                      border: '2px solid #e5e7eb',
                      borderRadius: 16,
                      display: 'inline-flex',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrDataUrl}
                      alt={`UPI payment QR code for ${formattedAmount} payable to ${payeeName}`}
                      width={220}
                      height={220}
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        height: 'auto',
                        // Ensure crisp rendering on high-DPI screens
                        imageRendering: 'pixelated',
                      }}
                      draggable={false}
                    />
                  </div>
                  <p style={{ fontSize: 13, color: '#6b7280', margin: 0, textAlign: 'center' }}>
                    Scan with GPay, PhonePe, Paytm, BHIM, or any UPI app.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    width: 220,
                    height: 220,
                    background: '#f9fafb',
                    border: '2px dashed #e5e7eb',
                    borderRadius: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="QR code unavailable"
                >
                  <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', margin: 0, padding: '0 16px' }}>
                    QR unavailable — use UPI ID below
                  </p>
                </div>
              )}

              {/* Amount badge */}
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 10,
                padding: '8px 20px',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 2px' }}>
                  Amount
                </p>
                <p style={{ fontSize: 26, fontWeight: 700, color: '#dc2626', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {formattedAmount}
                </p>
              </div>

              {/* Payment details card */}
              <div
                style={{
                  width: '100%',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 12,
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>Pay to</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                      {payeeName}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>UPI ID</span>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#111827',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      textAlign: 'right',
                      wordBreak: 'break-all',
                      maxWidth: '60%',
                    }}>
                      {upiId}
                    </span>
                  </div>

                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

                {/* Copy UPI ID */}
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  aria-label={copied ? 'UPI ID copied to clipboard' : `Copy UPI ID ${upiId}`}
                  aria-live="polite"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    width: '100%',
                    padding: '12px 16px',
                    background: copied ? '#f0fdf4' : '#f9fafb',
                    color: copied ? '#15803d' : '#374151',
                    border: `1.5px solid ${copied ? '#86efac' : '#e5e7eb'}`,
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {copied ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      UPI ID copied
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy UPI ID
                    </>
                  )}
                </button>

                {/* Open UPI App — only on mobile, only when deep-link is available */}
                {isMobile && upiDeepLink && (
                  <a
                    href={upiDeepLink}
                    aria-label={`Open UPI app to pay ${formattedAmount} to ${payeeName}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      width: '100%',
                      padding: '12px 16px',
                      background: '#eff6ff',
                      color: '#1d4ed8',
                      border: '1.5px solid #bfdbfe',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Open UPI App
                  </a>
                )}

                {/* Close */}
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close payment panel"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    padding: '12px 16px',
                    background: 'transparent',
                    color: '#9ca3af',
                    border: '1.5px solid #e5e7eb',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  )
}
