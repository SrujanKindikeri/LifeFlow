'use client'

/**
 * SettingsClient.tsx — Admin Settings UI
 *
 * Renders the 5 application settings with:
 *   - Current persisted values loaded from the server
 *   - Appropriate control per type (toggle / validated number input / read-only)
 *   - Confirmation dialog before applying maintenance_mode or signup_enabled changes
 *   - Duplicate-submission prevention (saving state per key)
 *   - Server-confirmed value displayed after save (not the submitted value)
 *   - Reverts unsaved changes on failed writes
 *   - Current user count and max_users context
 *   - app_version read-only display with live build version
 *   - Last-updated timestamp and actor identity
 *   - Full loading / success / validation / failure state handling
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Save, Lock, RefreshCw, Users, Bell, Wrench, ToggleRight,
  Tag, AlertTriangle, CheckCircle, Info,
} from 'lucide-react'
import {
  AdminCard,
  SectionHeader,
  ErrorState,
  LoadingSpinner,
} from '@/components/admin/AdminCard'
import type { AdminRole } from '@/models/AdminUser'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Setting {
  _id:           string
  key:           string
  label:         string
  description:   string
  value:         string
  valueType:     string
  readOnly:      boolean
  lastChangedBy: string | null
  updatedAt:     string
}

interface SettingsMeta {
  activeUserCount: number
  buildVersion:    string
}

// Per-key save result: 'success' | 'error' | null
type SaveResult = Record<string, 'success' | 'error' | null>

// ── Key-specific metadata ─────────────────────────────────────────────────────

interface KeyMeta {
  icon:         React.ReactNode
  impact:       string | null   // shown in confirmation dialog
  confirmTitle: string | null   // confirmation dialog title
}

function getKeyMeta(key: string): KeyMeta {
  switch (key) {
    case 'maintenance_mode':
      return {
        icon:         <Wrench size={14} />,
        impact:       'Enabling this will immediately redirect all non-admin users to a maintenance page. They will not be able to access the application until you disable it.',
        confirmTitle: 'Enable Maintenance Mode?',
      }
    case 'signup_enabled':
      return {
        icon:         <Users size={14} />,
        impact:       'Disabling this will immediately block all new user registrations. Existing users are not affected.',
        confirmTitle: 'Disable User Sign-up?',
      }
    case 'max_users':
      return {
        icon:         <Users size={14} />,
        impact:       null,
        confirmTitle: null,
      }
    case 'notification_scheduler_enabled':
      return {
        icon:         <Bell size={14} />,
        impact:       'Disabling this stops all scheduled notifications immediately. Pending records are preserved. No notifications will fire until you re-enable it.',
        confirmTitle: 'Disable Notification Scheduler?',
      }
    case 'app_version':
      return {
        icon:         <Tag size={14} />,
        impact:       null,
        confirmTitle: null,
      }
    default:
      return { icon: <ToggleRight size={14} />, impact: null, confirmTitle: null }
  }
}

/**
 * Returns true if this key+value change requires a confirmation dialog.
 * Only warn when turning ON maintenance mode or turning OFF signup/scheduler.
 */
function needsConfirmation(key: string, newValue: string): boolean {
  if (key === 'maintenance_mode'               && newValue === 'true')  return true
  if (key === 'signup_enabled'                 && newValue === 'false') return true
  if (key === 'notification_scheduler_enabled' && newValue === 'false') return true
  return false
}

// ── Confirmation dialog ───────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title:    string
  impact:   string
  onConfirm: () => void
  onCancel:  () => void
}

