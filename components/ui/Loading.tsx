'use client'

import { cn } from '@/lib/utils'

/* ── Skeleton atom ──────────────────────────────────────────────────────── */
export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return <div className={cn('skeleton', className)} style={style} aria-hidden="true" />
}

/* ── Skeleton card ──────────────────────────────────────────────────────── */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('glass rounded-2xl p-5 space-y-3', className)}
      aria-hidden="true"
    >
      <Skeleton className="h-4 w-2/3 rounded-lg" />
      <Skeleton className="h-3 w-full rounded-lg" />
      <Skeleton className="h-3 w-4/5 rounded-lg" />
    </div>
  )
}

/* ── Skeleton list ──────────────────────────────────────────────────────── */
export function SkeletonList({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="glass-subtle rounded-xl p-3.5 flex items-center gap-3"
        >
          <Skeleton className="h-5 w-5 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 rounded-lg" style={{ width: `${58 + i * 9}%` }} />
            <Skeleton className="h-2.5 w-2/5 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Empty state ────────────────────────────────────────────────────────── */
interface EmptyStateProps {
  icon:         string
  title:        string
  description?: string
  action?:      React.ReactNode
  className?:   string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {/* Icon in a glass circle */}
      <div className="relative mb-5">
        <div
          className="glass-elevated w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        >
          {icon}
        </div>
        <div
          className="absolute inset-0 rounded-2xl blur-xl pointer-events-none"
          style={{ background: 'rgba(37,99,235,0.06)' }}
        />
      </div>

      <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h3>

      {description && (
        <p className="text-sm max-w-[260px] leading-relaxed mb-5" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}

      {action && !description && <div className="mt-4">{action}</div>}
      {action && description && action}
    </div>
  )
}

/* ── Page loader (inline) ───────────────────────────────────────────────── */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]" aria-label="Loading">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              background: 'var(--accent-light)',
              opacity: 0.5,
              animation: `bounce-dot 1.2s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Full-page loader ───────────────────────────────────────────────────── */
export function FullPageLoader() {
  return (
    <div className="app-bg fixed inset-0 flex items-center justify-center z-[999]">
      <div className="flex flex-col items-center gap-5">
        {/* Logo */}
        <div className="glass-floating w-14 h-14 rounded-2xl flex items-center justify-center">
          <span className="text-2xl">⚡</span>
        </div>
        <p className="text-[15px] font-semibold text-gradient">LifeFlow</p>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: 'var(--accent)',
                opacity: 0.45,
                animation: `bounce-dot 1.2s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
