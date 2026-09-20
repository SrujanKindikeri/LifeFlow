/**
 * lib/notificationIcon.ts — Time-based notification icon SVG generator.
 *
 * SERVER-ONLY — generates email-safe inline SVG that can be embedded directly
 * in HTML email templates.  No external images, no JavaScript, no remote assets.
 *
 * VISUAL DESIGN
 * ─────────────
 * Matches the reference image:
 *   • Large circular outer arc (open at the bottom — like a bell arc)
 *   • Bottom dots: three dots (•  ●  •) below the arc opening
 *   • Center area: the notification's actual scheduled time (HH:MM / AM or PM)
 *
 * The Wi-Fi symbol that was previously in the center is REMOVED.
 * Only the scheduled time appears in the center.
 *
 * USAGE
 * ─────
 *   import { buildNotificationIconSvg, formatIconTime } from '@/lib/notificationIcon'
 *
 *   // Convert a UTC timestamp to local 12-hour time string
 *   const { hhmm, ampm } = formatIconTime(scheduledUtc, 'Asia/Kolkata')
 *   // → { hhmm: '07:00', ampm: 'AM' }
 *
 *   // Build the SVG string (embed directly in HTML email)
 *   const svg = buildNotificationIconSvg('07:00', 'AM', { size: 88 })
 *
 * EMAIL COMPATIBILITY
 * ───────────────────
 * • Table-based wrapper for centering (Gmail strips display:flex from divs)
 * • SVG with inline attributes only — no <style> blocks
 * • No <foreignObject> — unsupported in Outlook
 * • No web fonts — system-safe monospace/sans-serif stack for the time digits
 * • No animations, no filters, no gradients
 *
 * ACCESSIBILITY
 * ─────────────
 * • role="img" + aria-label on the <svg>
 * • Decorative elements have aria-hidden="true"
 */

const BRAND_COLOR = '#2563eb'   // LifeFlow blue — must match email-templates.ts

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IconTimeComponents {
  /** Zero-padded HH:MM in 12-hour format, e.g. "07:00" or "11:55" */
  hhmm: string
  /** "AM" or "PM" */
  ampm: 'AM' | 'PM'
}

export interface NotificationIconOptions {
  /**
   * Overall SVG size in pixels (it's square).
   * Default: 88 — good for email headers.
   * Use 64 for compact in-app usage.
   */
  size?: number
  /**
   * Accent colour (defaults to LifeFlow blue #2563eb).
   */
  color?: string
}

// ─── Time formatter ────────────────────────────────────────────────────────────

/**
 * Convert a UTC Date to the user's local time in HH:MM / AM/PM components.
 *
 * Uses Intl.DateTimeFormat — correctly handles DST, non-whole-hour offsets
 * (e.g. Asia/Kolkata +5:30, Asia/Kathmandu +5:45), and all IANA timezones.
 *
 * @param utcDate  The UTC instant (scheduled notification time)
 * @param timezone IANA timezone string, e.g. "Asia/Kolkata"
 * @returns { hhmm: "07:00", ampm: "AM" }
 */
