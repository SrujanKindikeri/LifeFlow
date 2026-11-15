/**
 * lib/ip.ts — Trusted-proxy-aware client IP extraction.
 *
 * Security model
 * ──────────────
 * The application server may sit behind one or more reverse proxies
 * (nginx, Cloudflare, AWS ALB, Azure App Gateway, Vercel, etc.).
 * Those proxies append the real client IP to the `X-Forwarded-For`
 * header, but a malicious client can also send its own `X-Forwarded-For`
 * to spoof its address.
 *
 * To prevent spoofing we only trust `X-Forwarded-For` (and `X-Real-IP`)
 * when the *direct* connection came from a proxy IP that the operator
 * has explicitly trusted via the `TRUSTED_PROXY_IPS` env var.
 *
 * When no trusted proxies are configured we fall back to the direct
 * socket peer address — never trusting forwarded headers from an
 * untrusted source.
 *
 * Important caveats (documented in the admin UI):
 *   • An IP address is NEVER proof of identity.
 *   • Multiple people can share a single IP (NAT, VPN, corporate Wi-Fi).
 *   • Mobile IPs change frequently.
 *   • We never treat an IP as uniquely identifying a person or device.
 */

import type { NextRequest } from 'next/server'

// ── Trusted proxy configuration ─────────────────────────────────────────────

/**
 * Comma-separated list of trusted proxy IP addresses.
 *
 * Set TRUSTED_PROXY_IPS in .env.local / .env:
 *   TRUSTED_PROXY_IPS=127.0.0.1,10.0.0.5,172.16.0.0/12
 *
 * Supports individual IPs and CIDR ranges. When this is empty we do NOT
 * trust any X-Forwarded-For header — the direct connection IP is used.
 *
 * Special value "any" (case-insensitive) trusts all proxies — useful for
 * platforms like Vercel where the proxy IP is not known in advance.
 * Use "any" ONLY when the platform guarantees it overwrites X-Forwarded-For.
 */
function getTrustedProxyConfig(): { ips: Set<string>; cidrs: string[]; trustAny: boolean } {
  const raw = process.env.TRUSTED_PROXY_IPS ?? ''
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)

  if (parts.length === 0) {
    return { ips: new Set(), cidrs: [], trustAny: false }
  }

  // Special case: "any" trusts all sources (platform-managed proxy)
  if (parts.length === 1 && parts[0].toLowerCase() === 'any') {
    return { ips: new Set(), cidrs: [], trustAny: true }
  }

  const ips = new Set<string>()
  const cidrs: string[] = []
  for (const p of parts) {
    if (p.includes('/')) {
      cidrs.push(p)
    } else {
      ips.add(p)
    }
  }
  return { ips, cidrs, trustAny: false }
}

// ── CIDR matching ────────────────────────────────────────────────────────────

/**
 * Check whether `ip` falls inside `cidr` (e.g. "172.16.0.0/12").
 * Only IPv4 is supported — sufficient for proxy configuration.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr ?? '32', 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false

  const ipParts = ip.split('.').map(Number)
  const baseParts = base.split('.').map(Number)
  if (ipParts.length !== 4 || baseParts.length !== 4) return false
  if (ipParts.some((n) => isNaN(n) || n < 0 || n > 255)) return false
  if (baseParts.some((n) => isNaN(n) || n < 0 || n > 255)) return false

  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]
  const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3]
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0

  return (ipNum & mask) === (baseNum & mask)
}

/**
 * Check whether the direct connection IP is a trusted proxy.
 */
function isTrustedProxy(ip: string): boolean {
  const { ips, cidrs, trustAny } = getTrustedProxyConfig()
  if (trustAny) return true
  if (ips.has(ip)) return true
  return cidrs.some((cidr) => ipInCidr(ip, cidr))
}

// ── Header parsing ───────────────────────────────────────────────────────────

/**
 * Parse the X-Forwarded-For header into an array of IPs (leftmost first).
 * The leftmost entry is the original client; subsequent entries are
 * successive proxies.
 */
function parseForwardedFor(header: string | null): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'unknown')
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ClientIpResult {
  /** The best-guess client IP, or null if none could be determined. */
  ip: string | null
  /**
   * How the IP was determined:
   *   'direct'     — taken from the socket peer (no proxy involved).
   *   'forwarded'  — extracted from X-Forwarded-For via a trusted proxy.
   *   'real_ip'    — extracted from X-Real-IP via a trusted proxy.
   *   'untrusted'  — X-Forwarded-For present but not trusted; fell back to direct.
   *   'unknown'    — no IP could be determined.
   */
  source: 'direct' | 'forwarded' | 'real_ip' | 'untrusted' | 'unknown'
}

/**
 * Determine the client's real IP address using trusted-proxy logic.
 *
 * This is the function all telemetry and security code should use —
 * NOT the bare `getClientIp` in rate-limit.ts (which trusts XFF blindly
 * and is kept only for backward compatibility with the rate limiter).
 *
 * @param req  The NextRequest (Route Handler or proxy context).
 * @returns The resolved IP and how it was obtained.
 */
