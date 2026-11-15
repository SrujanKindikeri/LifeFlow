'use client'

import { cn } from '@/lib/utils'

interface AdminCardProps {
  children:   React.ReactNode
  className?: string
  padding?:   'sm' | 'md' | 'lg'
}

const paddingMap = { sm: 'p-4', md: 'p-5', lg: 'p-6' }

export function AdminCard({ children, className, padding = 'md' }: AdminCardProps) {
  return (
    <div
      className={cn(
        'glass rounded-2xl',
        paddingMap[padding],
        className,
      )}
    >
      {children}
    </div>
  )
}

interface StatCardProps {
  label:     string
  value:     string | number
  sub?:      string
  icon?:     React.ReactNode
  color?:    'default' | 'success' | 'warning' | 'danger' | 'info'
  loading?:  boolean
}

const colorMap = {
  default: { bg: 'var(--accent-dim)',   icon: 'var(--accent)',   text: 'var(--accent-text)' },
  success: { bg: 'var(--success-dim)',  icon: 'var(--success)',  text: 'var(--success-text)' },
  warning: { bg: 'var(--warning-dim)',  icon: 'var(--warning)',  text: 'var(--warning-text)' },
  danger:  { bg: 'var(--danger-dim)',   icon: 'var(--danger)',   text: 'var(--danger-text)' },
  info:    { bg: 'var(--info-dim)',     icon: 'var(--info)',     text: 'var(--info)' },
}

export function StatCard({ label, value, sub, icon, color = 'default', loading }: StatCardProps) {
  const c = colorMap[color]
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            {label}
          </p>
          {loading ? (
            <div className="h-7 w-20 rounded-lg animate-pulse" style={{ background: 'var(--border)' }} />
          ) : (
            <p className="text-[24px] font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
              {value}
            </p>
          )}
          {sub && !loading && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {sub}
            </p>
          )}
        </div>
        {icon && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: c.bg, color: c.icon }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

interface SectionHeaderProps {
  title:    string
  subtitle?: string
  action?:  React.ReactNode
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {message}
      </p>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-[13px]"
      style={{
        background: 'var(--danger-dim)',
        border: '1px solid rgba(220,38,38,0.18)',
        color: 'var(--danger-text)',
      }}
    >
      {message}
    </div>
  )
}

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  return (
    <svg className={`animate-spin ${sz}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export function StatusBadge({ status }: { status: string | undefined | null }) {
  const map: Record<string, { bg: string; text: string }> = {
    active:       { bg: 'var(--success-dim)', text: 'var(--success-text)' },
    inactive:     { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)' },
    suspended:    { bg: 'var(--warning-dim)', text: 'var(--warning-text)' },
    deleted:      { bg: 'var(--danger-dim)',  text: 'var(--danger-text)' },
    success:      { bg: 'var(--success-dim)', text: 'var(--success-text)' },
    failure:      { bg: 'var(--danger-dim)',  text: 'var(--danger-text)' },
    denied:       { bg: 'var(--warning-dim)', text: 'var(--warning-text)' },
    sent_to_smtp: { bg: 'var(--success-dim)', text: 'var(--success-text)' },
    failed:       { bg: 'var(--danger-dim)',  text: 'var(--danger-text)' },
    pending:      { bg: 'var(--warning-dim)', text: 'var(--warning-text)' },
    processing:   { bg: 'var(--info-dim)',    text: 'var(--info)' },
    skipped:      { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)' },
    published:    { bg: 'var(--success-dim)', text: 'var(--success-text)' },
    draft:        { bg: 'var(--warning-dim)', text: 'var(--warning-text)' },
    scheduled:    { bg: 'var(--info-dim)',    text: 'var(--info)' },
    expired:      { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)' },
    super_admin:  { bg: 'rgba(220,38,38,0.10)',  text: '#b91c1c' },
    admin:        { bg: 'var(--accent-dim)',  text: 'var(--accent-text)' },
    support:      { bg: 'var(--success-dim)', text: 'var(--success-text)' },
    auditor:      { bg: 'var(--warning-dim)', text: 'var(--warning-text)' },
    unknown:      { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)' },
  }
  // Normalize: guard against undefined, null, and empty strings that arrive
  // from lean() docs that predate the accountStatus field default.
  const normalized =
    typeof status === 'string' && status.trim()
      ? status.trim().toLowerCase()
      : 'unknown'
  const label = normalized.replace(/_/g, ' ')
  const style = map[normalized] ?? { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.text }}
    >
      {label}
    </span>
  )
}

interface ConfirmDialogProps {
  open:       boolean
  title:      string
  message:    string
  confirmLabel?: string
  danger?:    boolean
  loading?:   boolean
  onConfirm:  () => void
  onCancel:   () => void
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm',
  danger = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        className="relative glass-floating rounded-2xl p-6 w-full max-w-sm"
        style={{ boxShadow: 'var(--glass-shadow-lg)' }}
      >
        <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <p className="text-[13px] mb-5" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: danger ? 'var(--danger)' : 'var(--accent)' }}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Pagination({
  page, hasMore, onPrev, onNext, total, limit,
}: {
  page: number; hasMore: boolean; onPrev: () => void; onNext: () => void;
  total: number; limit: number;
}) {
  const start = (page - 1) * limit + 1
  const end   = Math.min(page * limit, total)
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        Showing {start}–{end} of {total}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Next
        </button>
      </div>
    </div>
  )
}
