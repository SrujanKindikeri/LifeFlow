'use client'

/**
 * SendReminderModal.tsx
 *
 * Compact Liquid Glass modal for sending a manual Group Bill reminder to a
 * specific person.  Opened from the PersonCard in GroupBillPeopleSummary.
 *
 * FLOW
 * ────
 * 1. "Checking notification options..." — component probes available channels
 *    via the /api/group-bills/send-reminder-channels endpoint on mount.
 *    (Channels are determined entirely server-side from the PersonSummary data
 *    passed in — no extra round-trip needed; availability is computed locally
 *    from the props.)
 * 2. User selects a channel (App / Email / Both).
 * 3. User clicks "Send Reminder".
 * 4. Shows "Sending..." state with button disabled.
 * 5. Shows result: success / partial success / failure.
 *
 * SECURITY
 * ────────
 * • Only personKey (normalised name), channel, and a client-generated requestId
 *   are sent to the API.  No email addresses, user IDs, or amounts are sent
 *   from the client — all are resolved server-side.
 * • The button is disabled during submission to prevent accidental double-send.
 *   The API also enforces server-side idempotency via the requestId.
 *
 * CHANNEL AVAILABILITY (determined from PersonSummary props)
 * ───────────────────────────────────────────────────────────
 * App channel    → person.linkedLifeFlowId is set (linked to a LifeFlow account)
 * Email channel  → person has an email in the People directory
 * Both           → both of the above
 * Neither        → show "no method available" state
 *
 * NOTE: The server still performs its own authoritative availability check.
 * The modal's availability logic is only for UX — it does not bypass server
 * validation.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  Mail,
  BellRing,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

import { Modal }       from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { cn }          from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderChannel = 'app' | 'email' | 'both'

export interface SendReminderPersonInfo {
  /** Normalised name key (lowercase + trimmed) — sent to the API as personKey. */
  key:              string
  /** Display name shown in the modal header. */
  displayName:      string
  /** Total outstanding amount (always > 0 when the button is shown). */
  netBalance:       number
  /** Number of Group Bills this person appears in. */
  billCount:        number
  /** Currency code for formatting, e.g. "INR". */
  currency:         string
  /**
   * True if the person has a linked LifeFlow account (linkedLifeFlowId set).
   * Determines whether the App channel is offered.
   */
  hasLinkedAccount: boolean
  /**
   * True if the person has an email in the People directory.
   * Determines whether the Email channel is offered.
   */
  hasEmail:         boolean
}

interface SendReminderModalProps {
  isOpen:   boolean
  onClose:  () => void
  person:   SendReminderPersonInfo
}

// ─── Send state ───────────────────────────────────────────────────────────────

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'success'; appSent: boolean; emailSent: boolean }
  | { status: 'error';   message: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
}