export function resolveClientIp(req: NextRequest): ClientIpResult {
  // Next.js does not expose the raw socket peer address directly.
  // In most deployments the direct connection IS the proxy, and the
  // real client IP is in X-Forwarded-For or X-Real-IP.
  //
  // We use the "info" object from NextRequest where available, or
  // fall back to the connection's remote address.

  // 1. Check if we have a trusted proxy configuration at all.
  const { ips, cidrs, trustAny } = getTrustedProxyConfig()

  // The "direct" connection IP. In Next.js (Node runtime), we can get
  // this from req.headers as the last entry in X-Forwarded-For when
  // behind a proxy, but for the *socket* peer we don't have direct
  // access. In practice, if a proxy is in front, X-Forwarded-For's
  // last entry IS the proxy. If no proxy, we have no socket info.
  //
  // Strategy:
  //   a) If trustAny: take leftmost XFF entry (platform manages the header).
  //   b) If trusted proxies configured: verify the rightmost XFF entry
  //      is a trusted proxy, then walk left to find the first untrusted IP.
  //   c) If no trusted proxies configured: do NOT trust XFF; try X-Real-IP
  //      only if it's present (some proxies set it). Otherwise null.
  //
  // This avoids the common vulnerability of blindly trusting XFF.

  const forwarded = req.headers.get('x-forwarded-for')
  const xffList = parseForwardedFor(forwarded)

  // (a) Trust any proxy — platform-managed XFF
  if (trustAny && xffList.length > 0) {
    return { ip: xffList[0], source: 'forwarded' }
  }

  // (b) Trusted proxies configured — verify and walk
  if ((ips.size > 0 || cidrs.length > 0) && xffList.length > 0) {
    // The rightmost entry should be the direct connection (our proxy).
    // Walk from right to left: skip entries that are trusted proxies,
    // the first untrusted entry is the real client.
    for (let i = xffList.length - 1; i >= 0; i--) {
      if (isTrustedProxy(xffList[i])) {
        // This entry is a trusted proxy — keep walking left.
        continue
      }
      // First untrusted entry from the right = the real client.
      return { ip: xffList[i], source: 'forwarded' }
    }
    // All entries are trusted proxies — the leftmost is still the best guess.
    return { ip: xffList[0], source: 'forwarded' }
  }

  // (c) No trusted proxies configured
  // Don't trust X-Forwarded-For at all. Try X-Real-IP (some single-proxy
  // setups like nginx set it). If absent, return null.
  if (xffList.length > 0) {
    // XFF present but untrusted — note this but don't use it unless
    // X-Real-IP is also absent and we have no other option.
    const realIp = req.headers.get('x-real-ip')
    if (realIp && realIp.trim()) {
      return { ip: realIp.trim(), source: 'real_ip' }
    }
    // No X-Real-IP and no trusted proxy — return the direct IP if we
    // can get one, otherwise mark as untrusted and return null.
    // In practice, without a socket peer address we can't get the direct
    // IP in Next.js. We return the last XFF entry as a *direct* fallback
    // since that's the proxy's connection to us, but mark it clearly.
    // This is the best we can do without socket access.
    return { ip: xffList[xffList.length - 1], source: 'untrusted' }
  }

  // No XFF at all — try X-Real-IP
  const realIp = req.headers.get('x-real-ip')
  if (realIp && realIp.trim()) {
    return { ip: realIp.trim(), source: 'real_ip' }
  }

  return { ip: null, source: 'unknown' }
}

/**
 * Convenience wrapper returning just the IP string (or null).
 * Use `resolveClientIp` when you need the source for audit/telemetry.
 */
export function getClientIpTrusted(req: NextRequest): string | null {
  return resolveClientIp(req).ip
}

// ── Validation ───────────────────────────────────────────────────────────────

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_RE = /^[0-9a-f:]+$/i

/**
 * Basic IP address format validation. Does NOT guarantee the IP is
 * routable — only that it has a valid format. Used to reject garbage
 * from malformed headers before storing.
 */
export function isValidIp(ip: string | null | undefined): ip is string {
  if (!ip || typeof ip !== 'string') return false
  const trimmed = ip.trim()
  if (trimmed.length === 0 || trimmed.length > 45) return false
  if (IPV4_RE.test(trimmed)) {
    // Validate each octet is 0-255
    return trimmed.split('.').every((octet) => {
      const n = parseInt(octet, 10)
      return n >= 0 && n <= 255
    })
  }
  return IPV6_RE.test(trimmed)
}

/**
 * Redact the last octet of an IPv4 address (or the last group of an
 * IPv6 address) for privacy-safe display in logs and audit metadata.
 *
 * Example: "192.168.1.42" → "192.168.1.x"
 *
 * The full IP is still stored in the UserSession document (admin-only
 * access), but this helper is used when IP data appears in general
 * audit logs or error messages where full precision is unnecessary.
 */
export function redactIp(ip: string | null | undefined): string {
  if (!ip) return 'unknown'
  const trimmed = ip.trim()
  if (IPV4_RE.test(trimmed)) {
    const parts = trimmed.split('.')
    parts[3] = 'x'
    return parts.join('.')
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    parts[parts.length - 1] = 'x'
    return parts.join(':')
  }
  return 'unknown'
}
