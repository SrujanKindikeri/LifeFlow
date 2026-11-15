'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, RefreshCw, AlertTriangle, MessageSquare, RotateCcw } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { formatRelativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  _id: string
  senderId: string
  senderName: string
  senderLifeFlowId: string
  text: string | null
  deleted: boolean
  createdAt: string
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'failed'

interface PendingMessage {
  tempId: string
  text: string
  idempotencyKey: string
  status: SendStatus
  error?: string
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <div
      className="rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg,rgba(99,102,241,0.22),rgba(139,92,246,0.18))',
        color: 'var(--accent-text)',
        border: '1px solid rgba(99,102,241,0.25)',
      }}
    >
      {initials}
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isOwn,
  showName,
}: {
  msg: Message
  isOwn: boolean
  showName: boolean
}) {
  return (
    <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar name={msg.senderName} />}
      <div className={`flex flex-col max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} gap-0.5`}>
        {showName && !isOwn && (
          <span className="text-[11px] font-semibold px-1" style={{ color: 'var(--text-muted)' }}>
            {msg.senderName}
          </span>
        )}
        <div
          className="px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words"
          style={isOwn ? {
            background: 'var(--accent)',
            color: '#fff',
            borderBottomRightRadius: 6,
          } : {
            background: 'rgba(0,0,0,0.05)',
            color: 'var(--text-primary)',
            borderBottomLeftRadius: 6,
          }}
        >
          {msg.deleted
            ? <em style={{ color: isOwn ? 'rgba(255,255,255,0.55)' : 'var(--text-faint)' }}>(message deleted)</em>
            : msg.text
          }
        </div>
        <span className="text-[10px] px-1" style={{ color: 'var(--text-faint)' }}>
          {formatRelativeTime(msg.createdAt)}
        </span>
      </div>
    </div>
  )
}

// ─── PendingBubble ────────────────────────────────────────────────────────────

