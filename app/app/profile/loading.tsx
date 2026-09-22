import { Skeleton } from '@/components/ui/Loading'

/**
 * Profile page skeleton — shown by Next.js Suspense streaming while the server
 * component (requireAuth + DB query) resolves.
 *
 * Matches the Liquid Glass design system and the actual profile layout so there
 * is no jarring layout shift when the real content streams in.
 */
export default function ProfileLoading() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-4 max-w-2xl mx-auto">

      {/* ── Hero skeleton ─────────────────────────────────────────────────── */}
      <div className="glass-elevated rounded-2xl p-5 sm:p-6" aria-hidden="true">
        <div className="flex flex-col sm:flex-row items-center sm:items-center gap-5">
          {/* Avatar circle */}
          <Skeleton className="w-20 h-20 sm:w-[72px] sm:h-[72px] rounded-full flex-shrink-0" />
          {/* Identity lines */}
          <div className="min-w-0 flex-1 w-full flex flex-col items-center sm:items-start gap-2">
            <Skeleton className="h-6 w-40 rounded-lg" />
            <Skeleton className="h-3.5 w-56 rounded-lg" />
            <Skeleton className="h-5 w-28 rounded-full mt-0.5" />
          </div>
        </div>
      </div>

      {/* ── LifeFlow ID skeleton ───────────────────────────────────────────── */}
      <div className="glass-elevated rounded-2xl p-5" aria-hidden="true">
        <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <Skeleton className="w-3.5 h-3.5 rounded" />
          <Skeleton className="h-3.5 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-7 w-36 rounded-lg" />
        <Skeleton className="h-3 w-52 rounded-lg mt-2" />
      </div>

      {/* ── Account section skeleton ───────────────────────────────────────── */}
      <div className="glass-elevated rounded-2xl p-5" aria-hidden="true">
        <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <Skeleton className="w-3.5 h-3.5 rounded" />
          <Skeleton className="h-3.5 w-20 rounded-lg" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-8 w-28 rounded-xl" />
          </div>
        </div>
      </div>

      {/* ── Collapsible section stubs (Notifications, Appearance, Security) ── */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="glass-elevated rounded-2xl" aria-hidden="true">
          <div className="flex items-center gap-2 px-5 py-[18px]">
            <Skeleton className="w-3.5 h-3.5 rounded" />
            <Skeleton className="h-3.5 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}
