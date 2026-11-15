'use client'

/**
 * components/support/SupportCenterSection.tsx
 *
 * Support Center section for the user Profile page.
 *
 * Features:
 * - List user's own tickets with status badges and unread counts
 * - Create a new ticket (subject, category, priority, description)
 * - Open a ticket to see the full message thread
 * - Real-time chat via SSE when a support admin is online
 * - Heartbeat keeps presence alive; reconnects on SSE drop
 * - Shows offline/waiting state clearly when no admin is available
 * - Message sending with clientMsgId idempotency
 * - Auto-scroll to newest messages
 * - Accessible: keyboard navigation, ARIA labels, focus management
 */

import {
  useCallback, useEffect, useId, useRef, useState,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HeadphonesIcon, Plus, ArrowLeft, Send, RefreshCw,
  Clock, CheckCircle2, XCircle, AlertTriangle, ChevronDown,
  MessageCircle, Loader2, Wifi, WifiOff, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/support/presence'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: 'account_and_login',           label: 'Account & Login' },
  { value: 'notifications',               label: 'Notifications' },
  { value: 'offline_sync',                label: 'Offline Sync' },
  { value: 'notes_tasks_habits_projects', label: 'Notes, Tasks, Habits & Projects' },
  { value: 'expenses_and_subscriptions',  label: 'Expenses & Subscriptions' },
  { value: 'payments_and_group_bills',    label: 'Payments & Group Bills' },
  { value: 'bugs_and_technical',          label: 'Bugs & Technical Problems' },
  { value: 'other',                       label: 'Other' },
]

const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map(o => [o.value, o.label])
)

type TicketStatus = 'open' | 'waiting_for_admin' | 'waiting_for_user' | 'resolved' | 'closed'

interface TicketSummary {
  _id: string
  subject: string
  category: string
  priority: string
  status: TicketStatus
  assignedToName: string | null
  lastMessageAt: string | null
  userUnreadCount: number
  messageCount: number
  createdAt: string
}

interface Message {
  _id: string
  ticketId: string
  senderId: string
  senderName: string
  senderRole: 'user' | 'admin' | 'system'
  content: string
  createdAt: string
}

interface TicketDetail {
  _id: string
  subject: string
  category: string
  priority: string
  description: string
  status: TicketStatus
  assignedTo: string | null
  assignedToName: string | null
  lastMessageAt: string | null
  userUnreadCount: number
  messageCount: number
  createdAt: string
}