function PendingBubble({
  msg,
  onRetry,
}: {
  msg: PendingMessage
  onRetry: (m: PendingMessage) => void
}) {
  return (
    <div className="flex items-end gap-2 flex-row-reverse">
      <div className="flex flex-col max-w-[70%] items-end gap-0.5">
        <div
          className="px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words"
          style={{
            background: msg.status === 'failed' ? 'rgba(220,38,38,0.12)' : 'var(--accent)',
            color: msg.status === 'failed' ? 'var(--danger-text)' : '#fff',
            opacity: msg.status === 'sending' ? 0.6 : 1,
            borderBottomRightRadius: 6,
          }}
        >
          {msg.text}
        </div>
        <div className="flex items-center gap-1 px-1">
          {msg.status === 'sending' && (
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Sending…</span>
          )}
          {msg.status === 'failed' && (
            <>
              <AlertTriangle size={10} style={{ color: 'var(--danger)' }} />
              <span className="text-[10px]" style={{ color: 'var(--danger)' }}>Failed</span>
              <button
                onClick={() => onRetry(msg)}
                className="flex items-center gap-0.5 text-[10px] ml-1 hover:underline"
                style={{ color: 'var(--accent-text)' }}
              >
                <RotateCcw size={9} /> Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ProjectChat ──────────────────────────────────────────────────────────────

const POLL_INTERVAL = 8000   // 8 seconds
const PAGE_SIZE     = 30

export function ProjectChat({
  projectId,
  currentUserId,
}: {
  projectId: string
  currentUserId: string
}) {
  const [messages, setMessages]         = useState<Message[]>([])
  const [pending, setPending]           = useState<PendingMessage[]>([])
  const [draft, setDraft]               = useState('')
  const [loading, setLoading]           = useState(true)
  const [loadingMore, setLoadingMore]   = useState(false)
  const [hasMore, setHasMore]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const messagesEndRef                  = useRef<HTMLDivElement>(null)
  const textareaRef                     = useRef<HTMLTextAreaElement>(null)
  const pollRef                         = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestCreatedAt                 = useRef<string | null>(null)

  // ── Fetch (initial + poll) ──────────────────────────────────────────────────
  const fetchMessages = useCallback(async (opts?: { append?: boolean; beforeId?: string }) => {
    try {
      const url = new URL(`/api/projects/${projectId}/messages`, window.location.origin)
      url.searchParams.set('limit', String(PAGE_SIZE))
      if (opts?.beforeId) url.searchParams.set('before', opts.beforeId)

      const res = await fetch(url.toString())
      if (!res.ok) { setError('Could not load messages'); return }
      const data = await res.json()

      if (opts?.append) {
        setMessages((prev) => [...(data.messages as Message[]), ...prev])
      } else {
        setMessages(data.messages)
        // track newest
        const last = (data.messages as Message[]).at(-1)
        if (last) latestCreatedAt.current = last.createdAt
      }
      setHasMore(data.hasMore)
      setError(null)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [projectId])

  // Poll for new messages
  const pollNew = useCallback(async () => {
    if (!latestCreatedAt.current) return
    try {
      const url = new URL(`/api/projects/${projectId}/messages`, window.location.origin)
      url.searchParams.set('limit', '20')
      const res = await fetch(url.toString())
      if (!res.ok) return
      const data = await res.json()
      const newMsgs = (data.messages as Message[]).filter(
        (m) => m.createdAt > (latestCreatedAt.current ?? '')
      )
      if (newMsgs.length > 0) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m._id))
          const added = newMsgs.filter((m) => !ids.has(m._id))
          return added.length > 0 ? [...prev, ...added] : prev
        })
        latestCreatedAt.current = newMsgs.at(-1)!.createdAt
      }
    } catch { /* ignore poll errors */ }
  }, [projectId])

  useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  // Start polling after initial load
  useEffect(() => {
    if (loading) return
    pollRef.current = setInterval(() => void pollNew(), POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loading, pollNew])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send ────────────────────────────────────────────────────────────────────
  async function doSend(text: string, idempotencyKey: string, tempId: string) {
    setPending((p) => p.map((m) => m.tempId === tempId ? { ...m, status: 'sending' } : m))
    try {
      const res = await fetch(`/api/projects/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, idempotencyKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed to send')

      // Remove from pending, add to messages
      setPending((p) => p.filter((m) => m.tempId !== tempId))
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m._id))
        return ids.has(data.message._id) ? prev : [...prev, data.message]
      })
      latestCreatedAt.current = data.message.createdAt
    } catch (e) {
      setPending((p) =>
        p.map((m) =>
          m.tempId === tempId
            ? { ...m, status: 'failed', error: e instanceof Error ? e.message : 'Failed' }
            : m,
        ),
      )
    }
  }

  function send() {
    const text = draft.trim()
    if (!text) return
    const tempId         = `pending-${Date.now()}`
    const idempotencyKey = generateUUID()
    setPending((p) => [...p, { tempId, text, idempotencyKey, status: 'sending' }])
    setDraft('')
    textareaRef.current?.focus()
    void doSend(text, idempotencyKey, tempId)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ── Load more (older messages) ──────────────────────────────────────────────
  function loadMore() {
    const firstId = messages[0]?._id
    if (!firstId || loadingMore) return
    setLoadingMore(true)
    void fetchMessages({ append: true, beforeId: firstId })
  }

  // ── Empty / loading states ──────────────────────────────────────────────────
  return (
    <GlassCard padding="none" className="flex flex-col overflow-hidden" style={{ minHeight: 360 }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <MessageSquare size={14} style={{ color: 'var(--accent)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Project Chat
        </p>
        <div className="flex-1" />
        <button
          onClick={() => void fetchMessages()}
          className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-[220px] max-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center flex-1 py-12">
            <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{error}</p>
            <GlassButton variant="ghost" size="xs" onClick={() => void fetchMessages()}>Retry</GlassButton>
          </div>
        ) : (
          <>
            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-xs px-3 py-1 rounded-full glass hover:bg-black/[0.05] transition-colors disabled:opacity-50"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {loadingMore ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}

            {/* Empty */}
            {messages.length === 0 && pending.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10">
                <MessageSquare size={28} style={{ color: 'var(--text-faint)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No messages yet. Start the conversation!
                </p>
              </div>
            )}

            {/* Messages */}
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => {
                const prev = messages[idx - 1]
                const showName = !prev || prev.senderId !== msg.senderId
                return (
                  <motion.div
                    key={msg._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <MessageBubble
                      msg={msg}
                      isOwn={msg.senderId === currentUserId}
                      showName={showName}
                    />
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {/* Pending (optimistic) */}
            {pending.map((pm) => (
              <PendingBubble
                key={pm.tempId}
                msg={pm}
                onRetry={(m) => void doSend(m.text, m.idempotencyKey, m.tempId)}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose area */}
      <div
        className="flex items-end gap-2 px-4 py-3"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          rows={1}
          className="glass-input flex-1 rounded-xl text-sm px-3.5 py-2.5 resize-none leading-relaxed"
          style={{ minHeight: 40, maxHeight: 120 }}
          aria-label="Message input"
        />
        <GlassButton
          variant="primary"
          size="sm"
          icon={<Send size={13} />}
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          Send
        </GlassButton>
      </div>
    </GlassCard>
  )
}
