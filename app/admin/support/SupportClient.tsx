'use client'

/**
 * app/admin/support/SupportClient.tsx — Admin Support Center client component.
 *
 * Features:
 * - Ticket list with search, status/priority filters, pagination, and sorting
 * - Status counts per filter (sidebar-style badges)
 * - Ticket detail: full thread + user info
 * - Assign ticket to a support admin
 * - Change ticket status (resolve, close, reopen)
 * - Reply to a ticket via admin message API
 * - Real-time SSE stream + presence heartbeat (admin side)
 * - Reconnection recovery (loads missed messages after reconnect)
 * - Live presence indicator showing whether the user is online
 * - Audit actions shown in status history
 * - Responsive: works on mobile with a back-nav pattern
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search, RefreshCw, Send, ArrowLeft, CheckCircle2,
  XCircle, MessageCircle,
  Wifi, WifiOff, Loader2, UserCheck,
} from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner,
  EmptyState, Pagination,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/support/presence'
import type { AdminRole } from '@/models/AdminUser'

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketStatus = 'open' | 'waiting_for_admin' | 'waiting_for_user' | 'resolved' | 'closed'

interface TicketRow {
  _id: string
  userId: string
  lifeFlowId: string
  userName: string
  subject: string
  category: string
  priority: string
  description: string
  status: TicketStatus
  assignedTo: string | null
  assignedToName: string | null
  lastMessageAt: string | null
  adminUnreadCount: number
  userUnreadCount: number
  messageCount: number
  createdAt: string
  updatedAt: string
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

interface TicketUser {
  lifeFlowId: string
  email: string
  avatar: string | null
  memberSince: string
}

interface StatusHistory {
  from: string | null
  to: string
  changedByRole: 'user' | 'admin'
  reason: string | null
  timestamp: string | null
}

interface AdminOption {
  _id: string
  name: string
  role: string
}

interface PresenceSnapshot {
  userOnline: boolean
  adminOnline: boolean
  onlineAdminNames: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  account_and_login:            'Account & Login',
  notifications:                'Notifications',
  offline_sync:                 'Offline Sync',
  notes_tasks_habits_projects:  'Notes, Tasks & Projects',
  expenses_and_subscriptions:   'Expenses & Subscriptions',
  payments_and_group_bills:     'Payments & Group Bills',
  bugs_and_technical:           'Bugs & Technical',
  other:                        'Other',
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all',               label: 'All Tickets' },
  { value: 'open',              label: 'Open' },
  { value: 'waiting_for_admin', label: 'Waiting for Admin' },
  { value: 'waiting_for_user',  label: 'Waiting for User' },
  { value: 'resolved',          label: 'Resolved' },
  { value: 'closed',            label: 'Closed' },
]

function statusMeta(status: TicketStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'open':              return { label: 'Open',               color: 'var(--accent)',     bg: 'var(--accent-dim)'  }
    case 'waiting_for_admin': return { label: 'Waiting: Admin',     color: 'var(--warning)',    bg: 'var(--warning-dim)' }
    case 'waiting_for_user':  return { label: 'Waiting: User',      color: 'var(--success)',    bg: 'var(--success-dim)' }
    case 'resolved':          return { label: 'Resolved',           color: 'var(--success)',    bg: 'var(--success-dim)' }
    case 'closed':            return { label: 'Closed',             color: 'var(--text-muted)', bg: 'rgba(0,0,0,0.06)'  }
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

function generateClientMsgId(): string {
  return `adm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ── Main component ────────────────────────────────────────────────────────────

export function SupportClient({ adminRole, adminId, adminName }: {
  adminRole: AdminRole
  adminId:   string
  adminName: string
}) {
  // ── List state ──────────────────────────────────────────────────────────────
  const [tickets, setTickets]       = useState<TicketRow[]>([])
  const [total, setTotal]           = useState(0)
  const [page, setPage]             = useState(1)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [q, setQ]                   = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [sort, setSort]             = useState('lastMessage')
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const limit = 25

  // ── Detail state ────────────────────────────────────────────────────────────
  const [selected, setSelected]         = useState<TicketRow | null>(null)
  const [messages, setMessages]         = useState<Message[]>([])
  const [ticketUser, setTicketUser]     = useState<TicketUser | null>(null)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // ── Action state ────────────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg]         = useState<string | null>(null)

  // ── Admin list for assignment ───────────────────────────────────────────────
  const [admins, setAdmins]             = useState<AdminOption[]>([])
  const [assignTo, setAssignTo]         = useState('')

  // ── Chat state ──────────────────────────────────────────────────────────────
  const [msgInput, setMsgInput]     = useState('')
  const [sending, setSending]       = useState(false)
  const [sendError, setSendError]   = useState<string | null>(null)
  const [presence, setPresence]     = useState<PresenceSnapshot>({ userOnline: false, adminOnline: false, onlineAdminNames: [] })
  const [sseConnected, setSseConnected] = useState(false)
  const [sseError, setSseError]         = useState(false)

  const sseRef          = useRef<EventSource | null>(null)
  const heartbeatRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgIdRef    = useRef<string>('')
  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const msgInputRef     = useRef<HTMLTextAreaElement>(null)
  const selectedIdRef   = useRef<string>('')

  const canModify = adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'support'

  // ── Load ticket list ────────────────────────────────────────────────────────

  const loadList = useCallback(async (opts: {
    page: number; q: string; status: string; priority: string; sort: string
  }) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({
        page:   String(opts.page),
        limit:  String(limit),
        status: opts.status,
        sort:   opts.sort,
      })
      if (opts.q.trim())   params.set('q', opts.q.trim())
      if (opts.priority)   params.set('priority', opts.priority)

      const res  = await fetch(`/api/admin/support/tickets?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load tickets')
      setTickets(json.tickets ?? [])
      setTotal(json.total ?? 0)
      setStatusCounts(json.statusCounts ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    void loadList({ page, q, status: statusFilter, priority: priorityFilter, sort })
  }, [page, q, statusFilter, priorityFilter, sort, loadList])

  function handleRefresh() {
    void loadList({ page, q, status: statusFilter, priority: priorityFilter, sort })
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    void loadList({ page: 1, q, status: statusFilter, priority: priorityFilter, sort })
  }

  // ── Load admin list (for assignment) ────────────────────────────────────────

  useEffect(() => {
    async function fetchAdmins() {
      try {
        const res  = await fetch('/api/admin/admins?limit=50')
        const json = await res.json()
        if (res.ok && json.admins) {
          const supportable = json.admins.filter((a: AdminOption) =>
            ['super_admin', 'admin', 'support'].includes(a.role) && a._id !== adminId
          )
          setAdmins([{ _id: adminId, name: `${adminName} (me)`, role: adminRole }, ...supportable])
        }
      } catch { /* non-fatal */ }
    }
    void fetchAdmins()
  }, [adminId, adminName, adminRole])

  // ── Open ticket detail ─────────────────────────────────────────────────────

  const loadDetail = useCallback(async (id: string, after?: string) => {
    setDetailLoading(true)
    try {
      const url = after
        ? `/api/admin/support/tickets/${id}?after=${encodeURIComponent(after)}`
        : `/api/admin/support/tickets/${id}`
      const res  = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load ticket')

      if (!after) {
        setSelected(json.ticket)
        setMessages(json.messages ?? [])
        setTicketUser(json.user ?? null)
        setStatusHistory(json.ticket?.statusHistory ?? [])
        if (json.messages?.length > 0) {
          lastMsgIdRef.current = json.messages[json.messages.length - 1]._id
        }
        setAssignTo(json.ticket?.assignedTo ?? '')
      } else {
        // Reconnect — merge new messages
        const newMsgs: Message[] = json.messages ?? []
        setMessages(prev => {
          const existing = new Set(prev.map((m: Message) => m._id))
          const added = newMsgs.filter((m: Message) => !existing.has(m._id))
          if (added.length > 0) lastMsgIdRef.current = added[added.length - 1]._id
          return [...prev, ...added]
        })
      }
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to load ticket')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // ── SSE ────────────────────────────────────────────────────────────────────

  const connectSse = useCallback((ticketId: string) => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null }

    const es = new EventSource(`/api/support/tickets/${ticketId}/stream?role=admin`)
    sseRef.current = es

    es.addEventListener('connect', (e) => {
      try {
        const d = JSON.parse(e.data)
        setSseConnected(true); setSseError(false)
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
        setSelected(prev => prev ? { ...prev, messageCount: (prev.messageCount || 0) + 1 } : prev)
        // Clear admin unread locally
        setTickets(prev => prev.map(t =>
          t._id === ticketId ? { ...t, adminUnreadCount: 0 } : t
        ))
      } catch {}
    })

    es.addEventListener('presence', (e) => {
      try { setPresence(JSON.parse(e.data)) } catch {}
    })

    es.addEventListener('status', (e) => {
      try {
        const { status } = JSON.parse(e.data)
        setSelected(prev => prev ? { ...prev, status } : prev)
      } catch {}
    })

    es.onerror = () => {
      setSseConnected(false); setSseError(true)
      es.addEventListener('connect', async () => {
        setSseError(false); setSseConnected(true)
        if (selectedIdRef.current && lastMsgIdRef.current) {
          await loadDetail(selectedIdRef.current, lastMsgIdRef.current)
        }
      }, { once: true })
    }
  }, [loadDetail])

  function startHeartbeat(ticketId: string) {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(async () => {
      try {
        await fetch('/api/support/presence/heartbeat?role=admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId }),
        })
      } catch {}
    }, HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat() {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
  }

  async function openTicket(ticket: TicketRow) {
    selectedIdRef.current = ticket._id
    lastMsgIdRef.current  = ''
    setMessages([])
    setSelected(ticket)
    setTicketUser(null)
    setStatusHistory([])
    setPresence({ userOnline: false, adminOnline: false, onlineAdminNames: [] })
    setSseConnected(false); setSseError(false)
    setSendError(null); setActionMsg(null)
    await loadDetail(ticket._id)
    connectSse(ticket._id)
    startHeartbeat(ticket._id)
  }

  function closeDetail() {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
    stopHeartbeat()
    setSseConnected(false)
    setSelected(null)
    void loadList({ page, q, status: statusFilter, priority: priorityFilter, sort })
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) sseRef.current.close()
      stopHeartbeat()
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // ── Ticket actions ─────────────────────────────────────────────────────────

  async function changeStatus(newStatus: TicketStatus, reason?: string) {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${selected._id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to update status')
      setSelected(prev => prev ? { ...prev, status: newStatus } : prev)
      setActionMsg(`Ticket ${newStatus.replace(/_/g, ' ')}`)
      // Refresh list
      void loadList({ page, q, status: statusFilter, priority: priorityFilter, sort })
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionLoading(false)
    }
  }

  async function assignTicket(toAdminId: string) {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${selected._id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assignedTo: toAdminId || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to assign')
      const assigned = admins.find(a => a._id === toAdminId)
      setSelected(prev => prev ? {
        ...prev,
        assignedTo: toAdminId || null,
        assignedToName: assigned?.name ?? null,
      } : prev)
      setActionMsg(toAdminId ? `Assigned to ${assigned?.name}` : 'Unassigned')
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Assignment failed')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Send admin message ─────────────────────────────────────────────────────

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault()
    if (!msgInput.trim() || !selected) return
    if (selected.status === 'closed') return

    const content     = msgInput.trim()
    const clientMsgId = generateClientMsgId()

    setSending(true); setSendError(null); setMsgInput('')

    const optimistic: Message = {
      _id:        `opt-${clientMsgId}`,
      ticketId:   selected._id,
      senderId:   adminId,
      senderName: adminName,
      senderRole: 'admin',
      content,
      createdAt:  new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch(`/api/admin/support/tickets/${selected._id}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, clientMsgId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m._id !== optimistic._id))
        setMsgInput(content)
        setSendError(data.error?.message ?? 'Failed to send message')
        return
      }
      const real: Message = data.message
      setMessages(prev => prev.map(m => m._id === optimistic._id ? real : m))
      lastMsgIdRef.current = real._id
      setSelected(prev => prev ? {
        ...prev,
        status: 'waiting_for_user',
        messageCount: (prev.messageCount || 0) + 1,
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

  function handleMsgKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render — two-pane on desktop, stacked on mobile
  // ─────────────────────────────────────────────────────────────────────────

  const isClosed = selected?.status === 'closed'

  return (
    <div className="flex flex-col gap-4">

      {/* Feedback banner */}
      {actionMsg && (
        <div
          className="rounded-xl px-4 py-2.5 text-[13px] flex items-center justify-between"
          style={{
            background: actionMsg.toLowerCase().includes('failed') ? 'var(--danger-dim)' : 'var(--success-dim)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: actionMsg.toLowerCase().includes('failed') ? 'var(--danger-text)' : 'var(--success-text)',
          }}
        >
          {actionMsg}
          <button onClick={() => setActionMsg(null)} className="ml-2 font-bold text-[16px] leading-none">×</button>
        </div>
      )}

      {/* Split-pane layout */}
      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: '70vh' }}>

        {/* ── LEFT: ticket list (hidden on mobile when detail is open) ── */}
        <div
          className={`flex flex-col gap-3 lg:w-[360px] xl:w-[400px] flex-shrink-0 ${selected ? 'hidden lg:flex' : 'flex'}`}
        >
          {/* Filters */}
          <AdminCard padding="sm">
            <form onSubmit={handleSearch} className="flex flex-col gap-2">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search subject or user…"
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl outline-none"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                  className="flex-1 px-2 py-2 text-[12px] rounded-xl outline-none"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  {STATUS_FILTER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}{statusCounts[o.value] ? ` (${statusCounts[o.value]})` : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={priorityFilter}
                  onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
                  className="px-2 py-2 text-[12px] rounded-xl outline-none"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="p-2 rounded-xl"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  aria-label="Refresh"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value)}
                  className="flex-1 px-2 py-2 text-[12px] rounded-xl outline-none"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="lastMessage">Sort: Last Activity</option>
                  <option value="created">Sort: Newest First</option>
                  <option value="priority">Sort: Priority</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl text-[12px] font-semibold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Search
                </button>
              </div>
            </form>
          </AdminCard>

          {/* Ticket list */}
          <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10"><LoadingSpinner /></div>
            ) : error ? (
              <div className="space-y-2">
                <ErrorState message={error} />
                <button onClick={handleRefresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium" style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={12} /> Retry
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <EmptyState message="No tickets match your filters." />
            ) : (
              <>
                {tickets.map(ticket => {
                  const sm = statusMeta(ticket.status)
                  const isActive = selected?._id === ticket._id
                  return (
                    <button
                      key={ticket._id}
                      onClick={() => openTicket(ticket)}
                      className="text-left w-full rounded-xl p-3.5 transition-all"
                      style={{
                        background: isActive ? 'var(--accent-dim)' : 'var(--glass-subtle-bg)',
                        border: `1px solid ${isActive ? 'rgba(37,99,235,0.22)' : 'var(--border)'}`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p
                          className="text-[13px] font-semibold line-clamp-1 flex-1"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {ticket.subject}
                        </p>
                        {ticket.adminUnreadCount > 0 && (
                          <span
                            className="min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0"
                            style={{ background: 'var(--accent)', color: '#fff' }}
                          >
                            {ticket.adminUnreadCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                          style={{ background: sm.bg, color: sm.color }}
                        >
                          {sm.label}
                        </span>
                        <span
                          className="text-[10px] font-bold uppercase"
                          style={{ color: priorityColor(ticket.priority) }}
                        >
                          {ticket.priority}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {ticket.userName}
                        </span>
                        <span className="text-[11px] ml-auto" style={{ color: 'var(--text-faint)' }}>
                          {ticket.lastMessageAt
                            ? formatRelativeTime(ticket.lastMessageAt)
                            : formatRelativeTime(ticket.createdAt)}
                        </span>
                      </div>
                    </button>
                  )
                })}

                <Pagination
                  page={page}
                  hasMore={page * limit < total}
                  total={total}
                  limit={limit}
                  onPrev={() => setPage(p => p - 1)}
                  onNext={() => setPage(p => p + 1)}
                />
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT: ticket detail ── */}
        {selected ? (
          <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-hidden">
            <TicketDetailPane
              ticket={selected}
              messages={messages}
              ticketUser={ticketUser}
              statusHistory={statusHistory}
              detailLoading={detailLoading}
              presence={presence}
              sseConnected={sseConnected}
              sseError={sseError}
              msgInput={msgInput}
              sending={sending}
              sendError={sendError}
              isClosed={isClosed}
              canModify={canModify}
              actionLoading={actionLoading}
              admins={admins}
              assignTo={assignTo}
              messagesEndRef={messagesEndRef}
              msgInputRef={msgInputRef}
              onBack={closeDetail}
              onMsgChange={setMsgInput}
              onSend={sendMessage}
              onKeyDown={handleMsgKeyDown}
              onAssignChange={setAssignTo}
              onAssign={assignTicket}
              onStatusChange={changeStatus}
              onReconnect={() => {
                void loadDetail(selected._id)
                connectSse(selected._id)
              }}
            />
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center">
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <MessageCircle size={22} />
              </div>
              <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Select a ticket
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Click on a ticket from the list to view the conversation.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ticket detail pane ────────────────────────────────────────────────────────

function TicketDetailPane({
  ticket, messages, ticketUser, statusHistory, detailLoading,
  presence, sseConnected, sseError, msgInput, sending, sendError,
  isClosed, canModify, actionLoading, admins, assignTo,
  messagesEndRef, msgInputRef,
  onBack, onMsgChange, onSend, onKeyDown, onAssignChange, onAssign, onStatusChange, onReconnect,
}: {
  ticket:         TicketRow
  messages:       Message[]
  ticketUser:     TicketUser | null
  statusHistory:  StatusHistory[]
  detailLoading:  boolean
  presence:       PresenceSnapshot
  sseConnected:   boolean
  sseError:       boolean
  msgInput:       string
  sending:        boolean
  sendError:      string | null
  isClosed:       boolean
  canModify:      boolean
  actionLoading:  boolean
  admins:         AdminOption[]
  assignTo:       string
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  msgInputRef:    React.RefObject<HTMLTextAreaElement | null>
  onBack:         () => void
  onMsgChange:    (v: string) => void
  onSend:         (e?: React.FormEvent) => void
  onKeyDown:      (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onAssignChange: (v: string) => void
  onAssign:       (id: string) => void
  onStatusChange: (s: TicketStatus, reason?: string) => void
  onReconnect:    () => void
}) {
  const sm = statusMeta(ticket.status)

  return (
    <>
      {/* Header */}
      <AdminCard padding="sm">
        <div className="flex items-start gap-3">
          {/* Back — mobile only */}
          <button
            onClick={onBack}
            className="lg:hidden flex items-center gap-1 text-[12px] mt-0.5 flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={13} /> Back
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-[15px] font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {ticket.subject}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                    style={{ background: sm.bg, color: sm.color }}
                  >
                    {sm.label}
                  </span>
                  <span
                    className="text-[10px] font-bold uppercase"
                    style={{ color: priorityColor(ticket.priority) }}
                  >
                    {ticket.priority}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {CATEGORY_LABELS[ticket.category] ?? ticket.category}
                  </span>
                  {ticket.assignedToName && (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Assigned: <strong>{ticket.assignedToName}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              {canModify && !isClosed && (
                <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
                  {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
                    <ActionButton
                      label="Resolve"
                      color="var(--success)"
                      bg="var(--success-dim)"
                      loading={actionLoading}
                      onClick={() => onStatusChange('resolved')}
                      icon={<CheckCircle2 size={12} />}
                    />
                  )}
                  {ticket.status !== 'closed' && (
                    <ActionButton
                      label="Close"
                      color="var(--danger-text)"
                      bg="var(--danger-dim)"
                      loading={actionLoading}
                      onClick={() => onStatusChange('closed')}
                      icon={<XCircle size={12} />}
                    />
                  )}
                </div>
              )}
              {canModify && isClosed && (
                <ActionButton
                  label="Reopen"
                  color="var(--accent-text)"
                  bg="var(--accent-dim)"
                  loading={actionLoading}
                  onClick={() => onStatusChange('open')}
                  icon={<RefreshCw size={12} />}
                />
              )}
            </div>

            {/* User info */}
            {ticketUser && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                >
                  {ticket.userName.charAt(0).toUpperCase()}
                </div>
                <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{ticket.userName}</span>
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{ticketUser.lifeFlowId}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{ticketUser.email}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Member since {new Date(ticketUser.memberSince).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Assignment */}
        {canModify && (
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <UserCheck size={13} style={{ color: 'var(--text-muted)' }} />
            <select
              value={assignTo}
              onChange={e => onAssignChange(e.target.value)}
              className="flex-1 px-2 py-1.5 text-[12px] rounded-xl outline-none"
              style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="">Unassigned</option>
              {admins.map(a => (
                <option key={a._id} value={a._id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => onAssign(assignTo)}
              disabled={actionLoading}
              className="px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              Assign
            </button>
          </div>
        )}

        {/* Presence bar */}
        <AdminPresenceBar
          presence={presence}
          sseConnected={sseConnected}
          sseError={sseError}
          onReconnect={onReconnect}
        />
      </AdminCard>

      {/* Description */}
      <AdminCard padding="sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
          Initial Description
        </p>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
          {ticket.description}
        </p>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          Submitted {new Date(ticket.createdAt).toLocaleString()}
          {' · '}{ticket.messageCount} message{ticket.messageCount !== 1 ? 's' : ''}
        </p>
      </AdminCard>

      {/* Message thread */}
      <AdminCard padding="sm">
        <SectionHeader title="Conversation" />
        <div
          className="flex flex-col gap-2 rounded-xl p-3 max-h-[360px] overflow-y-auto"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}
          aria-label="Support conversation"
          aria-live="polite"
        >
          {detailLoading && messages.length === 0 && (
            <div className="flex justify-center py-8"><LoadingSpinner size="sm" /></div>
          )}
          {!detailLoading && messages.length === 0 && (
            <p className="text-center text-[12px] py-4" style={{ color: 'var(--text-faint)' }}>
              No messages yet.
            </p>
          )}
          {messages.map(msg => (
            <AdminMessageBubble key={msg._id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        {!isClosed && canModify && (
          <form onSubmit={onSend} className="mt-3 flex flex-col gap-2">
            {sendError && (
              <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{sendError}</p>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={msgInputRef}
                value={msgInput}
                onChange={e => onMsgChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Reply to user… (Enter to send, Shift+Enter for new line)"
                disabled={sending}
                rows={2}
                maxLength={4000}
                className="glass-input flex-1 rounded-xl px-3.5 py-2.5 text-[13px] resize-none min-h-[56px] max-h-[120px]"
                style={{ overflow: 'auto' }}
              />
              <button
                type="submit"
                disabled={!msgInput.trim() || sending}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--accent)', height: 40, alignSelf: 'flex-end' }}
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </form>
        )}

        {isClosed && (
          <div className="mt-3 rounded-xl px-3.5 py-2.5 text-[13px] text-center"
            style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            This ticket is closed.
            {canModify && ' Use the "Reopen" button to accept new messages.'}
          </div>
        )}
      </AdminCard>

      {/* Status history */}
      {statusHistory.length > 0 && (
        <AdminCard padding="sm">
          <SectionHeader title="Status History" />
          <div className="flex flex-col gap-1.5">
            {statusHistory.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: h.changedByRole === 'admin' ? 'var(--accent)' : 'var(--success)' }}
                />
                <span>
                  {h.from ? `${h.from.replace(/_/g, ' ')} → ` : ''}<strong>{h.to.replace(/_/g, ' ')}</strong>
                </span>
                <span style={{ color: 'var(--text-faint)' }}>by {h.changedByRole}</span>
                {h.reason && <span style={{ color: 'var(--text-faint)' }}>· {h.reason}</span>}
                {h.timestamp && (
                  <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
                    {new Date(h.timestamp).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </>
  )
}

// ── Admin presence bar ─────────────────────────────────────────────────────────

function AdminPresenceBar({
  presence, sseConnected, sseError, onReconnect,
}: {
  presence:     PresenceSnapshot
  sseConnected: boolean
  sseError:     boolean
  onReconnect:  () => void
}) {
  if (sseError && !sseConnected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mt-2"
        style={{ background: 'var(--danger-dim)', border: '1px solid rgba(220,38,38,0.18)' }}>
        <div className="flex items-center gap-1.5">
          <WifiOff size={12} style={{ color: 'var(--danger)' }} />
          <span className="text-[12px]" style={{ color: 'var(--danger-text)' }}>
            Real-time connection lost.
          </span>
        </div>
        <button onClick={onReconnect} className="text-[11px] font-semibold underline" style={{ color: 'var(--danger)' }}>
          Reconnect
        </button>
      </div>
    )
  }

  if (!sseConnected) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 mt-2"
        style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}>
        <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Connecting to real-time stream…</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 mt-2 px-1">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: presence.userOnline ? 'var(--success)' : 'var(--text-faint)' }} />
        <span className="text-[11px]" style={{ color: presence.userOnline ? 'var(--success-text)' : 'var(--text-faint)' }}>
          User {presence.userOnline ? 'online' : 'offline'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Wifi size={11} style={{ color: 'var(--success)' }} />
        <span className="text-[11px]" style={{ color: 'var(--success-text)' }}>
          Live chat connected
        </span>
      </div>
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function AdminMessageBubble({ msg }: { msg: Message }) {
  const isAdmin  = msg.senderRole === 'admin'
  const isSystem = msg.senderRole === 'system'
  const isOptimistic = msg._id.startsWith('opt-')

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] italic" style={{ color: 'var(--text-faint)' }}>{msg.content}</span>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-0.5 ${isAdmin ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${isAdmin ? 'rounded-br-sm' : 'rounded-bl-sm'} ${isOptimistic ? 'opacity-60' : ''}`}
        style={
          isAdmin
            ? { background: 'var(--accent)', color: '#fff' }
            : { background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
        }
      >
        {msg.content}
      </div>
      <div className="flex items-center gap-1.5 px-1">
        {!isAdmin && (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--success)' }}>
            {msg.senderName}
          </span>
        )}
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {isOptimistic ? 'Sending…' : formatRelativeTime(msg.createdAt)}
        </span>
      </div>
    </div>
  )
}

// ── Small action button helper ─────────────────────────────────────────────────

function ActionButton({
  label, color, bg, loading, onClick, icon,
}: {
  label:   string
  color:   string
  bg:      string
  loading: boolean
  onClick: () => void
  icon:    React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[12px] font-semibold transition-opacity disabled:opacity-40"
      style={{ background: bg, color, border: `1px solid ${color}30` }}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
