/**
 * lib/support/presence.ts — Server-side online presence for support chat.
 *
 * DESIGN
 * ──────
 * Presence is tracked per-process using a module-level Map keyed by ticketId.
 * Each ticket has at most one user slot and N admin slots. A "lease" is a
 * record of { role, id, name, lastSeen } where lastSeen is a server-stamped
 * UTC timestamp.
 *
 * SINGLE-PROCESS LIMITATION
 * ──────────────────────────
 * Like the rate limiter, this store is in-process memory and is NOT shared
 * across multiple Node.js worker processes or Docker replicas. For a single-
 * container deployment (EC2/Azure VM with one process) this is correct.
 * For multi-replica deployments replace with a Redis presence store.
 *
 * LEASE EXPIRY
 * ─────────────
 * Clients must call POST /api/support/presence/heartbeat every
 * HEARTBEAT_INTERVAL_MS (20 s). A lease is considered stale — and the
 * participant offline — after LEASE_TTL_MS (45 s) without a heartbeat.
 * This means: disconnect detected within ~45 s of browser close/crash.
 *
 * SSE INTEGRATION
 * ────────────────
 * The SSE stream at GET /api/support/tickets/[id]/stream:
 *  1. Registers the participant's lease on connect.
 *  2. Publishes a 'presence' event to all streams on the same ticket when
 *     someone joins or leaves.
 *  3. Deregisters the lease when the SSE stream closes (AbortSignal fires).
 *
 * SERVER-ONLY — never import from client components.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** How often clients must heartbeat (ms) */
export const HEARTBEAT_INTERVAL_MS = 20_000

/** Lease TTL — participant is offline if lastSeen is older than this */
export const LEASE_TTL_MS = 45_000

/** How often to sweep expired leases (ms) */
const SWEEP_INTERVAL_MS = 30_000

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PresenceLease {
  /** 'user' | 'admin' */
  role:     'user' | 'admin'
  /** userId (for users) or adminId (for admins) */
  id:       string
  name:     string
  lastSeen: number   // Date.now()
}

export interface TicketPresence {
  /** There is at most one user online per ticket */
  user:   PresenceLease | null
  /** Map of adminId → lease */
  admins: Map<string, PresenceLease>
}

// ── Store ──────────────────────────────────────────────────────────────────────

// ticketId (string) → TicketPresence
const presenceStore = new Map<string, TicketPresence>()

// ── SSE broadcaster ────────────────────────────────────────────────────────────
// Each active SSE connection registers a broadcast callback so messages and
// presence updates can be pushed without polling.
// ticketId → Set of (data: string) => void

type BroadcastFn = (data: string) => void

const sseChannels = new Map<string, Set<BroadcastFn>>()

// ── SSE channel management ─────────────────────────────────────────────────────

export function registerSseChannel(ticketId: string, fn: BroadcastFn): void {
  if (!sseChannels.has(ticketId)) sseChannels.set(ticketId, new Set())
  sseChannels.get(ticketId)!.add(fn)
}

export function unregisterSseChannel(ticketId: string, fn: BroadcastFn): void {
  sseChannels.get(ticketId)?.delete(fn)
  if (sseChannels.get(ticketId)?.size === 0) sseChannels.delete(ticketId)
}

/**
 * Broadcast a server-sent event to ALL active SSE streams on a ticket.
 * @param ticketId  The ticket whose streams receive the event.
 * @param eventType SSE event type string (e.g. 'message', 'presence', 'status').
 * @param payload   JSON-serialisable payload.
 */
export function broadcastToTicket(
  ticketId: string,
  eventType: string,
  payload: unknown,
): void {
  const channels = sseChannels.get(ticketId)
  if (!channels || channels.size === 0) return
  const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const fn of channels) {
    try { fn(data) } catch { /* ignore dead streams */ }
  }
}

// ── Presence management ────────────────────────────────────────────────────────

function getOrCreateTicketPresence(ticketId: string): TicketPresence {
  if (!presenceStore.has(ticketId)) {
    presenceStore.set(ticketId, { user: null, admins: new Map() })
  }
  return presenceStore.get(ticketId)!
}

/**
 * Register or refresh an online lease for a participant.
 * Returns the updated TicketPresence snapshot (with live counts).
 */
export function registerPresence(
  ticketId: string,
  lease: Omit<PresenceLease, 'lastSeen'>,
): TicketPresence {
  const tp = getOrCreateTicketPresence(ticketId)
  const now = Date.now()
  const full: PresenceLease = { ...lease, lastSeen: now }

  if (lease.role === 'user') {
    tp.user = full
  } else {
    tp.admins.set(lease.id, full)
  }

  return tp
}

/**
 * Deregister a participant's lease (on SSE disconnect or explicit leave).
 */
export function deregisterPresence(
  ticketId: string,
  role: 'user' | 'admin',
  id: string,
): void {
  const tp = presenceStore.get(ticketId)
  if (!tp) return

  if (role === 'user') {
    if (tp.user?.id === id) tp.user = null
  } else {
    tp.admins.delete(id)
  }

  // Clean up empty ticket presence
  if (!tp.user && tp.admins.size === 0) {
    presenceStore.delete(ticketId)
  }
}

/**
 * Refresh the lastSeen timestamp for an existing lease (heartbeat).
 * Returns false if no lease was found (participant not registered).
 */
export function heartbeat(
  ticketId: string,
  role: 'user' | 'admin',
  id: string,
): boolean {
  const tp = presenceStore.get(ticketId)
  if (!tp) return false

  if (role === 'user') {
    if (tp.user?.id === id) {
      tp.user.lastSeen = Date.now()
      return true
    }
    return false
  }

  const lease = tp.admins.get(id)
  if (lease) {
    lease.lastSeen = Date.now()
    return true
  }
  return false
}

/**
 * Get the current presence snapshot for a ticket.
 * Returns null if no presence records exist.
 */
export function getPresence(ticketId: string): {
  userOnline: boolean
  adminOnline: boolean
  onlineAdminNames: string[]
} {
  const tp = presenceStore.get(ticketId)
  if (!tp) return { userOnline: false, adminOnline: false, onlineAdminNames: [] }

  const now = Date.now()
  const userOnline   = !!(tp.user && now - tp.user.lastSeen < LEASE_TTL_MS)
  const liveAdmins   = [...tp.admins.values()].filter(a => now - a.lastSeen < LEASE_TTL_MS)
  const adminOnline  = liveAdmins.length > 0
  const onlineAdminNames = liveAdmins.map(a => a.name)

  return { userOnline, adminOnline, onlineAdminNames }
}

// ── Stale lease sweep ──────────────────────────────────────────────────────────

function sweepExpiredLeases(): void {
  const now = Date.now()
  for (const [ticketId, tp] of presenceStore.entries()) {
    let changed = false

    if (tp.user && now - tp.user.lastSeen >= LEASE_TTL_MS) {
      tp.user = null
      changed = true
    }
    for (const [adminId, lease] of tp.admins.entries()) {
      if (now - lease.lastSeen >= LEASE_TTL_MS) {
        tp.admins.delete(adminId)
        changed = true
      }
    }

    if (!tp.user && tp.admins.size === 0) {
      presenceStore.delete(ticketId)
      continue
    }

    // Broadcast updated presence to any listening streams
    if (changed) {
      const snap = getPresence(ticketId)
      broadcastToTicket(ticketId, 'presence', snap)
    }
  }
}

// Run the sweep in server context only
if (typeof setInterval !== 'undefined') {
  setInterval(sweepExpiredLeases, SWEEP_INTERVAL_MS).unref?.()
}
