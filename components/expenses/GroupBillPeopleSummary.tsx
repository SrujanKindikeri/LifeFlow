'use client'

/**
 * GroupBillPeopleSummary.tsx
 *
 * Displays a per-person aggregated balance summary across all of the
 * authenticated user's Group Bills.
 *
 * DESIGN
 * ──────
 * Follows the existing LifeFlow Liquid Glass / Apple-style design system.
 * Uses GlassCard, GlassButton, and existing CSS variables — no new design tokens.
 *
 * LAYOUT
 * ──────
 * Desktop : overview strip + cards in 2-col grid
 * Tablet  : 1-col grid
 * Mobile  : stacked single-col cards, no horizontal overflow
 *
 * INTERACTION
 * ───────────
 * Clicking a person card expands a drill-down list of contributing bills.
 * "Owes You" cards are green-tinted, "You Owe" are red-tinted, "Settled" are neutral.
 * "View Bills" button fires the onSelectBill callback so the parent can navigate
 * to the specific Group Bill detail view.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  ChevronDown,
  ChevronUp,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Link as LinkIcon,
  RefreshCw,
  Receipt,
  BellRing,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  SendReminderModal,
  type SendReminderPersonInfo,
} from '@/components/expenses/SendReminderModal'

// ─── Types (mirrors API response, kept local to avoid server/client coupling) ─

interface PersonBillEntry {
  billId:         string
  billName:       string
  billDate:       string
  currency:       string
  owesYouAmount:  number
  youOweAmount:   number
  settledAmount:  number
  fullySettled:   boolean
}

interface PersonSummary {
  key:                  string
  displayName:          string
  billCount:            number
  totalOwesYou:         number
  totalYouOwe:          number
  netBalance:           number
  totalSettled:         number
  direction:            'owes_you' | 'you_owe' | 'settled'
  bills:                PersonBillEntry[]
  latestBillDate:       string
  oldestUnpaidBillDate: string | null
  personId:             string | null
  linkedLifeFlowId:     string | null
  isLinkedToPeople:     boolean
  hasEmail:             boolean
}

interface Overview {
  totalPeopleWithBalance:      number
  totalOutstandingOwedToYou:   number
  totalOutstandingYouOwe:      number
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface GroupBillPeopleSummaryProps {
  /** Called when the user clicks "View Bill" on a drill-down entry. */
  onSelectBillById: (billId: string) => void
}

// ─── Currency helpers ─────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
}

function sym(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency
}

