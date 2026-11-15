/**
 * InlineScript — renders a <script dangerouslySetInnerHTML> inline.
 *
 * WHY THIS EXISTS
 * ───────────────
 * React 19 throws "Encountered a script tag while rendering React component"
 * when a <script> element appears in the client-side virtual DOM. The fix
 * documented in the Next.js 16 App Router "Preventing Flash Before Hydration"
 * guide is to set:
 *
 *   type="text/javascript"  on the server (script runs during HTML parsing)
 *   type="text/plain"       on the client (React ignores it; never executes)
 *
 * This component is a thin wrapper that performs that switch transparently.
 * The Server Component layout imports this and passes the inline script string
 * as the `html` prop. Because this file has no 'use client' directive, it is
 * treated as a shared (isomorphic) component — it renders on the server as
 * type="text/javascript" and React reconciles it on the client as
 * type="text/plain", suppressing the hydration mismatch on that one attribute.
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
