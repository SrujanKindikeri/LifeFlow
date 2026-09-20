'use client'

/**
 * TimeNotificationIcon
 *
 * Circular arc notification icon that displays the actual scheduled time of
 * a notification in the centre instead of a Wi-Fi symbol.
 *
 * Design reference:
 *   - Large circular arc (≈ 300° sweep, open at the bottom)
 *   - Four evenly-spaced dots along the bottom arc opening
 *   - Scheduled time (HH:MM) and period (AM/PM) centred inside
 *
 * Props:
 *   time            "07:00"   — the HH:MM local time
 *   period          "AM"|"PM" — derived from time if omitted
 *   notificationType          — used to pick the accent colour
 *   status                    — colours the arc: sent=green, failed=red, else blue
 *   size            px size of the bounding square (default 72)
 */

import type { ScheduledNotificationType, NotificationDeliveryStatus } from '@/types'

interface TimeNotificationIconProps {
  time: string                             // "07:00"
  period?: 'AM' | 'PM'                    // inferred from `time` if omitted
  notificationType?: ScheduledNotificationType | string
  status?: NotificationDeliveryStatus | string
  size?: number                            // bounding box side in px (default 72)
  className?: string
}

/** Accent colour per notification type */
const TYPE_ACCENT: Record<string, string> = {
  MORNING_BRIEF:         '#6366f1', // indigo
  TASK_DUE_SOON:         '#3b82f6', // blue
  TASK_INCOMPLETE_TODAY: '#f59e0b', // amber
  TASK_TOMORROW:         '#8b5cf6', // violet
  HABIT_REMINDER:        '#f97316', // orange
  HABIT_TOMORROW:        '#f97316', // orange
  DAILY_SUMMARY:         '#10b981', // emerald
  WEEKLY_SUMMARY:        '#06b6d4', // cyan
  SPENDING_ALERT:        '#ef4444', // red
}

function getAccent(type?: string, status?: string): string {
  if (status === 'failed')       return '#ef4444'
  if (status === 'sent_to_smtp') return '#10b981'
  return TYPE_ACCENT[type ?? ''] ?? '#6366f1'
}

function inferPeriod(time: string): 'AM' | 'PM' {
  const [h] = time.split(':').map(Number)
  return isNaN(h) ? 'AM' : h < 12 ? 'AM' : 'PM'
}

export function TimeNotificationIcon({
  time,
  period,
  notificationType,
  status,
  size = 72,
  className,
}: TimeNotificationIconProps) {
  const resolvedPeriod = period ?? inferPeriod(time)
  const accent         = getAccent(notificationType, status)

  /*
   * SVG geometry
   * ────────────
   * viewBox: 0 0 100 100 (unit square, scaled to `size`px)
   * Centre:  (50, 50)
   * Outer arc radius:  38
   * Arc sweep:         300° (leaving a 60° gap at the bottom)
   * Start angle:       150° (bottom-left, clockwise from 3-o'clock East)
   * End angle:         30°  (bottom-right)
   *
   * SVG angles: 0° = East (3 o'clock), positive = clockwise
   * So to open the gap at the bottom (6 o'clock = 90°):
   *   start = 90 + 150 = 240° ... simpler: arc from 120° to 60° going CW ≡ 300°
   *   Actually: start from (120°) going clockwise 300° ends at (60°)
   *   → start  = 120° from East  → x = 50 + 38*cos(120°), y = 50 + 38*sin(120°)
   *   → end    =  60° from East  → x = 50 + 38*cos(60°),  y = 50 + 38*sin(60°)
   *
   * Dots: 4 dots placed along a slightly smaller radius (44) in the gap (120°→60° going the short way = 300° CW side)
   */

  const cx = 50
  const cy = 50
  const R  = 38  // arc radius

  // Arc: starts at 120° (lower-left), goes CW 300°, ends at 60° (lower-right)
  // In SVG: East=0°, CW positive
  const startDeg = 120
  const endDeg   =  60
  const sweepDeg = 300

  function polar(deg: number, r: number) {
    const rad = (deg * Math.PI) / 180
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    }
  }

  const arcStart = polar(startDeg, R)
  const arcEnd   = polar(endDeg,   R)

  // large-arc-flag = 1 because sweep > 180°
  const arcPath = [
    `M ${arcStart.x.toFixed(3)} ${arcStart.y.toFixed(3)}`,
    `A ${R} ${R} 0 1 1 ${arcEnd.x.toFixed(3)} ${arcEnd.y.toFixed(3)}`,
  ].join(' ')

  // Tick marks on the arc — thin spokes every 60° between 150° and 390° (=30°)
  // at 150°, 210°, 270°, 330° → 4 inner ticks
  const tickAngles = [150, 210, 270, 330]
  const tickOuter  = R
  const tickInner  = R - 6

  // Bottom dots: 4 dots placed in the gap, evenly spread from 120°→60° (short arc, 300° CW gap)
  // Going the short way (CCW, −60°) from 120° to 60° = 60° span
  // Dot positions at 112°, 97°, 83°, 68° — evenly spaced in the 44° gap between 68° and 112°
  const dotAngles  = [112, 97, 83, 68]
  const dotRadius  = R + 5  // slightly outside arc
  const dotSize    = 2.2

  // Background glow ring (very faint, for depth)
  const bgR = R + 4

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Background glow */}
      <circle
        cx={cx} cy={cy} r={bgR}
        fill="none"
        stroke={accent}
        strokeWidth="1"
        opacity="0.12"
      />

      {/* Main arc — open at the bottom */}
      <path
        d={arcPath}
        fill="none"
        stroke={accent}
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* Inner decorative arc (thinner, slightly smaller radius) */}
      {(() => {
        const rInner = R - 7
        const is = polar(startDeg, rInner)
        const ie = polar(endDeg,   rInner)
        const ip = `M ${is.x.toFixed(3)} ${is.y.toFixed(3)} A ${rInner} ${rInner} 0 1 1 ${ie.x.toFixed(3)} ${ie.y.toFixed(3)}`
        return (
          <path
            d={ip}
            fill="none"
            stroke={accent}
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.25"
          />
        )
      })()}

      {/* Tick marks along the arc */}
      {tickAngles.map((deg) => {
        const outer = polar(deg, tickOuter)
        const inner = polar(deg, tickInner)
        return (
          <line
            key={deg}
            x1={outer.x.toFixed(3)} y1={outer.y.toFixed(3)}
            x2={inner.x.toFixed(3)} y2={inner.y.toFixed(3)}
            stroke={accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.55"
          />
        )
      })}

      {/* Bottom gap dots */}
      {dotAngles.map((deg) => {
        const p = polar(deg, dotRadius)
        return (
          <circle
            key={deg}
            cx={p.x.toFixed(3)}
            cy={p.y.toFixed(3)}
            r={dotSize}
            fill={accent}
            opacity="0.75"
          />
        )
      })}

      {/* Time display — centred */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="15"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
        fill={accent}
        letterSpacing="-0.5"
      >
        {time}
      </text>

      {/* AM / PM period */}
      <text
        x={cx}
        y={cy + 11}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="8"
        fontWeight="600"
        fontFamily="system-ui, sans-serif"
        fill={accent}
        opacity="0.8"
        letterSpacing="1.5"
      >
        {resolvedPeriod}
      </text>
    </svg>
  )
}