function fmtAmount(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency
  return `${sym}${Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Generate a simple UUID v4 without a library dependency. */
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments that don't support randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ─── Channel option component ─────────────────────────────────────────────────

function ChannelOption({
  id,
  value,
  label,
  description,
  icon,
  selected,
  disabled,
  disabledReason,
  onChange,
}: {
  id:             string
  value:          ReminderChannel
  label:          string
  description:    string
  icon:           React.ReactNode
  selected:       boolean
  disabled:       boolean
  disabledReason?: string
  onChange:       (v: ReminderChannel) => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all',
        'border',
        selected && !disabled
          ? 'border-blue-500/40 bg-blue-500/8'
          : 'border-transparent',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-black/[0.03]',
      )}
      style={selected && !disabled ? { background: 'rgba(37,99,235,0.06)' } : undefined}
    >
      <input
        id={id}
        type="radio"
        name="reminder-channel"
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={() => !disabled && onChange(value)}
        className="sr-only"
        aria-describedby={disabled ? `${id}-reason` : undefined}
      />

      {/* Radio dot */}
      <span
        className={cn(
          'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
          selected && !disabled
            ? 'border-blue-500'
            : 'border-gray-300',
        )}
        aria-hidden="true"
      >
        {selected && !disabled && (
          <span className="w-2 h-2 rounded-full bg-blue-500" />
        )}
      </span>

      {/* Icon + text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-secondary)' }}>
            {icon}
          </span>
          <span
            className="text-sm font-medium"
            style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-primary)' }}
          >
            {label}
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
        {disabled && disabledReason && (
          <p
            id={`${id}-reason`}
            className="text-xs mt-0.5 text-amber-600"
          >
            {disabledReason}
          </p>
        )}
      </div>
    </label>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SendReminderModal({
  isOpen,
  onClose,
  person,
}: SendReminderModalProps) {
  const radioGroupId = useId()

  // Determine which channels are available from the person's info
  const canUseApp   = person.hasLinkedAccount
  const canUseEmail = person.hasEmail
  const anyChannel  = canUseApp || canUseEmail

  // Default channel selection: prefer 'both' if available, else the one that is
  const defaultChannel = (): ReminderChannel => {
    if (canUseApp && canUseEmail) return 'both'
    if (canUseApp)                return 'app'
    return 'email'
  }

  const [channel,   setChannel]   = useState<ReminderChannel>(defaultChannel)
  const [sendState, setSendState] = useState<SendState>({ status: 'idle' })

  // requestId is stable per modal open — re-generated on each open so that a
  // second intentional send (close → re-open → send) gets a fresh key.
  const requestIdRef = useRef<string>(uuidv4())

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSendState({ status: 'idle' })
      setChannel(defaultChannel())
      requestIdRef.current = uuidv4()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSend = useCallback(async () => {
    if (sendState.status === 'sending') return

    setSendState({ status: 'sending' })

    try {
      const res = await fetch('/api/group-bills/send-reminder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personKey: person.key,
          channel,
          requestId: requestIdRef.current,
        }),
      })

      const data = await res.json() as {
        appSent?:    boolean
        emailSent?:  boolean
        duplicate?:  boolean
        appError?:   string
        emailError?: string
        error?:      { code: string; message: string }
      }

      if (!res.ok) {
        setSendState({
          status:  'error',
          message: data.error?.message ?? 'Unable to send reminder. Please try again.',
        })
        return
      }

      setSendState({
        status:    'success',
        appSent:   data.appSent   ?? false,
        emailSent: data.emailSent ?? false,
      })
    } catch {
      setSendState({
        status:  'error',
        message: 'Network error. Please check your connection and try again.',
      })
    }
  }, [sendState.status, person.key, channel])

  const isSending = sendState.status === 'sending'
  const isDone    = sendState.status === 'success' || sendState.status === 'error'

  return (
    <Modal
      isOpen={isOpen}
      onClose={isDone || !isSending ? onClose : () => undefined}
      title="Send Group Bill Reminder"
      size="sm"
    >
      <div className="flex flex-col gap-4">

        {/* ── Person summary ──────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: 'var(--glass-surface)', border: '1px solid var(--border)' }}
        >
          {/* Avatar */}
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-emerald-500/15 text-emerald-700"
            aria-hidden="true"
          >
            {person.displayName[0]?.toUpperCase() ?? '?'}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {person.displayName}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {person.billCount} bill{person.billCount !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>
              Outstanding
            </p>
            <p className="text-base font-bold tabular-nums text-emerald-600">
              {fmtAmount(person.netBalance, person.currency)}
            </p>
          </div>
        </div>

        {/* ── Channel selection / states ──────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* No channels available */}
          {!anyChannel && (
            <motion.div
              key="no-channel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200"
            >
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700">
                No notification method is available for this person. Add an email
                address or link their LifeFlow account in the People directory.
              </p>
            </motion.div>
          )}

          {/* Success state */}
          {sendState.status === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-2"
            >
              {sendState.appSent && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <span className="text-sm text-emerald-700 font-medium">
                    In-app notification sent
                  </span>
                </div>
              )}
              {sendState.emailSent && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <span className="text-sm text-emerald-700 font-medium">
                    Email sent
                  </span>
                </div>
              )}
              {!sendState.appSent && channel !== 'email' && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                  <span className="text-sm text-amber-700">
                    In-app notification failed
                  </span>
                </div>
              )}
              {!sendState.emailSent && channel !== 'app' && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                  <span className="text-sm text-amber-700">
                    Email failed
                  </span>
                </div>
              )}
            </motion.div>
          )}

          {/* Error state */}
          {sendState.status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200"
            >
              <XCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700">{sendState.message}</p>
            </motion.div>
          )}

          {/* Channel picker (idle / sending) */}
          {(sendState.status === 'idle' || sendState.status === 'sending') && anyChannel && (
            <motion.div
              key="picker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-1"
              role="radiogroup"
              aria-labelledby={`${radioGroupId}-label`}
            >
              <p
                id={`${radioGroupId}-label`}
                className="text-xs font-semibold uppercase tracking-wide mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Delivery method
              </p>

              <ChannelOption
                id={`${radioGroupId}-app`}
                value="app"
                label="LifeFlow App"
                description="Send an in-app notification to their LifeFlow account."
                icon={<Bell size={13} />}
                selected={channel === 'app'}
                disabled={!canUseApp || isSending}
                disabledReason={!canUseApp ? 'Not linked to a LifeFlow account' : undefined}
                onChange={setChannel}
              />

              <ChannelOption
                id={`${radioGroupId}-email`}
                value="email"
                label="Email"
                description="Send a reminder email with a bill breakdown."
                icon={<Mail size={13} />}
                selected={channel === 'email'}
                disabled={!canUseEmail || isSending}
                disabledReason={!canUseEmail ? 'No email address on file' : undefined}
                onChange={setChannel}
              />

              <ChannelOption
                id={`${radioGroupId}-both`}
                value="both"
                label="Both"
                description="Send an in-app notification and an email."
                icon={<BellRing size={13} />}
                selected={channel === 'both'}
                disabled={!canUseApp || !canUseEmail || isSending}
                disabledReason={
                  !canUseApp && !canUseEmail
                    ? 'Neither channel is available'
                    : !canUseApp
                      ? 'LifeFlow account not linked'
                      : !canUseEmail
                        ? 'No email address on file'
                        : undefined
                }
                onChange={setChannel}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="flex gap-2 justify-end pt-1">
          {!isDone ? (
            <>
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSending}
              >
                Cancel
              </GlassButton>

              <GlassButton
                variant="primary"
                size="sm"
                onClick={() => void handleSend()}
                disabled={!anyChannel || isSending}
                loading={isSending}
                icon={isSending ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
                aria-label={`Send reminder to ${person.displayName}`}
              >
                {isSending ? 'Sending…' : 'Send Reminder'}
              </GlassButton>
            </>
          ) : (
            <GlassButton
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
              Close
            </GlassButton>
          )}
        </div>

      </div>
    </Modal>
  )
}
