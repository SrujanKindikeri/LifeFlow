'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail, Check, X, Clock, FolderOpen, User,
  ChevronRight, RefreshCw, AlertCircle,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { formatRelativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invitation {
  _id: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  expiresAt: string
  respondedAt: string | null
  createdAt: string
  project: {
    _id: string
    title: string
    description: string | null
    color: string
    status: string
  } | null
  inviter: {
    _id: string
    publicId: string
    name: string
    avatar: string | null
  } | null
}

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  accepted:  { label: 'Accepted',  color: '#16a34a', bg: 'rgba(22,163,74,0.10)'  },
  declined:  { label: 'Declined',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
  expired:   { label: 'Expired',   color: '#ef4444', bg: 'rgba(239,68,68,0.10)'  },
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, avatar, size = 32 }: { name: string; avatar: string | null; size?: number }) {
  const initials = name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
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

// ─── InvitationCard ───────────────────────────────────────────────────────────

function InvitationCard({
  inv,
  onAccept,
  onDecline,
  responding,
}: {
  inv: Invitation
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  responding: string | null
}) {
  const cfg = STATUS_CONFIG[inv.status]
  const isExpiredOrDone = inv.status !== 'pending'
  const isLoading = responding === inv._id

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
    >
      <GlassCard padding="md" className="flex flex-col gap-4">
        {/* Project header */}
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${inv.project?.color ?? '#3b82f6'}18` }}
          >
            <FolderOpen size={16} style={{ color: inv.project?.color ?? '#3b82f6' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--text-primary)' }}>
              {inv.project?.title ?? 'Project'}
            </p>
            {inv.project?.description && (
              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                {inv.project.description}
              </p>
            )}
          </div>
          {/* Status badge */}
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: cfg.bg, color: cfg.color }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Inviter */}
        <div className="flex items-center gap-2">
          {inv.inviter && (
            <Avatar name={inv.inviter.name} avatar={inv.inviter.avatar} size={24} />
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Invited by{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              {inv.inviter?.name ?? 'Unknown'}
            </strong>
            {' · '}{formatRelativeTime(inv.createdAt)}
          </span>
        </div>

        {/* Expiry */}
        {inv.status === 'pending' && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
            <Clock size={12} />
            <span>Expires {formatRelativeTime(inv.expiresAt)}</span>
          </div>
        )}

        {/* Actions */}
        {!isExpiredOrDone && (
          <div className="flex gap-2 pt-1">
            <GlassButton
              variant="primary"
              size="sm"
              loading={isLoading}
              icon={<Check size={13} />}
              onClick={() => onAccept(inv._id)}
              className="flex-1"
            >
              Accept
            </GlassButton>
            <GlassButton
              variant="ghost"
              size="sm"
              disabled={isLoading}
              icon={<X size={13} />}
              onClick={() => onDecline(inv._id)}
              className="flex-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Decline
            </GlassButton>
          </div>
        )}

        {/* Accepted — link to project */}
        {inv.status === 'accepted' && inv.project && (
          <a
            href={`/app/projects/${inv.project._id}`}
            className="flex items-center gap-1 text-xs font-medium hover:underline"
            style={{ color: 'var(--accent-text)' }}
          >
            Open project <ChevronRight size={12} />
          </a>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ─── InvitationsClient ────────────────────────────────────────────────────────

export function InvitationsClient({
  autoToken,
  autoAction,
}: {
  autoToken: string | null
  autoAction: 'accept' | 'decline' | null
}) {
  const router = useRouter()
  const { success, error: showError } = useToast()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [responding, setResponding] = useState<string | null>(null)
  const [autoHandled, setAutoHandled] = useState(false)
  const [filter, setFilter] = useState<string>('pending')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/invitations')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInvitations(data.invitations)
    } catch {
      showError('Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => { void load() }, [load])

  async function handleTokenAction(token: string, action: 'accept' | 'decline') {
    try {
      const res = await fetch('/api/invitations/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed')

      if (action === 'accept') {
        success('Invitation accepted! You now have access to the project.')
        if (data.projectId) {
          setTimeout(() => router.push(`/app/projects/${data.projectId}`), 1200)
        }
      } else {
        success('Invitation declined.')
      }
      void load()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not process invitation')
    }
    // Clean token from URL
    router.replace('/app/invitations', { scroll: false })
  }

  // Auto-handle token from email link — handleTokenAction declared above
  useEffect(() => {
    if (!autoToken || !autoAction || autoHandled) return
    setAutoHandled(true)
    void handleTokenAction(autoToken, autoAction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoToken, autoAction])

  async function respond(invitationId: string, action: 'accept' | 'decline') {
    setResponding(invitationId)
    try {
      const res = await fetch('/api/invitations/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed')

      if (action === 'accept') {
        success('Invitation accepted!')
        if (data.projectId) {
          setTimeout(() => router.push(`/app/projects/${data.projectId}`), 900)
        }
      } else {
        success('Invitation declined.')
      }
      void load()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not process invitation')
    } finally {
      setResponding(null)
    }
  }

  const filters = ['pending', 'accepted', 'declined', 'all']
  const filtered = filter === 'all'
    ? invitations
    : invitations.filter((i) => i.status === filter)

  const pendingCount = invitations.filter((i) => i.status === 'pending').length

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Invitations
            {pendingCount > 0 && (
              <span
                className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent-text)' }}
              >
                {pendingCount} pending
              </span>
            )}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Project collaboration invitations sent to you
          </p>
        </div>
        <GlassButton variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={load}>
          Refresh
        </GlassButton>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl overflow-x-auto w-fit">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              filter === f ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
            }`}
            style={filter !== f ? { color: 'var(--text-muted)' } : {}}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="glass rounded-2xl h-40 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard padding="lg" className="flex flex-col items-center gap-3 text-center py-16">
          {filter === 'pending' ? (
            <>
              <Mail size={36} style={{ color: 'var(--text-faint)' }} />
              <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No pending invitations</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                When someone invites you to collaborate on a project, it will appear here.
              </p>
            </>
          ) : (
            <>
              <AlertCircle size={36} style={{ color: 'var(--text-faint)' }} />
              <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No {filter} invitations</p>
            </>
          )}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {filtered.map((inv) => (
              <InvitationCard
                key={inv._id}
                inv={inv}
                onAccept={(id) => respond(id, 'accept')}
                onDecline={(id) => respond(id, 'decline')}
                responding={responding}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
