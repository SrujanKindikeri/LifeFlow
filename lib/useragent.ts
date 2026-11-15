/**
 * lib/useragent.ts — Safe, lightweight user-agent parsing.
 *
 * Design constraints
 * ──────────────────
 *   • No external dependencies (no ua-parser-js, no device-fingerprinting).
 *   • Parses only what the dashboard needs: browser name+version, OS name+version,
 *     device category (desktop / mobile / tablet).
 *   • Handles missing, malformed, or deliberately spoofed UA strings
 *     without throwing — returns "Unknown" for anything it can't parse.
 *   • Never stores the full raw UA string in telemetry models longer than
 *     needed for parsing; the parsed fields are the only data persisted.
 *
 * Privacy
 * ────────
 * The User-Agent header is progressively being deprecated (Chrome's UA
 * Client Hints). We parse the traditional header because it is still
 * sent by virtually all browsers, but we store only coarse fields —
 * never the full string in analytics or audit records.
 */

export interface ParsedUserAgent {
  browser: string
  browserVersion: string
  os: string
  osVersion: string
  deviceCategory: 'desktop' | 'mobile' | 'tablet' | 'unknown'
}

const UNKNOWN: ParsedUserAgent = {
  browser:        'Unknown',
  browserVersion: '',
  os:             'Unknown',
  osVersion:      '',
  deviceCategory: 'unknown',
}

// ── Browser detection (order matters — check specific before generic) ───────

interface BrowserMatch {
  name: string
  regex: RegExp
  versionRegex?: RegExp
}

const BROWSER_PATTERNS: BrowserMatch[] = [
  // Edge (Chromium-based) — check before Chrome
  { name: 'Edge',     regex: /Edg(?:e|A|iOS)?\/(\d[\d.]*)/i, versionRegex: /Edg(?:e|A|iOS)?\/(\d[\d.]*)/i },
  // Opera — check before Chrome
  { name: 'Opera',    regex: /OPR\/(\d[\d.]*)/i, versionRegex: /OPR\/(\d[\d.]*)/i },
  // Samsung Internet
  { name: 'Samsung',  regex: /SamsungBrowser\/(\d[\d.]*)/i, versionRegex: /SamsungBrowser\/(\d[\d.]*)/i },
  // Firefox — check before Chrome (Firefox has "Gecko" but also "Chrome" in some UAs)
  { name: 'Firefox',  regex: /Firefox\/(\d[\d.]*)/i, versionRegex: /Firefox\/(\d[\d.]*)/i },
  // Chrome
  { name: 'Chrome',   regex: /Chrome\/(\d[\d.]*)/i, versionRegex: /Chrome\/(\d[\d.]*)/i },
  // Safari — check last (many browsers include "Safari" in their UA)
  { name: 'Safari',   regex: /Version\/(\d[\d.]*)/i, versionRegex: /Version\/(\d[\d.]*)/i },
  // Legacy fallbacks
  { name: 'MSIE',     regex: /MSIE (\d[\d.]*)/i, versionRegex: /MSIE (\d[\d.]*)/i },
  { name: 'IE',       regex: /Trident\/(\d[\d.]*)/i, versionRegex: /Trident\/(\d[\d.]*)/i },
]

// ── OS detection ─────────────────────────────────────────────────────────────

interface OsMatch {
  name: string
  regex: RegExp
  versionRegex?: RegExp
}

const OS_PATTERNS: OsMatch[] = [
  { name: 'Windows', regex: /Windows NT (\d[\d.]*)/i, versionRegex: /Windows NT (\d[\d.]*)/i },
  { name: 'iOS',     regex: /iPhone|iPad|iPod/i },
  { name: 'Android', regex: /Android (\d[\d.]*)/i,   versionRegex: /Android (\d[\d.]*)/i },
  { name: 'macOS',   regex: /Macintosh|Mac OS X/i,    versionRegex: /Mac OS X (\d[_\d.]*)/i },
  { name: 'Linux',   regex: /Linux/i },
  { name: 'ChromeOS', regex: /CrOS/i },
]

