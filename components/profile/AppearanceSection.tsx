'use client'

/**
 * components/profile/AppearanceSection.tsx
 *
 * "Appearance & Experience" collapsible section for the Profile page.
 * Matches the existing LifeFlow Liquid Glass UI precisely.
 *
 * Features:
 *  - Theme picker: Light / Dark / System (segmented control)
 *  - Night Shift toggle + time range editor (HH:MM 24-hour, timezone-aware)
 *  - Turn Tone toggle + volume slider
 *
 * Changes are saved to /api/auth/me (action: 'updateAppearance') and applied
 * instantly via ThemeProvider without a page reload.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Monitor, Moon, Sun, ChevronDown, Volume2, Music, Palette, Clock } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { useAppearance } from '@/hooks/useAppearance'
import { playTone, prewarmAudio } from '@/lib/tonePlayer'
import type { AppearancePreferences, AppTheme } from '@/types'
import { DEFAULT_APPEARANCE } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────

interface Props {
  /** The user's stored appearance preferences (from /api/auth/me). */
  initialPrefs: AppearancePreferences
  /** The user's IANA timezone string — used for Night Shift display. */
  timezone: string
  /** Framer Motion variants (stagger child). */
  variants?: import('framer-motion').Variants
}

// ── Theme option data ──────────────────────────────────────────────────────

const THEME_OPTIONS: { value: AppTheme; label: string; icon: React.ReactNode }[] = [
  { value: 'light',  label: 'Light',  icon: <Sun    size={13} aria-hidden /> },
  { value: 'dark',   label: 'Dark',   icon: <Moon   size={13} aria-hidden /> },
  { value: 'system', label: 'System', icon: <Monitor size={13} aria-hidden /> },
]

// ── Sub-components ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-1',
        checked ? 'bg-indigo-500' : '',
      )}
      style={!checked ? { background: 'rgba(0,0,0,0.12)' } : {}}
    >
      <motion.div
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? '22px' : '2px' }}
        transition={{ type: 'spring', stiffness: 520, damping: 32 }}
        aria-hidden
      />
    </button>
  )
}

function SectionHeader({
  headerId,
  panelId,
  isOpen,
  onToggle,
  icon,
  title,
}: {
  headerId: string
  panelId: string
  isOpen: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      id={headerId}
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 px-5 py-[18px] text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-inset',
        'transition-colors hover:bg-black/[0.02] active:bg-black/[0.04]',
        isOpen && 'border-b',
      )}
      style={isOpen ? { borderColor: 'rgba(0,0,0,0.07)' } : {}}
    >
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <h3 className="text-[13px] font-semibold flex-1" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      <motion.span
        animate={{ rotate: isOpen ? 180 : 0 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
        aria-hidden
      >
        <ChevronDown size={14} />
      </motion.span>
    </button>
  )
}

// ── Time input — mobile-friendly HH:MM picker ─────────────────────────────

function TimeInput({
  value,
  onChange,
  label,
  id,
}: {
  value: string   // "HH:MM"
  onChange: (v: string) => void
  label: string
  id: string
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'glass-input rounded-xl px-3 py-2 text-[13px] font-mono w-full',
          'focus-visible:outline-none',
        )}
        aria-label={label}
      />
    </div>
  )
}

// ── Volume slider ──────────────────────────────────────────────────────────

