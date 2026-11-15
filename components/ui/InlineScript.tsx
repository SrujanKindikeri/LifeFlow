'use client'

/**
 * InlineScript — renders a <script dangerouslySetInnerHTML> inline.
 *
 * WHY THIS EXISTS
 * ───────────────
 * React 19 throws "Encountered a script tag while rendering React component"
 * when a <script> element with type="text/javascript" appears in the
 * client-side virtual DOM. The fix documented in the Next.js 16 App Router
 * "Preventing Flash Before Hydration" guide is:
 *
 *   type="text/javascript"  on the server (script runs during HTML parsing)
 *   type="text/plain"       on the client (React ignores it; never executes)
 *
 * WHY 'use client' IS REQUIRED HERE
 * ──────────────────────────────────
 * The Next.js docs show InlineScript without 'use client' — but only because
 * in that example it is used inside a Client Component (LocalDate), which
 * re-evaluates the ternary at client render time.
 *
 * In this app, InlineScript is used directly from app/layout.tsx, which is a
 * Server Component. Without 'use client', the RSC renderer evaluates
 * `typeof window === 'undefined'` server-side → always true → serializes
 * type="text/javascript" into the RSC payload. When React reconciles that
 * payload on the client and creates the DOM node, it sees type="text/javascript"
 * → isScriptDataBlock() returns false → warning fires.
 *
 * Adding 'use client' makes the component run on the client where
 * `typeof window !== 'undefined'` → type="text/plain" → isScriptDataBlock()
 * returns true → no warning. On hard navigation the server still renders
 * type="text/javascript" in the HTML (the SSR pass evaluates the ternary
 * server-side, same as before). On soft navigation React renders
 * type="text/plain" and skips execution — ThemeProvider handles theme
 * re-application via useLayoutEffect on those navigations.
 *
 * suppressHydrationWarning is required because the type attribute differs
 * between the server-rendered HTML and the client React element.
 *
 * REFERENCES
 * ──────────
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 * — "InlineScript" pattern, "Extracting a reusable component" section.
 */

export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