// ── OS version mapping ───────────────────────────────────────────────────────

function mapWindowsVersion(nt: string): string {
  const map: Record<string, string> = {
    '10.0': '10/11',
    '6.3':  '8.1',
    '6.2':  '8',
    '6.1':  '7',
    '6.0':  'Vista',
    '5.1':  'XP',
  }
  return map[nt] ?? nt
}

// ── Device category detection ────────────────────────────────────────────────

function detectDeviceCategory(ua: string): ParsedUserAgent['deviceCategory'] {
  if (/iPad|Tablet/i.test(ua)) return 'tablet'
  if (/Mobile|Android.*Mobile|iPhone|iPod/i.test(ua)) return 'mobile'
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet' // large Android = tablet
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop'
  return 'unknown'
}

// ── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a User-Agent string into structured device information.
 *
 * Returns the UNKNOWN object for null, empty, or unparseable strings.
 * Never throws — always returns a valid ParsedUserAgent.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua || typeof ua !== 'string' || ua.trim().length === 0) {
    return { ...UNKNOWN }
  }

  // Truncate extremely long strings to prevent ReDoS on pathological input.
  const uaStr = ua.slice(0, 1000)

  // ── Browser ──────────────────────────────────────────────────────────────
  let browser = 'Unknown'
  let browserVersion = ''

  for (const pattern of BROWSER_PATTERNS) {
    if (pattern.regex.test(uaStr)) {
      browser = pattern.name
      if (pattern.versionRegex) {
        const m = uaStr.match(pattern.versionRegex)
        if (m?.[1]) browserVersion = m[1]
      }
      break
    }
  }

  // Special case: Safari's UA contains "Version/X" but also "Safari/X".
  // If we matched Safari via the Version regex but Chrome is also present,
  // it's actually Chrome (Safari UA has "Version" but not "Chrome").
  if (browser === 'Safari' && /Chrome/i.test(uaStr) && !/Edg/i.test(uaStr)) {
    // Re-check Chrome
    const chromeMatch = uaStr.match(/Chrome\/(\d[\d.]*)/i)
    if (chromeMatch) {
      browser = 'Chrome'
      browserVersion = chromeMatch[1] ?? ''
    }
  }

  // ── OS ────────────────────────────────────────────────────────────────────
  let os = 'Unknown'
  let osVersion = ''

  for (const pattern of OS_PATTERNS) {
    if (pattern.regex.test(uaStr)) {
      os = pattern.name
      if (pattern.versionRegex) {
        const m = uaStr.match(pattern.versionRegex)
        if (m?.[1]) {
          osVersion = m[1].replace(/_/g, '.')
          if (os === 'Windows') osVersion = mapWindowsVersion(osVersion)
        }
      }
      break
    }
  }

  // ── Device category ───────────────────────────────────────────────────────
  const deviceCategory = detectDeviceCategory(uaStr)

  return {
    browser,
    browserVersion,
    os,
    osVersion,
    deviceCategory,
  }
}

// ── Privacy-safe summary (for display) ───────────────────────────────────────

/**
 * Return a short human-readable summary of the parsed UA.
 * Example: "Chrome 120 on macOS 14 (desktop)"
 */
export function formatDeviceInfo(parsed: ParsedUserAgent): string {
  const browserPart = parsed.browserVersion
    ? `${parsed.browser} ${parsed.browserVersion}`
    : parsed.browser

  const osPart = parsed.osVersion
    ? `${parsed.os} ${parsed.osVersion}`
    : parsed.os

  if (parsed.browser === 'Unknown' && parsed.os === 'Unknown') {
    return 'Unknown device'
  }

  return `${browserPart} on ${osPart} (${parsed.deviceCategory})`
}