interface PresenceSnapshot {
  userOnline: boolean
  adminOnline: boolean
  onlineAdminNames: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusConfig(status: TicketStatus): { label: string; color: string; bg: string; icon: React.ReactNode } {
  switch (status) {
    case 'open':              return { label: 'Open',              color: 'var(--accent)',       bg: 'var(--accent-dim)',   icon: <MessageCircle size={10} /> }
    case 'waiting_for_admin': return { label: 'Waiting for Admin', color: 'var(--warning)',      bg: 'var(--warning-dim)', icon: <Clock size={10} /> }
    case 'waiting_for_user':  return { label: 'Awaiting Your Reply', color: 'var(--success)',   bg: 'var(--success-dim)', icon: <AlertTriangle size={10} /> }
    case 'resolved':          return { label: 'Resolved',          color: 'var(--success)',      bg: 'var(--success-dim)', icon: <CheckCircle2 size={10} /> }
    case 'closed':            return { label: 'Closed',            color: 'var(--text-muted)',   bg: 'rgba(0,0,0,0.06)',  icon: <XCircle size={10} /> }
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return '#dc2626'
    case 'high':   return '#d97706'
    case 'normal': return 'var(--accent)'
    default:       return 'var(--text-muted)'
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1)   return 'just now'
    if (diffMin < 60)  return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)    return `${diffH}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function formatFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

function generateClientMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ── Main section component ────────────────────────────────────────────────────

interface SupportCenterSectionProps {
  variants?: import('framer-motion').Variants
}

export function SupportCenterSection({ variants }: SupportCenterSectionProps) {
  const panelId   = useId()
  const headerId  = useId()
  const { error: toastError, success } = useToast()

  // Section open/closed (persisted)
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('lf_support_open') === 'true'
    } catch { return false }
  })

  function toggleSection() {
    setIsOpen(prev => {
      const next = !prev
      try { window.localStorage.setItem('lf_support_open', String(next)) } catch {}
      return next
    })
  }

  // View state: list | create | detail
  type View = 'list' | 'create' | 'detail'
  const [view, setView]                     = useState<View>('list')
  const [tickets, setTickets]               = useState<TicketSummary[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketsError, setTicketsError]     = useState<string | null>(null)
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null)
  const [messages, setMessages]             = useState<Message[]>([])
  const [detailLoading, setDetailLoading]   = useState(false)

  // ── Ticket creation form ──────────────────────────────────────────────────
  const [form, setForm] = useState({
    subject: '', category: 'account_and_login', priority: 'normal', description: '',
  })
  const [formErrors, setFormErrors] = useState<Partial<typeof form>>({})
  const [submitting, setSubmitting] = useState(false)

  // ── Chat / messaging ──────────────────────────────────────────────────────
  const [msgInput, setMsgInput]         = useState('')
  const [sending, setSending]           = useState(false)
  const [sendError, setSendError]       = useState<string | null>(null)
  const [presence, setPresence]         = useState<PresenceSnapshot>({
    userOnline: false, adminOnline: false, onlineAdminNames: [],
  })
  const [sseConnected, setSseConnected] = useState(false)
  const [sseError, setSseError]         = useState(false)
  const messagesEndRef                  = useRef<HTMLDivElement>(null)
  const msgInputRef                     = useRef<HTMLTextAreaElement>(null)
  const sseRef                          = useRef<EventSource | null>(null)
  const heartbeatRef                    = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgIdRef                    = useRef<string>('')
  const ticketIdRef                     = useRef<string>('')

  // ── Load tickets ──────────────────────────────────────────────────────────

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true)
    setTicketsError(null)
    try {
      const res = await fetch('/api/support/tickets')
      if (!res.ok) throw new Error('Failed to load tickets')
      const data = await res.json()
      setTickets(data.tickets ?? [])
    } catch (err) {
      setTicketsError(err instanceof Error ? err.message : 'Failed to load tickets')
    } finally {
      setTicketsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && view === 'list') void loadTickets()
  }, [isOpen, view, loadTickets])

  // ── Load ticket detail + messages ─────────────────────────────────────────

  const loadDetail = useCallback(async (id: string, after?: string) => {
    setDetailLoading(true)
    try {
      const url = after
        ? `/api/support/tickets/${id}?after=${encodeURIComponent(after)}`
        : `/api/support/tickets/${id}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load ticket')
      const data = await res.json()
      setSelectedTicket(data.ticket)
      if (after) {
        // Append only new messages after reconnection
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m._id))
          const newMsgs = (data.messages ?? []).filter((m: Message) => !existingIds.has(m._id))
          return [...prev, ...newMsgs]
        })
      } else {
        setMessages(data.messages ?? [])
        if (data.messages?.length > 0) {
          lastMsgIdRef.current = data.messages[data.messages.length - 1]._id
        }
      }
    } catch {
      toastError('Failed to load ticket')
    } finally {
      setDetailLoading(false)
    }
  }, [toastError])

  // ── SSE connection ────────────────────────────────────────────────────────

  const connectSse = useCallback((ticketId: string) => {
    // Close existing connection
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    const es = new EventSource(`/api/support/tickets/${ticketId}/stream?role=user`)
    sseRef.current = es

    es.addEventListener('connect', (e) => {
      try {
        const d = JSON.parse(e.data)
        setSseConnected(true)
        setSseError(false)
        if (d.presence) setPresence(d.presence)
      } catch {}
    })

    es.addEventListener('message', (e) => {
      try {
        const msg: Message = JSON.parse(e.data)
        setMessages(prev => {
          if (prev.some(m => m._id === msg._id)) return prev
          lastMsgIdRef.current = msg._id
          return [...prev, msg]
        })
        // Update ticket unread count locally
        setSelectedTicket(prev => prev ? { ...prev, messageCount: (prev.messageCount || 0) + 1 } : prev)
      } catch {}
    })

    es.addEventListener('presence', (e) => {
      try { setPresence(JSON.parse(e.data)) } catch {}
    })

    es.addEventListener('status', (e) => {
      try {
        const { status } = JSON.parse(e.data)
        setSelectedTicket(prev => prev ? { ...prev, status } : prev)
      } catch {}
    })

    es.addEventListener('ping', () => {
      // keepalive — no action needed
    })

    es.onerror = () => {
      setSseConnected(false)
      setSseError(true)
      // EventSource auto-reconnects; on reconnect load missed messages
      es.addEventListener('connect', async () => {
        setSseError(false)
        setSseConnected(true)
        if (ticketIdRef.current && lastMsgIdRef.current) {
          await loadDetail(ticketIdRef.current, lastMsgIdRef.current)
        }
      }, { once: true })
    }
  }, [loadDetail])

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  function startHeartbeat(ticketId: string) {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(async () => {
      try {
        await fetch('/api/support/presence/heartbeat?role=user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId }),
        })
      } catch {}
    }, HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat() {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }

  // ── Open a ticket ─────────────────────────────────────────────────────────

  async function openTicket(id: string) {
    ticketIdRef.current = id
    lastMsgIdRef.current = ''
    setMessages([])
    setSelectedTicket(null)
    setView('detail')
    setPresence({ userOnline: false, adminOnline: false, onlineAdminNames: [] })
    setSseConnected(false)
    setSseError(false)
    setSendError(null)
    await loadDetail(id)
    connectSse(id)
    startHeartbeat(id)
  }

  // ── Cleanup on leaving detail view ────────────────────────────────────────

  useEffect(() => {
    if (view !== 'detail') {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
      stopHeartbeat()
      setSseConnected(false)
    }
  }, [view])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) { sseRef.current.close() }
      stopHeartbeat()
    }
  }, [])

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // ── Send message ──────────────────────────────────────────────────────────

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault()
    if (!msgInput.trim() || !selectedTicket) return
    if (selectedTicket.status === 'closed') return

    const content     = msgInput.trim()
    const clientMsgId = generateClientMsgId()

    setSending(true)
    setSendError(null)
    setMsgInput('')

    // Optimistic message
    const optimistic: Message = {
      _id:        `opt-${clientMsgId}`,
      ticketId:   selectedTicket._id,
      senderId:   'me',
      senderName: 'You',
      senderRole: 'user',
      content,
      createdAt:  new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket._id}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, clientMsgId }),
      })
      const data = await res.json()

      if (!res.ok) {
        // Remove optimistic message on failure
        setMessages(prev => prev.filter(m => m._id !== optimistic._id))
        setMsgInput(content)
        setSendError(data.error?.message ?? data.error ?? 'Failed to send message')
        return
      }

      // Replace optimistic message with real one
      const real: Message = data.message
      setMessages(prev => prev.map(m => m._id === optimistic._id ? real : m))
      lastMsgIdRef.current = real._id

      // Update local ticket status
      setSelectedTicket(prev => prev ? {
        ...prev,
        messageCount: (prev.messageCount || 0) + 1,
        status: prev.status === 'waiting_for_user' || prev.status === 'open'
          ? 'waiting_for_admin'
          : prev.status,
      } : prev)

    } catch {
      setMessages(prev => prev.filter(m => m._id !== optimistic._id))
      setMsgInput(content)
      setSendError('Network error. Please try again.')
    } finally {
      setSending(false)
      msgInputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  // ── Create ticket ─────────────────────────────────────────────────────────

  function validateForm(): boolean {
    const errors: Partial<typeof form> = {}
    if (!form.subject.trim() || form.subject.trim().length < 5)
      errors.subject = 'Subject must be at least 5 characters'
    if (form.subject.trim().length > 120)
      errors.subject = 'Subject must be under 120 characters'
    if (!form.description.trim() || form.description.trim().length < 10)
      errors.description = 'Description must be at least 10 characters'
    if (form.description.trim().length > 2000)
      errors.description = 'Description must be under 2000 characters'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault()
    // Guard against double-clicks: submitting is set to true before the fetch
    // and only cleared in finally, so a second click while in-flight is a no-op.
    if (submitting) return
    if (!validateForm()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/support/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        // HTTP 429 — rate limited: show how long to wait if server tells us
        if (res.status === 429) {
          const retryAfterSec: number | undefined = data.error?.retryAfter
          const waitMsg = retryAfterSec && retryAfterSec > 0
            ? ` Please wait ${retryAfterSec < 60
                ? `${retryAfterSec} second${retryAfterSec !== 1 ? 's' : ''}`
                : `${Math.ceil(retryAfterSec / 60)} minute${Math.ceil(retryAfterSec / 60) !== 1 ? 's' : ''}`
              } before trying again.`
            : ' Please wait a moment before trying again.'
          toastError(`Too many tickets submitted.${waitMsg}`)
          // Form is preserved — user can retry after the window expires
          return
        }

        // Validation or server error — show the server message, preserve the form
        toastError(data.error?.message ?? 'Failed to submit ticket. Please try again.')
        return
      }

      // Only clear the form and show success after the server confirms persistence
      success('Support ticket submitted. We\'ll respond shortly.')
      setForm({ subject: '', category: 'account_and_login', priority: 'normal', description: '' })
      setFormErrors({})
      // Navigate to the new ticket's detail view
      await openTicket(data.ticket._id)
    } catch {
      // Network / parse failure — preserve the form so the user doesn't lose their work
      toastError('Network error. Your ticket was not submitted. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const chatEnabled =
    selectedTicket &&
    selectedTicket.status !== 'closed' &&
    sseConnected &&
    presence.adminOnline

  const isClosed = selectedTicket?.status === 'closed'

  return (
    <motion.div
      variants={variants}
      className="glass-elevated rounded-2xl overflow-hidden"
      id="support"
    >
      {/* ── Section header ── */}
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggleSection}
        className={cn(
          'w-full flex items-center gap-2 px-5 py-[18px] text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-inset',
          'transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] active:bg-black/[0.04]',
          isOpen && 'border-b',
        )}
        style={isOpen ? { borderColor: 'var(--border)' } : {}}
      >
        <span style={{ color: 'var(--text-muted)' }}><HeadphonesIcon size={14} /></span>
        <h3 className="text-[13px] font-semibold flex-1" style={{ color: 'var(--text-secondary)' }}>
          Support Center
        </h3>
        {/* Unread badge */}
        {!isOpen && tickets.some(t => t.userUnreadCount > 0) && (
          <span
            className="min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {tickets.reduce((s, t) => s + (t.userUnreadCount || 0), 0)}
          </span>
        )}
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
          aria-hidden="true"
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>

      {/* ── Panel ── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="support-panel"
            id={panelId}
            role="region"
            aria-labelledby={headerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-5 pt-4 pb-5">

              {/* ── VIEW: LIST ── */}
              {view === 'list' && (
                <TicketListView
                  tickets={tickets}
                  loading={ticketsLoading}
                  error={ticketsError}
                  onRetry={loadTickets}
                  onNew={() => { setForm({ subject:'', category:'account_and_login', priority:'normal', description:'' }); setFormErrors({}); setView('create') }}
                  onOpen={openTicket}
                />
              )}

              {/* ── VIEW: CREATE ── */}
              {view === 'create' && (
                <CreateTicketView
                  form={form}
                  errors={formErrors}
                  submitting={submitting}
                  onChange={setForm}
                  onSubmit={submitTicket}
                  onBack={() => setView('list')}
                />
              )}

              {/* ── VIEW: DETAIL ── */}
              {view === 'detail' && selectedTicket && (
                <TicketDetailView
                  ticket={selectedTicket}
                  messages={messages}
                  loading={detailLoading}
                  presence={presence}
                  sseConnected={sseConnected}
                  sseError={sseError}
                  msgInput={msgInput}
                  sending={sending}
                  sendError={sendError}
                  chatEnabled={!!chatEnabled}
                  isClosed={!!isClosed}
                  msgInputRef={msgInputRef}
                  messagesEndRef={messagesEndRef}
                  onBack={() => { setView('list'); void loadTickets() }}
                  onMsgChange={setMsgInput}
                  onSend={sendMessage}
                  onKeyDown={handleKeyDown}
                  onReconnect={() => {
                    void loadDetail(selectedTicket._id)
                    connectSse(selectedTicket._id)
                  }}
                />
              )}

              {/* Detail loading while ticket not yet set */}
              {view === 'detail' && !selectedTicket && (
                <div className="flex flex-col gap-3 py-4">
                  <button
                    onClick={() => setView('list')}
                    className="flex items-center gap-1.5 text-[12px] self-start"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <ArrowLeft size={13} /> Back
                  </button>
                  <DetailSkeleton />
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function TicketListView({
  tickets, loading, error, onRetry, onNew, onOpen,
}: {
  tickets: TicketSummary[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Your support tickets
        </p>
        <GlassButton variant="primary" size="sm" onClick={onNew}>
          <Plus size={12} /> New Ticket
        </GlassButton>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[0,1,2].map(i => (
            <div key={i} className="glass-subtle rounded-xl p-3.5 animate-pulse">
              <div className="h-3.5 w-48 rounded-lg" style={{ background: 'var(--border)' }} />
              <div className="h-3 w-24 rounded-lg mt-2" style={{ background: 'var(--border)' }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="glass-subtle rounded-xl p-4 text-center">
          <p className="text-[13px] mb-2" style={{ color: 'var(--danger)' }}>{error}</p>
          <GlassButton variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={12} /> Retry
          </GlassButton>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tickets.length === 0 && (
        <div className="text-center py-8 px-2">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            <HeadphonesIcon size={18} />
          </div>
          <p className="text-[13px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            No support tickets yet
          </p>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Having an issue? Create a ticket and our team will respond.
          </p>
        </div>
      )}

      {/* Ticket list */}
      {!loading && !error && tickets.length > 0 && (
        <div className="flex flex-col gap-2">
          {tickets.map(ticket => {
            const sc = statusConfig(ticket.status)
            return (
              <button
                key={ticket._id}
                onClick={() => onOpen(ticket._id)}
                className="glass-subtle rounded-xl p-3.5 text-left w-full transition-all hover:-translate-y-px focus-ring"
                style={{
                  border: '1px solid var(--border)',
                  transition: 'box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--glass-hover-shadow)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p
                    className="text-[13px] font-semibold leading-snug line-clamp-1 flex-1"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {ticket.subject}
                  </p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {ticket.userUnreadCount > 0 && (
                      <span
                        className="min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                        aria-label={`${ticket.userUnreadCount} unread messages`}
                      >
                        {ticket.userUnreadCount}
                      </span>
                    )}
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      {sc.icon} {sc.label}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {CATEGORY_LABELS[ticket.category] ?? ticket.category}
                  </span>
                  <span
                    className="text-[10px] font-semibold uppercase"
                    style={{ color: priorityColor(ticket.priority) }}
                  >
                    {ticket.priority}
                  </span>
                  <span className="text-[11px] ml-auto" style={{ color: 'var(--text-faint)' }}>
                    {ticket.lastMessageAt
                      ? formatTime(ticket.lastMessageAt)
                      : formatTime(ticket.createdAt)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Create ticket form ─────────────────────────────────────────────────────────

function CreateTicketView({
  form, errors, submitting, onChange, onSubmit, onBack,
}: {
  form:       { subject: string; category: string; priority: string; description: string }
  errors:     Partial<{ subject: string; category: string; priority: string; description: string }>
  submitting: boolean
  onChange:   (f: { subject: string; category: string; priority: string; description: string }) => void
  onSubmit:   (e: React.FormEvent) => void
  onBack:     () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] focus-ring rounded-lg px-1 py-0.5"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Back to ticket list"
        >
          <ArrowLeft size={13} /> Back
        </button>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          New Support Ticket
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <GlassInput
          label="Subject"
          value={form.subject}
          onChange={e => onChange({ ...form, subject: e.target.value })}
          placeholder="Briefly describe your issue"
          error={errors.subject}
          maxLength={120}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GlassSelect
            label="Category"
            value={form.category}
            onChange={v => onChange({ ...form, category: v })}
            options={CATEGORY_OPTIONS}
          />
          <GlassSelect
            label="Priority"
            value={form.priority}
            onChange={v => onChange({ ...form, priority: v })}
            options={PRIORITY_OPTIONS}
          />
        </div>

        <GlassTextarea
          label="Description"
          value={form.description}
          onChange={e => onChange({ ...form, description: e.target.value })}
          placeholder="Describe your issue in detail. Include steps to reproduce if it's a bug."
          error={errors.description}
          rows={5}
          maxLength={2000}
        />

        <p className="text-[11px] text-right" style={{ color: 'var(--text-faint)' }}>
          {form.description.length}/2000
        </p>

        <div className="flex gap-2 justify-end pt-1">
          <GlassButton variant="secondary" onClick={onBack} type="button">
            Cancel
          </GlassButton>
          <GlassButton variant="primary" type="submit" loading={submitting} disabled={submitting}>
            Submit Ticket
          </GlassButton>
        </div>
      </form>
    </div>
  )
}

// ── Ticket detail + chat ───────────────────────────────────────────────────────

function TicketDetailView({
  ticket, messages, loading, presence, sseConnected, sseError,
  msgInput, sending, sendError, chatEnabled, isClosed,
  msgInputRef, messagesEndRef,
  onBack, onMsgChange, onSend, onKeyDown, onReconnect,
}: {
  ticket:          TicketDetail
  messages:        Message[]
  loading:         boolean
  presence:        PresenceSnapshot
  sseConnected:    boolean
  sseError:        boolean
  msgInput:        string
  sending:         boolean
  sendError:       string | null
  chatEnabled:     boolean
  isClosed:        boolean
  msgInputRef:     React.RefObject<HTMLTextAreaElement | null>
  messagesEndRef:  React.RefObject<HTMLDivElement | null>
  onBack:          () => void
  onMsgChange:     (v: string) => void
  onSend:          (e?: React.FormEvent) => void
  onKeyDown:       (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onReconnect:     () => void
}) {
  const sc = statusConfig(ticket.status)

  return (
    <div className="flex flex-col gap-3">
      {/* Back + title */}
      <div className="flex items-start gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] mt-0.5 focus-ring rounded-lg px-1 py-0.5 flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Back to ticket list"
        >
          <ArrowLeft size={13} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <p
            className="text-[14px] font-semibold leading-snug"
            style={{ color: 'var(--text-primary)' }}
          >
            {ticket.subject}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
              style={{ background: sc.bg, color: sc.color }}
            >
              {sc.icon} {sc.label}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {CATEGORY_LABELS[ticket.category] ?? ticket.category}
            </span>
            <span
              className="text-[10px] font-semibold uppercase"
              style={{ color: priorityColor(ticket.priority) }}
            >
              {ticket.priority}
            </span>
          </div>
        </div>
      </div>

      {/* Ticket description */}
      <div
        className="glass-subtle rounded-xl p-3.5"
        style={{ border: '1px solid var(--border)' }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
          Description
        </p>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
          {ticket.description}
        </p>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          Submitted {formatFull(ticket.createdAt)}
          {ticket.assignedToName && ` · Assigned to ${ticket.assignedToName}`}
        </p>
      </div>

      {/* Presence / connection bar */}
      <PresenceBar
        presence={presence}
        sseConnected={sseConnected}
        sseError={sseError}
        isClosed={isClosed}
        onReconnect={onReconnect}
      />

      {/* Message thread */}
      <div
        className="flex flex-col gap-2 rounded-xl p-3 max-h-[320px] overflow-y-auto"
        style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}
        aria-label="Support conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <p className="text-center text-[12px] py-4" style={{ color: 'var(--text-faint)' }}>
            No messages yet.
            {ticket.status !== 'closed' && ' Send a message to start the conversation.'}
          </p>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg._id} msg={msg} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      {!isClosed && (
        <form onSubmit={onSend} className="flex flex-col gap-2">
          {sendError && (
            <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{sendError}</p>
          )}

          {/* Live chat paused notice */}
          {!chatEnabled && !isClosed && sseConnected && !presence.adminOnline && (
            <div
              className="rounded-xl px-3 py-2.5 text-[12px] flex items-center gap-2"
              style={{
                background: 'var(--warning-dim)',
                border: '1px solid rgba(217,119,6,0.18)',
                color: 'var(--warning-text)',
              }}
            >
              <WifiOff size={12} className="flex-shrink-0" />
              No support agent is online right now. Your message will be seen when an agent comes online.
            </div>
          )}

          <div className="flex gap-2 items-end">
            <textarea
              ref={msgInputRef}
              value={msgInput}
              onChange={e => onMsgChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                sseConnected && presence.adminOnline
                  ? 'Type a message… (Enter to send, Shift+Enter for new line)'
                  : 'Type a message…'
              }
              disabled={sending}
              rows={2}
              maxLength={4000}
              className="glass-input flex-1 rounded-xl px-3.5 py-2.5 text-[13px] resize-none min-h-[56px] max-h-[120px]"
              aria-label="Message input"
              style={{ overflow: 'auto' }}
            />
            <GlassButton
              type="submit"
              variant="primary"
              size="sm"
              loading={sending}
              disabled={!msgInput.trim() || sending}
              aria-label="Send message"
              style={{ alignSelf: 'flex-end', paddingLeft: 12, paddingRight: 12, height: 40 }}
            >
              <Send size={13} />
            </GlassButton>
          </div>
          <p className="text-[10px] self-end" style={{ color: 'var(--text-faint)' }}>
            {msgInput.length}/4000
          </p>
        </form>
      )}

      {/* Closed notice */}
      {isClosed && (
        <div
          className="rounded-xl px-3.5 py-3 text-[13px] text-center"
          style={{
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          This ticket is closed. Submit a new ticket if you need further assistance.
        </div>
      )}
    </div>
  )
}

// ── Presence bar ───────────────────────────────────────────────────────────────

function PresenceBar({
  presence, sseConnected, sseError, isClosed, onReconnect,
}: {
  presence:     PresenceSnapshot
  sseConnected: boolean
  sseError:     boolean
  isClosed:     boolean
  onReconnect:  () => void
}) {
  if (isClosed) return null

  if (sseError && !sseConnected) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
        style={{ background: 'var(--danger-dim)', border: '1px solid rgba(220,38,38,0.18)' }}
      >
        <div className="flex items-center gap-1.5">
          <WifiOff size={12} style={{ color: 'var(--danger)' }} />
          <span className="text-[12px]" style={{ color: 'var(--danger-text)' }}>
            Connection lost. Messages may be delayed.
          </span>
        </div>
        <button
          onClick={onReconnect}
          className="text-[11px] font-semibold underline"
          style={{ color: 'var(--danger)' }}
        >
          Reconnect
        </button>
      </div>
    )
  }

  if (!sseConnected) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-xl px-3 py-2"
        style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}
      >
        <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Connecting…</span>
      </div>
    )
  }

  if (presence.adminOnline) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-xl px-3 py-2"
        style={{ background: 'var(--success-dim)', border: '1px solid rgba(22,163,74,0.18)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--success)' }} />
        <span className="text-[12px]" style={{ color: 'var(--success-text)' }}>
          <strong>{presence.onlineAdminNames[0] ?? 'Support agent'}</strong> is online · Live chat active
        </span>
        <Wifi size={11} className="ml-auto flex-shrink-0" style={{ color: 'var(--success)' }} />
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-xl px-3 py-2"
      style={{ background: 'var(--warning-dim)', border: '1px solid rgba(217,119,6,0.18)' }}
    >
      <User size={11} style={{ color: 'var(--warning)' }} />
      <span className="text-[12px]" style={{ color: 'var(--warning-text)' }}>
        No support agent online. Messages are saved and will be answered when an agent comes online.
      </span>
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser   = msg.senderRole === 'user'
  const isSystem = msg.senderRole === 'system'

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] italic" style={{ color: 'var(--text-faint)' }}>
          {msg.content}
        </span>
      </div>
    )
  }

  const isOptimistic = msg._id.startsWith('opt-')

  return (
    <div className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
          isUser
            ? 'rounded-br-sm'
            : 'rounded-bl-sm',
          isOptimistic && 'opacity-60',
        )}
        style={
          isUser
            ? { background: 'var(--accent)', color: '#fff' }
            : { background: 'var(--glass-elevated-bg, rgba(0,0,0,0.06))', color: 'var(--text-primary)', border: '1px solid var(--border)' }
        }
      >
        {msg.content}
      </div>
      <div className="flex items-center gap-1.5 px-1">
        {!isUser && (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>
            {msg.senderName}
          </span>
        )}
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {isOptimistic ? 'Sending…' : formatTime(msg.createdAt)}
        </span>
      </div>
    </div>
  )
}

// ── Detail skeleton ────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="h-4 w-2/3 rounded-lg" style={{ background: 'var(--border)' }} />
      <div className="h-3 w-24 rounded-lg" style={{ background: 'var(--border)' }} />
      <div className="h-20 rounded-xl" style={{ background: 'var(--border)' }} />
      <div className="flex flex-col gap-2">
        {[0,1,2].map(i => (
          <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-end' : '')}>
            <div
              className="h-8 rounded-2xl"
              style={{ background: 'var(--border)', width: `${40 + i * 15}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