function fmtMoney(amount: number, currency = 'INR'): string {
  const s = sym(currency)
  return `${s}${Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GroupBillPeopleSummary({ onSelectBillById }: GroupBillPeopleSummaryProps) {
  const [people,   setPeople]   = useState<PersonSummary[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // ── Send Reminder modal state ──────────────────────────────────────────────
  const [reminderPerson, setReminderPerson] = useState<SendReminderPersonInfo | null>(null)

  // ── Sender UPI — fetched once from /api/auth/me on mount ──────────────────
  // Used only to display payment info in the Send Reminder modal UX.
  // The backend independently re-reads it from the DB when sending.
  const [senderUpiId, setSenderUpiId] = useState<string | null>(null)

  const { error: toastError } = useToast()

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/group-bills/people-summary')
      if (!res.ok) throw new Error('Failed to fetch people summary')
      const data = await res.json() as { people: PersonSummary[]; overview: Overview }
      setPeople(data.people ?? [])
      setOverview(data.overview ?? null)
    } catch {
      toastError('Failed to load people summary')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  // Fetch sender UPI once — the /api/auth/me response already includes upiId
  // because we added it to the PROFILE_GET_PROJECTION.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (!res.ok) return
        const data = await res.json() as { user?: { upiId?: string | null } }
        setSenderUpiId(data.user?.upiId ?? null)
      } catch {
        // Non-fatal: modal still works, just won't show UPI preview
      }
    })()
  }, [])

  useEffect(() => { void fetchSummary() }, [fetchSummary])

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading people summary">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-2xl p-4 h-24 skeleton" />
        ))}
      </div>
    )
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (people.length === 0) {
    return (
      <EmptyState />
    )
  }

  const withBalance = people.filter((p) => p.direction !== 'settled')
  const settled     = people.filter((p) => p.direction === 'settled')

  // ── All settled state ───────────────────────────────────────────────────────
  if (withBalance.length === 0) {
    return <AllSettledState settled={settled} onRefresh={fetchSummary} />
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Overview strip */}
      {overview && (overview.totalOutstandingOwedToYou > 0 || overview.totalOutstandingYouOwe > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {overview.totalOutstandingOwedToYou > 0 && (
            <GlassCard padding="sm">
              <div className="flex items-center gap-1.5 mb-1 text-emerald-600">
                <ArrowDownLeft size={14} />
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Owed to You
                </span>
              </div>
              <p className="text-sm font-bold tabular-nums text-emerald-600">
                {fmtMoney(overview.totalOutstandingOwedToYou)}
              </p>
            </GlassCard>
          )}
          {overview.totalOutstandingYouOwe > 0 && (
            <GlassCard padding="sm">
              <div className="flex items-center gap-1.5 mb-1 text-rose-600">
                <ArrowUpRight size={14} />
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  You Owe
                </span>
              </div>
              <p className="text-sm font-bold tabular-nums text-rose-600">
                {fmtMoney(overview.totalOutstandingYouOwe)}
              </p>
            </GlassCard>
          )}
        </div>
      )}

      {/* Section: Owes You */}
      {withBalance.filter((p) => p.direction === 'owes_you').length > 0 && (
        <Section
          label="Owes You"
          icon={<ArrowDownLeft size={13} className="text-emerald-600" />}
          accent="text-emerald-600"
        >
          {withBalance
            .filter((p) => p.direction === 'owes_you')
            .map((person) => (
              <PersonCard
                key={person.key}
                person={person}
                expanded={expandedKey === person.key}
                onToggleExpand={() =>
                  setExpandedKey((prev) => (prev === person.key ? null : person.key))
                }
                onSelectBill={onSelectBillById}
                onSendReminder={setReminderPerson}
              />
            ))}
        </Section>
      )}

      {/* Section: You Owe */}
      {withBalance.filter((p) => p.direction === 'you_owe').length > 0 && (
        <Section
          label="You Owe"
          icon={<ArrowUpRight size={13} className="text-rose-600" />}
          accent="text-rose-600"
        >
          {withBalance
            .filter((p) => p.direction === 'you_owe')
            .map((person) => (
              <PersonCard
                key={person.key}
                person={person}
                expanded={expandedKey === person.key}
                onToggleExpand={() =>
                  setExpandedKey((prev) => (prev === person.key ? null : person.key))
                }
                onSelectBill={onSelectBillById}
                onSendReminder={setReminderPerson}
              />
            ))}
        </Section>
      )}

      {/* Section: Settled (collapsed by default) */}
      {settled.length > 0 && (
        <SettledSection
          people={settled}
          expandedKey={expandedKey}
          onToggleExpand={(key) =>
            setExpandedKey((prev) => (prev === key ? null : key))
          }
          onSelectBill={onSelectBillById}
        />
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          onClick={() => void fetchSummary()}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg glass transition-colors hover:bg-black/[0.04]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Refresh people summary"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      {/* Send Reminder modal — rendered at root so it escapes card stacking context */}
      <SendReminderModal
        isOpen={reminderPerson !== null}
        onClose={() => setReminderPerson(null)}
        person={reminderPerson ?? {
          key: '', displayName: '', netBalance: 0,
          billCount: 0, currency: 'INR',
          hasLinkedAccount: false, hasEmail: false,
        }}
        senderUpiId={senderUpiId}
      />
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  label,
  icon,
  accent,
  children,
}: {
  label:    string
  icon:     React.ReactNode
  accent:   string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('flex items-center gap-1.5', accent)}>
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Person card ──────────────────────────────────────────────────────────────

function PersonCard({
  person,
  expanded,
  onToggleExpand,
  onSelectBill,
  onSendReminder,
}: {
  person:          PersonSummary
  expanded:        boolean
  onToggleExpand:  () => void
  onSelectBill:    (billId: string) => void
  /** Called when the user clicks "Send Reminder". Absent on settled cards. */
  onSendReminder?: (info: SendReminderPersonInfo) => void
}) {
  const isOwesYou  = person.direction === 'owes_you'
  const isYouOwe   = person.direction === 'you_owe'
  const isSettled  = person.direction === 'settled'

  const amtColor = isOwesYou ? 'text-emerald-600'
    : isYouOwe   ? 'text-rose-600'
    : 'text-emerald-600'

  const badgeBg = isOwesYou ? 'bg-emerald-500/10 text-emerald-700'
    : isYouOwe   ? 'bg-rose-500/10 text-rose-700'
    : 'bg-emerald-500/10 text-emerald-700'

  const badgeLabel = isOwesYou ? 'Owes You'
    : isYouOwe   ? 'You Owe'
    : 'Settled'

  const displayAmount = isSettled
    ? person.totalSettled
    : Math.abs(person.netBalance)

  // Currency is per-bill — use first bill's currency for header display
  const currency = person.bills[0]?.currency ?? 'INR'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <GlassCard padding="md" hover className="overflow-hidden">
        {/* Header row */}
        <button
          className="w-full flex items-center gap-3 text-left"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${person.displayName} — ${badgeLabel} ${fmtMoney(displayAmount, currency)}`}
        >
          {/* Avatar */}
          <span
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
              isOwesYou ? 'bg-emerald-500/15 text-emerald-700'
              : isYouOwe ? 'bg-rose-500/15 text-rose-700'
              : 'bg-emerald-500/15 text-emerald-700',
            )}
          >
            {person.displayName[0]?.toUpperCase() ?? '?'}
          </span>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {person.displayName}
              </p>
              {person.isLinkedToPeople && (
                <span
                  className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 shrink-0"
                  title="Linked to People directory"
                >
                  <LinkIcon size={9} />
                  People
                </span>
              )}
              {person.linkedLifeFlowId && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 shrink-0"
                  title={`LifeFlow ID: ${person.linkedLifeFlowId}`}
                >
                  LF
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {person.billCount} bill{person.billCount !== 1 ? 's' : ''}
              </span>
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                  badgeBg,
                )}
              >
                {badgeLabel}
              </span>
            </div>
          </div>

          {/* Amount + toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className={cn('text-base font-bold tabular-nums', amtColor)}>
                {fmtMoney(displayAmount, currency)}
              </p>
              {isSettled && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>settled</p>
              )}
            </div>
            <span style={{ color: 'var(--text-faint)' }}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </div>
        </button>

        {/* Drill-down: bill breakdown */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div
                className="mt-3 pt-3 flex flex-col gap-1"
                style={{ borderTop: '1px solid var(--glass-border)' }}
              >
                {/* Bills list */}
                {person.bills.map((bill) => {
                  const billAmt = isOwesYou
                    ? bill.owesYouAmount
                    : isYouOwe
                      ? bill.youOweAmount
                      : bill.settledAmount

                  return (
                    <div
                      key={bill.billId}
                      className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-black/[0.02] transition-colors"
                    >
                      <Receipt size={12} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                          {bill.billName}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {fmtDate(bill.billDate)}
                          {bill.fullySettled && (
                            <span className="ml-1.5 text-emerald-600">· settled</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            bill.fullySettled ? 'text-emerald-600' : amtColor,
                          )}
                        >
                          {fmtMoney(billAmt, bill.currency)}
                        </span>
                        <GlassButton
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectBill(bill.billId)
                          }}
                          className="text-[10px] px-2 py-1 h-auto"
                          aria-label={`View bill ${bill.billName}`}
                        >
                          View
                        </GlassButton>
                      </div>
                    </div>
                  )
                })}

                {/* Total row */}
                <div
                  className="flex items-center justify-between px-1 pt-2 mt-1"
                  style={{ borderTop: '1px solid var(--glass-border)' }}
                >
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Net across {person.billCount} bill{person.billCount !== 1 ? 's' : ''}
                  </span>
                  <span className={cn('text-sm font-bold tabular-nums', amtColor)}>
                    {isSettled
                      ? fmtMoney(person.totalSettled, currency)
                      : fmtMoney(Math.abs(person.netBalance), currency)}
                  </span>
                </div>

                {/* People link notice */}
                {!person.isLinkedToPeople && (
                  <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--text-faint)' }}>
                    Not linked to People directory
                  </p>
                )}

                {/* Send Reminder button — only for owes_you with outstanding balance */}
                {isOwesYou && person.netBalance > 0 && onSendReminder && (
                  <div className="flex justify-end mt-2 pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
                    <GlassButton
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSendReminder({
                          key:              person.key,
                          displayName:      person.displayName,
                          netBalance:       person.netBalance,
                          billCount:        person.billCount,
                          currency,
                          hasLinkedAccount: Boolean(person.linkedLifeFlowId),
                          hasEmail:         person.hasEmail,
                        })
                      }}
                      className="gap-1.5"
                      aria-label={`Send reminder to ${person.displayName}`}
                    >
                      <BellRing size={12} />
                      Send Reminder
                    </GlassButton>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ─── Settled section (collapsed toggle) ──────────────────────────────────────

