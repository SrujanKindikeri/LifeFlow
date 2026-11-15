'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, UserPlus, Search, X, Crown, MoreHorizontal,
  Mail, RefreshCw, AlertCircle, Check, Clock, Send,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatRelativeTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  _id: string
  userId: string
  lifeFlowId: string
  name: string
  avatar: string | null
  role: 'owner' | 'member'
  joinedAt: string
}

interface Invitation {
  _id: string
  inviteeId: string
  inviteeName: string
  inviteeAvatar: string | null
  inviteePublicId: string | null
  status: string
  expiresAt: string
  createdAt: string
}

interface SearchResult {
  user: {
    _id: string
    publicId: string
    name: string
    avatar: string | null
  } | null
  alreadyMember?: boolean
  pendingInvitation?: boolean
  reason?: string
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, avatar, size = 32 }: { name: string; avatar: string | null; size?: number }) {
  const initials = name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} width={size} height={size}
        className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg,rgba(99,102,241,0.22),rgba(139,92,246,0.18))',
        color: 'var(--accent-text)',
        border: '1px solid rgba(99,102,241,0.25)',
      }}>
      {initials}
    </div>
  )
}

// ─── InviteModal ──────────────────────────────────────────────────────────────

function InviteModal({
  projectId,
  isOpen,
  onClose,
  onInvited,
}: {
  projectId: string
  isOpen: boolean
  onClose: () => void
  onInvited: () => void
}) {
  const { success, error: showError } = useToast()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!isOpen) { setQuery(''); setResult(null) }
  }, [isOpen])

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setResult(null); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/members/search?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Search failed')
      setResult(data)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Search failed')
      setResult(null)
    } finally {
      setSearching(false)
    }
  }, [projectId, showError])

  useEffect(() => {
    if (!query.trim()) { setResult(null); return }
    const t = setTimeout(() => void search(query), 400)
    return () => clearTimeout(t)
  }, [query, search])

  async function invite() {
    if (!result?.user) return
    setSending(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteeId: result.user._id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed to send invitation')
      success(data.emailSent ? 'Invitation sent and email delivered!' : 'Invitation sent (email delivery failed — they can still see it in-app).')
      onInvited()
      onClose()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to send invitation')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Invite Member" size="sm">
      <div className="flex flex-col gap-4">
        <GlassInput
          label="Search by email or LifeFlow ID"
          placeholder="e.g. jane@example.com or LF-7K29X4P1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={searching ? (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : <Search size={14} />}
          autoFocus
        />

        <AnimatePresence mode="wait">
          {result !== null && (
            <motion.div key="result" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {result.user === null ? (
                <GlassCard padding="sm" className="flex items-center gap-2">
                  <AlertCircle size={14} style={{ color: 'var(--text-faint)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {result.reason === 'self' ? "You can't invite yourself." : 'No LifeFlow account found with that email or ID.'}
                  </p>
                </GlassCard>
              ) : result.alreadyMember ? (
                <GlassCard padding="sm" className="flex items-center gap-2">
                  <Check size={14} style={{ color: 'var(--success-text)' }} />
                  <div className="flex items-center gap-2 flex-1">
                    <Avatar name={result.user.name} avatar={result.user.avatar} size={28} />
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{result.user.name}</p>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--success-text)' }}>Already a member</span>
                </GlassCard>
              ) : result.pendingInvitation ? (
                <GlassCard padding="sm" className="flex items-center gap-2">
                  <Clock size={14} style={{ color: '#f59e0b' }} />
                  <div className="flex items-center gap-2 flex-1">
                    <Avatar name={result.user.name} avatar={result.user.avatar} size={28} />
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{result.user.name}</p>
                  </div>
                  <span className="text-xs" style={{ color: '#f59e0b' }}>Invite pending</span>
                </GlassCard>
              ) : (
                <GlassCard padding="sm" className="flex items-center gap-3">
                  <Avatar name={result.user.name} avatar={result.user.avatar} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{result.user.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{result.user.publicId}</p>
                  </div>
                  <GlassButton variant="primary" size="sm" loading={sending} icon={<Send size={12} />} onClick={invite}>
                    Invite
                  </GlassButton>
                </GlassCard>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Only existing LifeFlow accounts can be invited. An email notification will be sent.
        </p>
      </div>
    </Modal>
  )
}

// ─── CollaborationPanel ───────────────────────────────────────────────────────

interface CollaborationPanelProps {
  projectId: string
  isOwner: boolean
  collaborationEnabled: boolean
  onCollabToggle: (enabled: boolean) => void
}

export function CollaborationPanel({
  projectId,
  isOwner,
  collaborationEnabled,
  onCollabToggle,
}: CollaborationPanelProps) {
  const { success, error: showError } = useToast()
  const [members, setMembers]             = useState<Member[]>([])
  const [invitations, setInvitations]     = useState<Invitation[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [togglingCollab, setTogglingCollab] = useState(false)
  const [inviteOpen, setInviteOpen]       = useState(false)
  const [removeTarget, setRemoveTarget]   = useState<Member | null>(null)
  const [removing, setRemoving]           = useState(false)
  const [cancelTarget, setCancelTarget]   = useState<Invitation | null>(null)
  const [cancelling, setCancelling]       = useState(false)
  const [resendingId, setResendingId]     = useState<string | null>(null)
  const [memberMenuId, setMemberMenuId]   = useState<string | null>(null)

  const loadCollabData = useCallback(async () => {
    if (!collaborationEnabled && !isOwner) return
    setLoadingMembers(true)
    try {
      const [mRes, iRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/members`),
        isOwner ? fetch(`/api/projects/${projectId}/invitations`) : Promise.resolve(null),
      ])
      if (mRes.ok) {
        const md = await mRes.json()
        setMembers(md.members)
      }
      if (iRes?.ok) {
        const id = await iRes.json()
        setInvitations(id.invitations)
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingMembers(false)
    }
  }, [projectId, collaborationEnabled, isOwner])

  useEffect(() => { void loadCollabData() }, [loadCollabData])

  async function toggleCollaboration() {
    setTogglingCollab(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/collaboration`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !collaborationEnabled }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error?.message ?? 'Failed')
      }
      const data = await res.json()
      onCollabToggle(data.collaborationEnabled)
      success(data.collaborationEnabled ? 'Collaboration enabled' : 'Collaboration disabled')
      void loadCollabData()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setTogglingCollab(false)
    }
  }

  async function removeMember() {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/members?memberId=${removeTarget.userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error?.message ?? 'Failed to remove')
      }
      success(`${removeTarget.name} removed from project`)
      setRemoveTarget(null)
      void loadCollabData()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setRemoving(false)
    }
  }

  async function cancelInvitation() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/invitations/${cancelTarget._id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error?.message ?? 'Failed to cancel')
      }
      success('Invitation cancelled')
      setCancelTarget(null)
      void loadCollabData()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to cancel invitation')
    } finally {
      setCancelling(false)
    }
  }

  async function resendInvitation(invId: string) {
    setResendingId(invId)
    try {
      const res = await fetch(`/api/projects/${projectId}/invitations/${invId}/resend`, {
        method: 'POST',
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? 'Failed')
      success(d.emailSent ? 'Invitation email resent!' : 'Could not deliver email. Try again later.')
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to resend')
    } finally {
      setResendingId(null)
    }
  }

  const pendingInvitations = invitations.filter((i) => i.status === 'pending')

  return (
    <GlassCard padding="md" className="flex flex-col gap-5">
      {/* Section header + toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Collaboration
          </h3>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            {/* Toggle pill */}
            <button
              onClick={toggleCollaboration}
              disabled={togglingCollab}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-ring disabled:opacity-50"
              style={{
                background: collaborationEnabled ? 'var(--accent)' : 'var(--border)',
              }}
              aria-label={collaborationEnabled ? 'Disable collaboration' : 'Enable collaboration'}
            >
              <span
                className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                style={{ transform: collaborationEnabled ? 'translateX(24px)' : 'translateX(4px)' }}
              />
            </button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {collaborationEnabled ? 'On' : 'Off'}
            </span>
          </div>
        )}
      </div>

      {!collaborationEnabled && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {isOwner
            ? 'Enable collaboration to invite others to this project.'
            : 'Collaboration is currently disabled for this project.'}
        </p>
      )}

      {collaborationEnabled && (
        <>
          {/* Members list */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Members ({members.length})
              </p>
              {isOwner && (
                <GlassButton
                  variant="ghost"
                  size="xs"
                  icon={<UserPlus size={12} />}
                  onClick={() => setInviteOpen(true)}
                >
                  Invite
                </GlassButton>
              )}
            </div>

            {loadingMembers ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="glass rounded-xl h-12 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
                ))}
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-faint)' }}>
                No members yet. Invite someone to get started.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <AnimatePresence>
                  {members.map((m) => (
                    <motion.div
                      key={m._id}
                      layout
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'rgba(0,0,0,0.02)' }}
                    >
                      <Avatar name={m.name} avatar={m.avatar} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {m.name}
                          </p>
                          {m.role === 'owner' && (
                            <Crown size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                          )}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {m.role === 'owner' ? 'Owner' : `Joined ${formatRelativeTime(m.joinedAt)}`}
                        </p>
                      </div>
                      {isOwner && m.role !== 'owner' && (
                        <div className="relative">
                          <button
                            onClick={() => setMemberMenuId(memberMenuId === m._id ? null : m._id)}
                            className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                            style={{ color: 'var(--text-muted)' }}
                            aria-label="Member options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          <AnimatePresence>
                            {memberMenuId === m._id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="absolute right-0 top-8 z-20 glass-floating rounded-xl shadow-lg py-1 min-w-[120px]"
                                onBlur={() => setMemberMenuId(null)}
                              >
                                <button
                                  onClick={() => { setRemoveTarget(m); setMemberMenuId(null) }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/[0.05] transition-colors"
                                  style={{ color: 'var(--danger-text)' }}
                                >
                                  <X size={12} /> Remove
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Pending invitations (owner only) */}
          {isOwner && pendingInvitations.length > 0 && (
            <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Pending Invitations ({pendingInvitations.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv._id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)' }}
                  >
                    <Avatar name={inv.inviteeName} avatar={inv.inviteeAvatar} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {inv.inviteeName}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        Invited {formatRelativeTime(inv.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => resendInvitation(inv._id)}
                        disabled={resendingId === inv._id}
                        title="Resend email"
                        className="p-1.5 rounded-lg hover:bg-black/[0.05] disabled:opacity-50 transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {resendingId === inv._id
                          ? <RefreshCw size={12} className="animate-spin" />
                          : <Mail size={12} />
                        }
                      </button>
                      <button
                        onClick={() => setCancelTarget(inv)}
                        title="Cancel invitation"
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        style={{ color: 'var(--danger-text)' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <InviteModal
        projectId={projectId}
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={loadCollabData}
      />

      <ConfirmDialog
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removeMember}
        loading={removing}
        title="Remove Member"
        message={`Remove ${removeTarget?.name ?? ''} from this project? They will lose access immediately. Their messages and activity will be preserved.`}
        confirmLabel="Remove Member"
        danger
      />

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelInvitation}
        loading={cancelling}
        title="Cancel Invitation"
        message={`Cancel the invitation to ${cancelTarget?.inviteeName ?? ''}? The invitation link will be invalidated immediately.`}
        confirmLabel="Cancel Invitation"
        danger
      />
    </GlassCard>
  )
}