export function formatIconTime(utcDate: Date, timezone: string): IconTimeComponents {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   true,
    }).formatToParts(utcDate)

    const hourPart   = parts.find((p) => p.type === 'hour')?.value   ?? '12'
    const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '00'
    const periodPart = parts.find((p) => p.type === 'dayPeriod')?.value?.toUpperCase()
    const ampm       = (periodPart === 'AM' || periodPart === 'PM') ? periodPart : 'AM'

    // Zero-pad hour to ensure consistent width (e.g. "07" not "7")
    const hhmm = `${hourPart.padStart(2, '0')}:${minutePart}`

    return { hhmm, ampm: ampm as 'AM' | 'PM' }
  } catch {
    // Fallback for invalid timezone
    const h   = utcDate.getUTCHours()
    const m   = utcDate.getUTCMinutes()
    const h12 = h % 12 || 12
    return {
      hhmm: `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      ampm: h < 12 ? 'AM' : 'PM',
    }
  }
}

/**
 * Parse a static "HH:MM AM/PM" label string into icon components.
 * Use this when you have a pre-formatted label rather than a UTC Date.
 *
 * Examples:
 *   parseIconTimeLabel('7:00 AM')  → { hhmm: '07:00', ampm: 'AM' }
 *   parseIconTimeLabel('11:55 PM') → { hhmm: '11:55', ampm: 'PM' }
 *   parseIconTimeLabel('07:00')    → { hhmm: '07:00', ampm: 'AM' }  (no period → AM)
 */
export function parseIconTimeLabel(label: string): IconTimeComponents {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return { hhmm: '12:00', ampm: 'AM' }

  const h    = parseInt(match[1], 10)
  const m    = match[2]
  const period = match[3]?.toUpperCase()
  const ampm   = (period === 'AM' || period === 'PM') ? period as 'AM' | 'PM'
    : (h >= 12 ? 'PM' : 'AM')

  return {
    hhmm: `${String(h).padStart(2, '0')}:${m}`,
    ampm,
  }
}

// ─── SVG builder ──────────────────────────────────────────────────────────────

/**
 * Build the notification clock-arc SVG.
 *
 * Structure (matching the reference image):
 *
 *   ┌─────────────────────────────────────────┐
 *   │         ╭──────────────────╮            │
 *   │       ╱                      ╲          │
 *   │      │       07:00             │        │
 *   │      │         AM              │        │
 *   │       ╲                      ╱          │
 *   │         ╰──────────────────╯            │
 *   │             •     ●     •              │
 *   └─────────────────────────────────────────┘
 *
 * The arc is open at the bottom-center (like a bell or notification shape).
 * Three dots sit below the gap: two small outer dots + one medium center dot.
 * The time occupies the center of the circle.
 *
 * @param hhmm   Zero-padded time, e.g. "07:00"
 * @param ampm   "AM" or "PM"
 * @param opts   Optional size/color overrides
 */
export function buildNotificationIconSvg(
  hhmm: string,
  ampm: 'AM' | 'PM',
  opts: NotificationIconOptions = {}
): string {
  const size  = opts.size  ?? 88
  const color = opts.color ?? BRAND_COLOR

  // All coordinates are relative to a 88×88 viewBox.
  // Scale factor applied if a different size is requested.
  const vb = 88 // canonical viewBox size

  // Center of the circle
  const cx = 44
  const cy = 40

  // Outer glow circle radius
  const glowR = 43

  // Arc circle radius (the notification bell ring)
  const arcR  = 33

  // The arc runs from ~200° to ~340° going clockwise (open bottom gap ~120°)
  // In SVG, angles are measured from the positive X-axis (3 o'clock = 0°).
  //   Opening at bottom → gap between ~110° and ~250° (from top-right, clockwise)
  //   So the arc starts at 250° and ends at 110° going clockwise (the long way)
  //
  // Convert to radians for Math.cos/sin:
  //   Start: 250° → drawn from bottom-left  end
  //   End:   110° → drawn to   bottom-right end
  //   sweep: 220° (the major arc, open at bottom)

  const toRad = (deg: number) => (deg * Math.PI) / 180

  const startDeg = 110  // right side of the opening
  const endDeg   = 430  // startDeg + 320° sweep (leaving ~40° gap at bottom)

  const startRad = toRad(startDeg)
  const endRad   = toRad(endDeg)

  const arcX1 = +(cx + arcR * Math.cos(startRad)).toFixed(2)
  const arcY1 = +(cy + arcR * Math.sin(startRad)).toFixed(2)
  const arcX2 = +(cx + arcR * Math.cos(endRad)).toFixed(2)
  const arcY2 = +(cy + arcR * Math.sin(endRad)).toFixed(2)

  // Arc path: large-arc-flag=1 (major arc), sweep-flag=1 (clockwise)
  const arcPath = `M ${arcX1},${arcY1} A ${arcR},${arcR} 0 1 1 ${arcX2},${arcY2}`

  // Bottom dots — positioned in the gap below the arc
  // Gap midpoint is at 270° (straight down from center)
  const dotBaseY = cy + arcR + 7   // just below the arc's lowest visible point
  const dotCenterX  = cx
  const dotLeftX    = cx - 12
  const dotRightX   = cx + 12

  // Inner background circle fill (for the white center area)
  const innerR = arcR - 4

  // Font size for HH:MM — scaled to fit nicely inside the arc
  // At size=88/vb=88: time digits ~17px, ampm ~9px
  const timeFontSize = +(vb * 0.20).toFixed(1)   // ~17.6 at 88
  const ampmFontSize = +(vb * 0.105).toFixed(1)  // ~9.2  at 88

  // Vertical positions for time and AM/PM text inside the circle
  const timeY = cy + 4   // slightly below center for optical balance
  const ampmY = cy + 16

  const ariaLabel = `${hhmm} ${ampm} notification`

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none"
     xmlns="http://www.w3.org/2000/svg"
     role="img" aria-label="${ariaLabel}"
     style="display:block;margin:0 auto;">

  <!-- Outer glow circle (full circle, very light blue) -->
  <circle cx="${cx}" cy="${cy}" r="${glowR}" fill="#eff6ff" aria-hidden="true"/>

  <!-- Inner fill circle (white center) -->
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#ffffff" aria-hidden="true"/>

  <!-- Notification arc: large circular arc, open at the bottom -->
  <!-- This matches the reference image: circular outer arc with bottom opening -->
  <path d="${arcPath}"
        fill="none"
        stroke="${color}"
        stroke-width="3.2"
        stroke-linecap="round"
        aria-hidden="true"/>

  <!-- Time display — replaces the former Wi-Fi symbol -->
  <!-- HH:MM on the first line -->
  <text x="${cx}" y="${timeY}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Arial, sans-serif"
        font-size="${timeFontSize}"
        font-weight="700"
        fill="${color}"
        letter-spacing="-0.5"
        aria-hidden="true">${hhmm}</text>

  <!-- AM/PM label below HH:MM -->
  <text x="${cx}" y="${ampmY}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Arial, sans-serif"
        font-size="${ampmFontSize}"
        font-weight="600"
        fill="${color}"
        letter-spacing="1"
        aria-hidden="true">${ampm}</text>

  <!-- Bottom dots: left small · center medium · right small -->
  <!-- These match the reference image's lower dot pattern -->
  <circle cx="${dotLeftX}" cy="${dotBaseY}" r="2.2"
          fill="${color}" opacity="0.45" aria-hidden="true"/>
  <circle cx="${dotCenterX}" cy="${dotBaseY}" r="3.2"
          fill="${color}" aria-hidden="true"/>
  <circle cx="${dotRightX}" cy="${dotBaseY}" r="2.2"
          fill="${color}" opacity="0.45" aria-hidden="true"/>

</svg>`
}

// ─── Email-wrapper helper ──────────────────────────────────────────────────────

/**
 * Wrap the notification icon SVG in a table cell for email-safe centering.
 *
 * Gmail and Outlook both handle table-based centering correctly.
 * Do NOT use flexbox or CSS grid here — they are stripped by webmail clients.
 *
 * @param hhmm      Zero-padded HH:MM, e.g. "07:00"
 * @param ampm      "AM" | "PM"
 * @param marginBottom CSS margin-bottom on the wrapper table (default "28px")
 * @param opts      Icon size/color options
 */
export function buildNotificationIconHtml(
  hhmm: string,
  ampm: 'AM' | 'PM',
  marginBottom = '28px',
  opts: NotificationIconOptions = {}
): string {
  const svg = buildNotificationIconSvg(hhmm, ampm, opts)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
       width="100%" style="margin:0 0 ${marginBottom};">
  <tr>
    <td align="center">
      ${svg}
    </td>
  </tr>
</table>`
}