function SettledSection({
  people,
  expandedKey,
  onToggleExpand,
  onSelectBill,
}: {
  people:         PersonSummary[]
  expandedKey:    string | null
  onToggleExpand: (key: string) => void
  onSelectBill:   (billId: string) => void
}) {
  const [showSettled, setShowSettled] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <button
        className="flex items-center gap-1.5 text-xs self-start px-2 py-1 rounded-lg glass hover:bg-black/[0.04] transition-colors"
        onClick={() => setShowSettled((v) => !v)}
        aria-expanded={showSettled}
        style={{ color: 'var(--text-muted)' }}
      >
        <CheckCircle2 size={12} className="text-emerald-600" />
        {showSettled ? 'Hide' : 'Show'} settled ({people.length})
        {showSettled ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <AnimatePresence>
        {showSettled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden flex flex-col gap-2"
          >
            {people.map((person) => (
              <PersonCard
                key={person.key}
                person={person}
                expanded={expandedKey === person.key}
                onToggleExpand={() => onToggleExpand(person.key)}
                onSelectBill={onSelectBill}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center">
        <Users size={24} className="text-blue-500" />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          No people in Group Bills
        </p>
        <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--text-muted)' }}>
          Add people to a Group Bill and their balances will appear here.
        </p>
      </div>
    </div>
  )
}

// ─── All settled state ────────────────────────────────────────────────────────

function AllSettledState({
  settled,
  onRefresh,
}: {
  settled:   PersonSummary[]
  onRefresh: () => void
}) {
  const [showSettled, setShowSettled] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 size={24} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-700">All settled!</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            No outstanding Group Bill balances.
          </p>
        </div>
        <GlassButton variant="ghost" size="sm" onClick={onRefresh} className="gap-1.5">
          <RefreshCw size={12} />
          Refresh
        </GlassButton>
      </div>

      {settled.length > 0 && (
        <button
          className="flex items-center gap-1.5 text-xs self-start px-2 py-1 rounded-lg glass hover:bg-black/[0.04] transition-colors"
          onClick={() => setShowSettled((v) => !v)}
          style={{ color: 'var(--text-muted)' }}
        >
          <CheckCircle2 size={11} className="text-emerald-600" />
          {showSettled ? 'Hide' : 'Show'} settled history ({settled.length})
          {showSettled ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      )}

      <AnimatePresence>
        {showSettled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden flex flex-col gap-2"
          >
            {settled.map((person) => (
              <PersonCard
                key={person.key}
                person={person}
                expanded={false}
                onToggleExpand={() => {}}
                onSelectBill={() => {}}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
