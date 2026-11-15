'use client'

/**
 * DailyIntelligenceSection — profile settings panel for Daily Intelligence.
 *
 * Rendered inside ProfileClient. Lets users:
 * - Enable / disable Daily Intelligence
 * - Set morning and evening briefing times
 * - Opt in/out of email delivery per briefing type
 * - Toggle financial alerts inclusion
 */

import { useState } from 'react'
import { Brain, Save, Loader2, ExternalLink } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'
import Link from 'next/link'

export interface DailyIntelligencePrefs {
  enabled: boolean
  morningTime: string
  eveningTime: string
  emailMorning: boolean
  emailEvening: boolean
  includeFinancial: boolean
}

interface Props {
  initialPrefs: DailyIntelligencePrefs
  timezone: string
}

export function DailyIntelligenceSection({ initialPrefs, timezone }: Props) {
  const [prefs, setPrefs]   = useState<DailyIntelligencePrefs>(initialPrefs)
  const [saving, setSaving] = useState(false)
  const { success: toastOk, error: toastErr } = useToast()

  const toggle = (key: keyof DailyIntelligencePrefs) =>
    setPrefs((p) => ({ ...p, [key]: !p[key as keyof DailyIntelligencePrefs] }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/auth/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'updateDailyIntelligence', dailyIntelligence: prefs }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string }
        toastErr(body.error ?? 'Failed to save preferences')
      } else {
        toastOk('Daily Intelligence preferences saved')
      }
    } catch {
      toastErr('Could not reach server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="di-heading" className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center"
             style={{ background: 'rgba(99,102,241,0.12)' }}>
          <Brain size={14} style={{ color: '#6366f1' }} />
        </div>
        <div>
          <h2 id="di-heading" className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Daily Intelligence
          </h2>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Personalised morning and evening briefings
          </p>
        </div>
      </div>

      {/* Master toggle */}
      <div className="flex items-center justify-between rounded-xl p-3 glass-subtle">
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            Enable Daily Intelligence
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Generate daily briefings in the app
          </p>
        </div>
        <button
          role="switch"
          aria-checked={prefs.enabled}
          onClick={() => toggle('enabled')}
          className="relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          style={{ background: prefs.enabled ? '#6366f1' : 'rgba(0,0,0,0.12)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200"
            style={{ transform: prefs.enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {prefs.enabled && (
        <div className="space-y-4">
          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                Morning time
              </label>
              <GlassInput
                type="time"
                value={prefs.morningTime}
                onChange={(e) => setPrefs((p) => ({ ...p, morningTime: e.target.value }))}
                aria-label="Morning briefing time"
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Timezone: {timezone}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                Evening time
              </label>
              <GlassInput
                type="time"
                value={prefs.eveningTime}
                onChange={(e) => setPrefs((p) => ({ ...p, eveningTime: e.target.value }))}
                aria-label="Evening review time"
              />
            </div>
          </div>

          {/* Email toggles */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Email delivery
            </p>

            {[
              { key: 'emailMorning' as const, label: 'Morning briefing email', desc: 'Receive morning briefing by email' },
              { key: 'emailEvening' as const, label: 'Evening review email',   desc: 'Receive evening review by email' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between rounded-xl p-3 glass-subtle">
                <div>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={prefs[key]}
                  onClick={() => toggle(key)}
                  className="relative w-9 h-5 rounded-full transition-colors focus:outline-none"
                  style={{ background: prefs[key] ? '#6366f1' : 'rgba(0,0,0,0.12)' }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200"
                    style={{ transform: prefs[key] ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Financial toggle */}
          <div className="flex items-center justify-between rounded-xl p-3 glass-subtle">
            <div>
              <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                Include financial alerts
              </p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Budget, subscriptions, and money reminders
              </p>
            </div>
            <button
              role="switch"
              aria-checked={prefs.includeFinancial}
              onClick={() => toggle('includeFinancial')}
              className="relative w-9 h-5 rounded-full transition-colors focus:outline-none"
              style={{ background: prefs.includeFinancial ? '#6366f1' : 'rgba(0,0,0,0.12)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200"
                style={{ transform: prefs.includeFinancial ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </div>

          {/* Link to full briefing */}
          <Link
            href="/app/daily-intelligence"
            className="flex items-center gap-1.5 text-[12px] text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ExternalLink size={11} />
            View your current briefing
          </Link>
        </div>
      )}

      <GlassButton
        onClick={handleSave}
        disabled={saving}
        className="w-full"
        aria-label="Save Daily Intelligence preferences"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saving ? 'Saving…' : 'Save Preferences'}
      </GlassButton>
    </section>
  )
}