function ConfirmDialog({ title, impact, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="glass-floating glass-catchlight relative w-full max-w-sm rounded-[20px] overflow-hidden"
        style={{ boxShadow: 'var(--glass-shadow-xl)' }}
      >
        {/* Top specular highlight */}
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }}
        />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--warning-dim)', color: 'var(--warning)' }}
            >
              <AlertTriangle size={16} />
            </div>
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h3>
          </div>
          <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--text-secondary)' }}>
            {impact}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-semibold"
              style={{
                background: 'var(--glass-subtle-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
              style={{ background: 'var(--warning)' }}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsClient({ adminRole }: { adminRole: AdminRole }) {
  const [settings,    setSettings]    = useState<Setting[]>([])
  const [meta,        setMeta]        = useState<SettingsMeta | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  // Dirty edit buffer: key → pending string value
  const [editing,     setEditing]     = useState<Record<string, string>>({})
  // Validation errors per key
  const [valErrors,   setValErrors]   = useState<Record<string, string>>({})
  // Per-key save in-flight state
  const [saving,      setSaving]      = useState<Record<string, boolean>>({})
  // Per-key last save result
  const [saveResult,  setSaveResult]  = useState<SaveResult>({})
  // Confirmation dialog state
  const [confirm, setConfirm] = useState<{
    key:   string
    value: string
    meta:  KeyMeta
  } | null>(null)

  const isSuperAdmin = adminRole === 'super_admin'

  // Auto-clear per-key success banner after 3 s
  const resultTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const clearResult = useCallback((key: string) => {
    setSaveResult((r) => ({ ...r, [key]: null }))
  }, [])

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/settings')
      const json = await res.json() as {
        settings?: Setting[]
        meta?:     SettingsMeta
        error?:    { message: string }
      }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load settings')
      setSettings(json.settings ?? [])
      setMeta(json.meta ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Client-side validation ──────────────────────────────────────────────────

  function validateLocally(key: string, value: string, valueType: string): string | null {
    if (valueType === 'number' && key === 'max_users') {
      if (!/^\d+$/.test(value.trim()))
        return 'Must be a non-negative integer (e.g. 0 for unlimited)'
      const n = parseInt(value.trim(), 10)
      if (n > 10_000_000) return 'Cannot exceed 10,000,000'
    }
    if (valueType === 'number' && isNaN(Number(value))) {
      return 'Must be a valid number'
    }
    return null
  }

  // ── Save handler ────────────────────────────────────────────────────────────

  const doSave = useCallback(async (key: string, value: string) => {
    setSaving((s) => ({ ...s, [key]: true }))
    setSaveResult((r) => ({ ...r, [key]: null }))

    try {
      const res  = await fetch('/api/admin/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, value }),
      })
      const json = await res.json() as {
        ok?:      boolean
        setting?: Setting
        error?:   { message: string }
      }

      if (!res.ok) {
        // Surface the server's validation message
        setValErrors((v) => ({ ...v, [key]: json.error?.message ?? 'Save failed' }))
        // Revert the unsaved UI change back to the persisted value
        setEditing((e) => { const n = { ...e }; delete n[key]; return n })
        setSaveResult((r) => ({ ...r, [key]: 'error' }))
        return
      }

      // Update the local settings list with the server-confirmed value
      if (json.setting) {
        setSettings((prev) =>
          prev.map((s) => s.key === key ? { ...s, ...json.setting } : s)
        )
      }
      // Clear the dirty state for this key
      setEditing((e)  => { const n = { ...e };  delete n[key];  return n })
      setValErrors((v) => { const n = { ...v }; delete n[key]; return n })
      setSaveResult((r) => ({ ...r, [key]: 'success' }))

      // Auto-clear success after 3 s
      clearTimeout(resultTimers.current[key])
      resultTimers.current[key] = setTimeout(() => clearResult(key), 3000)
    } catch {
      setEditing((e) => { const n = { ...e }; delete n[key]; return n })
      setSaveResult((r) => ({ ...r, [key]: 'error' }))
      setValErrors((v) => ({ ...v, [key]: 'Network error — changes not saved' }))
    } finally {
      setSaving((s) => ({ ...s, [key]: false }))
    }
  }, [clearResult])

  // ── Change handler (toggle & text input) ───────────────────────────────────

  const handleChange = useCallback((key: string, value: string, setting: Setting) => {
    if (!isSuperAdmin || setting.readOnly) return

    // Validate locally for immediate feedback (number fields)
    const clientErr = validateLocally(key, value, setting.valueType)
    setValErrors((v) => clientErr ? { ...v, [key]: clientErr } : (() => { const n = { ...v }; delete n[key]; return n })())
    setEditing((e) => ({ ...e, [key]: value }))
  }, [isSuperAdmin])

  // ── Save trigger: immediate for toggles, button for text ───────────────────

  const triggerSave = useCallback((key: string, value: string, setting: Setting) => {
    if (!isSuperAdmin || setting.readOnly) return
    if (saving[key]) return

    if (needsConfirmation(key, value)) {
      const km = getKeyMeta(key)
      setConfirm({ key, value, meta: km })
      return
    }
    void doSave(key, value)
  }, [isSuperAdmin, saving, doSave])

  // ── Formatting helpers ──────────────────────────────────────────────────────

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  // ── Capacity status for max_users ───────────────────────────────────────────

  function renderCapacityBadge(setting: Setting): React.ReactNode {
    if (setting.key !== 'max_users' || !meta) return null
    const limit  = parseInt(setting.value, 10) || 0
    const count  = meta.activeUserCount
    if (limit === 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
          style={{ background: 'var(--success-dim)', color: 'var(--success-text)' }}
        >
          <CheckCircle size={10} /> {count} registered · Unlimited
        </span>
      )
    }
    const pct    = Math.min(100, Math.round((count / limit) * 100))
    const full   = count >= limit
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
        style={{
          background: full ? 'var(--danger-dim)' : 'var(--info-dim)',
          color:      full ? 'var(--danger-text)' : 'var(--info)',
        }}
      >
        {full ? <AlertTriangle size={10} /> : <Info size={10} />}
        {count} / {limit} registered ({pct}%){full ? ' — FULL' : ''}
      </span>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center py-12"><LoadingSpinner /></div>
  )
  if (error)   return <ErrorState message={error} />

  return (
    <>
      {/* Confirmation dialog overlay */}
      {confirm && (
        <ConfirmDialog
          title={confirm.meta.confirmTitle ?? 'Confirm Change'}
          impact={confirm.meta.impact ?? 'This will change an application setting.'}
          onCancel={() => {
            // Revert the toggle to its current persisted value
            setEditing((e) => { const n = { ...e }; delete n[confirm.key]; return n })
            setConfirm(null)
          }}
          onConfirm={() => {
            const { key, value } = confirm
            setConfirm(null)
            void doSave(key, value)
          }}
        />
      )}

      <div className="space-y-4">
        {/* Role restriction banner */}
        {!isSuperAdmin && (
          <div
            className="rounded-xl p-4 flex items-center gap-3"
            style={{
              background: 'var(--warning-dim)',
              border: '1px solid rgba(217,119,6,0.20)',
              color: 'var(--warning-text)',
            }}
          >
            <Lock size={16} />
            <p className="text-[13px]">
              Settings are read-only for your role. Only Super Admins can modify settings.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <SectionHeader
            title="Application Settings"
            subtitle="Runtime configuration — changes take effect within 30 seconds across all instances"
          />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold"
            style={{
              background: 'var(--glass-subtle-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
            title="Reload settings from server"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="space-y-3">
          {settings.map((s) => {
            const currentValue = editing[s.key] ?? s.value
            const isDirty      = editing[s.key] !== undefined && editing[s.key] !== s.value
            const isSavingKey  = saving[s.key] === true
            const result       = saveResult[s.key]
            const valErr       = valErrors[s.key]
            const km           = getKeyMeta(s.key)
            const isAppVersion = s.key === 'app_version'

            return (
              <AdminCard key={s.key}>
                <div className="flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Title + icon */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ color: 'var(--text-muted)' }}>{km.icon}</span>
                        <p
                          className="text-[13px] font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {s.label}
                        </p>
                        {s.readOnly && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{
                              background: 'var(--glass-subtle-bg)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-faint)',
                            }}
                          >
                            <Lock size={9} /> read-only
                          </span>
                        )}
                        {/* Save result badges */}
                        {result === 'success' && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{ background: 'var(--success-dim)', color: 'var(--success-text)' }}
                          >
                            <CheckCircle size={9} /> Saved
                          </span>
                        )}
                        {result === 'error' && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{ background: 'var(--danger-dim)', color: 'var(--danger-text)' }}
                          >
                            <AlertTriangle size={9} /> Failed
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p
                        className="text-[11px] mt-0.5 leading-relaxed"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {s.description}
                        {/* Inline hint for max_users=0 */}
                        {s.key === 'max_users' && currentValue === '0' && (
                          <span style={{ color: 'var(--success-text)' }}>
                            {' '}(0 = unlimited registrations)
                          </span>
                        )}
                      </p>

                      {/* Key pill */}
                      <p
                        className="text-[10px] font-mono mt-1"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        {s.key}
                      </p>

                      {/* Capacity badge for max_users */}
                      {s.key === 'max_users' && (
                        <div className="mt-1.5">{renderCapacityBadge(s)}</div>
                      )}

                      {/* app_version: show live build version prominently */}
                      {isAppVersion && meta && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold"
                            style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
                          >
                            v{meta.buildVersion}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                            running build
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Control */}
                    <div className="flex items-center gap-2 shrink-0">
                      {s.valueType === 'boolean' && !s.readOnly ? (
                        /* Toggle button */
                        <button
                          onClick={() => {
                            if (!isSuperAdmin || isSavingKey) return
                            const newVal = currentValue === 'true' ? 'false' : 'true'
                            handleChange(s.key, newVal, s)
                            triggerSave(s.key, newVal, s)
                          }}
                          disabled={!isSuperAdmin || isSavingKey}
                          aria-checked={currentValue === 'true'}
                          role="switch"
                          aria-label={s.label}
                          className="relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                          style={{
                            background: currentValue === 'true' ? 'var(--success)' : 'var(--border-strong)',
                          }}
                        >
                          <span
                            className="absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all duration-200"
                            style={{ left: currentValue === 'true' ? 'calc(100% - 18px)' : '4px' }}
                          />
                        </button>
                      ) : s.valueType === 'number' && !s.readOnly ? (
                        /* Number input */
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="\d*"
                          value={currentValue}
                          onChange={(e) => handleChange(s.key, e.target.value, s)}
                          disabled={!isSuperAdmin || isSavingKey}
                          aria-label={s.label}
                          className="px-2 py-1.5 text-[13px] rounded-lg outline-none w-28 text-center"
                          style={{
                            background: 'var(--glass-subtle-bg)',
                            border: `1px solid ${valErr ? 'var(--danger)' : 'var(--border)'}`,
                            color: 'var(--text-primary)',
                          }}
                        />
                      ) : (
                        /* Read-only string display */
                        <span
                          className="px-2 py-1 text-[12px] rounded-lg font-mono"
                          style={{
                            background: 'var(--glass-subtle-bg)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {isAppVersion ? meta?.buildVersion ?? s.value : s.value}
                        </span>
                      )}

                      {/* Spinner while saving */}
                      {isSavingKey && (
                        <LoadingSpinner size="sm" />
                      )}

                      {/* Save button for dirty number fields */}
                      {isDirty && isSuperAdmin && !s.readOnly && s.valueType !== 'boolean' && !isSavingKey && !valErr && (
                        <button
                          onClick={() => triggerSave(s.key, editing[s.key], s)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                          style={{ background: 'var(--accent)' }}
                          aria-label={`Save ${s.label}`}
                        >
                          <Save size={11} /> Save
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Validation error */}
                  {valErr && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                      style={{ background: 'var(--danger-dim)', color: 'var(--danger-text)' }}
                    >
                      <AlertTriangle size={12} />
                      {valErr}
                    </div>
                  )}

                  {/* Last-updated footer */}
                  {(s.updatedAt || s.lastChangedBy) && (
                    <div
                      className="flex items-center gap-2 pt-2"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        Last updated: {formatDate(s.updatedAt)}
                        {s.lastChangedBy && (
                          <span> · by <span className="font-mono">{s.lastChangedBy.slice(0, 8)}…</span></span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </AdminCard>
            )
          })}
        </div>

        {/* Empty state */}
        {settings.length === 0 && (
          <div className="text-center py-10">
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No settings found. They will be seeded automatically on the next request.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