function VolumeSlider({
  value,
  onChange,
}: {
  value: number   // 0–1
  onChange: (v: number) => void
}) {
  const id = useId()
  const pct = Math.round(value * 100)

  return (
    <div className="flex items-center gap-3">
      <Volume2 size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} aria-hidden />
      <div className="flex-1 flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          aria-label="Notification tone volume"
          aria-valuetext={`${pct}%`}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            // CSS custom properties trick for a cross-browser filled track
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--glass-subtle-border) ${pct}%, var(--glass-subtle-border) 100%)`,
            outline: 'none',
          }}
        />
        <span className="text-[11px] tabular-nums w-7 text-right" style={{ color: 'var(--text-faint)' }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

// ── Main exported component ────────────────────────────────────────────────

export function AppearanceSection({ initialPrefs, timezone, variants }: Props) {
  const panelId  = useId()
  const headerId = useId()
  const startId  = useId()
  const endId    = useId()

  const { success, error: toastError } = useToast()
  const { applyAppearance } = useAppearance()

  // ── Local state ──
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('lf_appearance_section_open') === 'true'
    } catch {
      return false
    }
  })

  function toggleOpen() {
    setIsOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem('lf_appearance_section_open', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Merge incoming server prefs with defaults so missing fields never crash
  const merged: AppearancePreferences = { ...DEFAULT_APPEARANCE, ...initialPrefs }

  const [prefs,   setPrefs]   = useState<AppearancePreferences>(merged)
  const [saving,  setSaving]  = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(false)

  // Keep prefs in sync if the parent re-fetches the user (e.g. after save)
  const lastInitialRef = useRef(initialPrefs)
  useEffect(() => {
    if (JSON.stringify(initialPrefs) !== JSON.stringify(lastInitialRef.current)) {
      lastInitialRef.current = initialPrefs
      setPrefs({ ...DEFAULT_APPEARANCE, ...initialPrefs })
    }
  }, [initialPrefs])

  // ── Save to server ──────────────────────────────────────────────────────
  const save = useCallback(async (next: AppearancePreferences) => {
    setSaving(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateAppearance', appearancePreferences: next }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        toastError(data.error ?? 'Failed to save appearance settings')
        return
      }
      // Apply immediately — no reload needed
      applyAppearance(next)
      success('Appearance settings saved')
    } catch {
      toastError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [applyAppearance, success, toastError])

  // ── Helpers ─────────────────────────────────────────────────────────────

  function update(partial: Partial<AppearancePreferences>) {
    setPrefs((p) => ({ ...p, ...partial }))
  }

  function updateAndSave(partial: Partial<AppearancePreferences>) {
    const next = { ...prefs, ...partial }
    setPrefs(next)
    void save(next)
  }

  // Format HH:MM 24h → 12h label for display
  function formatTime12(hhmm: string): string {
    const [hStr, mStr] = hhmm.split(':')
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12    = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }

  // ── Tone preview ─────────────────────────────────────────────────────────
  async function previewTone() {
    prewarmAudio()
    await playTone(prefs.turnToneVolume)
  }

  return (
    <motion.div variants={variants} className="glass rounded-2xl overflow-hidden">

      {/* ── Header ── */}
      <SectionHeader
        headerId={headerId}
        panelId={panelId}
        isOpen={isOpen}
        onToggle={toggleOpen}
        icon={<Palette size={14} />}
        title="Appearance & Experience"
      />

      {/* ── Collapsible panel ── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="appearance-panel"
            id={panelId}
            role="region"
            aria-labelledby={headerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-5 pt-4 pb-5 flex flex-col gap-5">

              {/* ══════════════════════════════════════════════════════════
                  THEME
              ══════════════════════════════════════════════════════════ */}
              <div className="flex flex-col gap-3">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-faint)' }}
                >
                  Theme
                </p>

                {/* Segmented theme control */}
                <div
                  role="radiogroup"
                  aria-label="Theme"
                  className="flex rounded-xl p-1 gap-1"
                  style={{
                    background: 'rgba(0,0,0,0.05)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {THEME_OPTIONS.map(({ value, label, icon }) => {
                    const active = prefs.theme === value
                    return (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={active}
                        onClick={() => updateAndSave({ theme: value })}
                        disabled={saving}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg',
                          'text-[12px] font-medium transition-colors duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
                          active
                            ? 'glass-segment-active'
                            : 'hover:bg-black/[0.04] active:bg-black/[0.07]',
                        )}
                        style={{
                          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: saving ? 'wait' : 'pointer',
                        }}
                      >
                        {icon}
                        <span>{label}</span>
                      </button>
                    )
                  })}
                </div>

                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {prefs.theme === 'light'  && 'Always use the LifeFlow light theme.'}
                  {prefs.theme === 'dark'   && 'Always use the LifeFlow dark theme.'}
                  {prefs.theme === 'system' && 'Follows your OS or browser dark mode setting.'}
                </p>
              </div>

              {/* ══════════════════════════════════════════════════════════
                  NIGHT SHIFT
              ══════════════════════════════════════════════════════════ */}
              <div
                className="flex flex-col gap-3 pt-4"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                {/* Row: label + toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Moon size={13} style={{ color: 'var(--text-muted)' }} aria-hidden />
                      <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        Night Shift
                      </p>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Softer visuals during nighttime hours.
                    </p>
                  </div>
                  <Toggle
                    checked={prefs.nightShiftEnabled}
                    onChange={(v) => updateAndSave({ nightShiftEnabled: v })}
                    label="Toggle Night Shift"
                  />
                </div>

                {/* Night hours display / edit */}
                <AnimatePresence initial={false}>
                  {prefs.nightShiftEnabled && (
                    <motion.div
                      key="ns-schedule"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.20, ease: [0.4, 0, 0.2, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        className="rounded-xl p-3 flex flex-col gap-3"
                        style={{
                          background: 'rgba(0,0,0,0.03)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {/* Schedule row */}
                        <div className="flex items-center gap-2">
                          <Clock size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} aria-hidden />
                          {editingSchedule ? (
                            <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                              Night hours
                            </span>
                          ) : (
                            <span className="text-[12px] font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {formatTime12(prefs.nightShiftStart)}
                              <span className="mx-1.5" style={{ color: 'var(--text-faint)' }}>→</span>
                              {formatTime12(prefs.nightShiftEnd)}
                            </span>
                          )}
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                            style={{
                              background: 'var(--accent-dim)',
                              color: 'var(--accent-text)',
                              border: '1px solid rgba(37,99,235,0.15)',
                            }}
                          >
                            {timezone}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingSchedule((v) => !v)}
                            className="ml-auto text-[11px] font-medium hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded"
                            style={{ color: 'var(--accent)' }}
                          >
                            {editingSchedule ? 'Done' : 'Edit'}
                          </button>
                        </div>

                        {/* Time pickers — shown only when editing */}
                        <AnimatePresence initial={false}>
                          {editingSchedule && (
                            <motion.div
                              key="time-pickers"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                              style={{ overflow: 'hidden' }}
                            >
                              <div className="flex gap-3 pt-1">
                                <TimeInput
                                  id={startId}
                                  label="Start"
                                  value={prefs.nightShiftStart}
                                  onChange={(v) => update({ nightShiftStart: v })}
                                />
                                <TimeInput
                                  id={endId}
                                  label="End"
                                  value={prefs.nightShiftEnd}
                                  onChange={(v) => update({ nightShiftEnd: v })}
                                />
                              </div>
                              <div className="flex justify-end pt-2">
                                <GlassButton
                                  variant="primary"
                                  size="sm"
                                  loading={saving}
                                  onClick={() => {
                                    setEditingSchedule(false)
                                    void save(prefs)
                                  }}
                                >
                                  Save Schedule
                                </GlassButton>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ══════════════════════════════════════════════════════════
                  TURN TONE
              ══════════════════════════════════════════════════════════ */}
              <div
                className="flex flex-col gap-3 pt-4"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                {/* Row: label + toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Music size={13} style={{ color: 'var(--text-muted)' }} aria-hidden />
                      <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        Turn Tone
                      </p>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Play a subtle sound for new notifications.
                    </p>
                  </div>
                  <Toggle
                    checked={prefs.turnToneEnabled}
                    onChange={(v) => updateAndSave({ turnToneEnabled: v })}
                    label="Toggle Turn Tone"
                  />
                </div>

                {/* Volume + preview — shown when tone is enabled */}
                <AnimatePresence initial={false}>
                  {prefs.turnToneEnabled && (
                    <motion.div
                      key="tone-volume"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.20, ease: [0.4, 0, 0.2, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        className="rounded-xl p-3 flex flex-col gap-3"
                        style={{
                          background: 'rgba(0,0,0,0.03)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <p
                          className="text-[11px] font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-faint)' }}
                        >
                          Volume
                        </p>

                        <VolumeSlider
                          value={prefs.turnToneVolume}
                          onChange={(v) => update({ turnToneVolume: v })}
                        />

                        {/* Save volume + preview row */}
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <button
                            type="button"
                            onClick={previewTone}
                            className="text-[11px] font-medium hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded"
                            style={{ color: 'var(--accent)' }}
                          >
                            Preview tone
                          </button>
                          <GlassButton
                            variant="primary"
                            size="sm"
                            loading={saving}
                            onClick={() => void save(prefs)}
                          >
                            Save Volume
                          </GlassButton>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
