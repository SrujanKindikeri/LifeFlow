'use client'

/**
 * CardErrorBoundary — isolates a single dashboard card so that a render-time
 * crash in one card never takes down the whole dashboard segment.
 *
 * WHY THIS EXISTS
 * ──────────────
 * The dashboard (app/app/dashboard/DashboardClient.tsx) renders many sections.
 * Several of them fetch their own data on the client (DailyBriefing,
 * LifeFlowScore, DailyIntelligenceCard, FinancialIntelligenceCard,
 * DraftsContinueSection, GlobalSearch). If any of those receives an unexpected
 * response shape and throws during render, React has no per-card boundary —
 * the error bubbles all the way up to app/error.tsx and replaces the ENTIRE
 * dashboard with the segment error fallback. One broken card therefore
 * "crashes the entire dashboard", which is exactly the failure mode the
 * product must avoid.
 *
 * Wrapping each independent card in <CardErrorBoundary> keeps the blast radius
 * to a single card: the failed card shows a small inline fallback with a
 * "Try again" button, while every other card keeps working.
 *
 * ROBUSTNESS CONTRACT
 * ───────────────────
 * The fallback renders with ZERO external imports (no lucide-react, no
 * framer-motion, no Tailwind classes that depend on CSS variables). This
 * guarantees the boundary itself can never recursively throw — the exact
 * property the App Router requires so a fallback never escalates to
 * global-error.tsx. Inline SVG + inline styles only.
 *
 * The boundary is a plain React class component (not next/error's catchError)
 * so it is fully type-safe and independent of the new Next 16 catchError
 * signature, which has an unusual two-argument fallback contract.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  /** Human-readable card label, shown in the fallback. */
  name?: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    // Log without re-throwing — a throw inside componentDidCatch would recurse
    // and escalate to the parent boundary.
    try {
      // eslint-disable-next-line no-console
      console.error('[CardErrorBoundary]', this.props.name ?? 'card', error, info?.componentStack ?? '')
    } catch {
      /* never throw from the catch */
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const label = this.props.name ?? 'This section'

    return (
      <div
        role="alert"
        style={{
          borderRadius: '1rem',
          padding: '1.25rem',
          background: 'rgba(239,68,68,0.05)',
          border: '1px solid rgba(239,68,68,0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          minHeight: '120px',
          gap: '0.5rem',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#374151',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(239,68,68,0.7)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p style={{ fontSize: '0.8125rem', fontWeight: 600, margin: 0 }}>
          {label} could not load.
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.4rem 0.875rem',
            borderRadius: '0.625rem',
            background: 'rgba(99,102,241,0.9)',
            color: '#ffffff',
            border: 'none',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Try again
        </button>
      </div>
    )
  }
}

export default CardErrorBoundary
