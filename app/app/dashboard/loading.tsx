/**
 * app/app/dashboard/loading.tsx — Route-segment loading UI.
 *
 * Shows a minimal, dependency-free loading state while the dashboard route
 * segment is being compiled by Turbopack (dev cold start) or while the server
 * is fetching dashboard data.
 *
 * CRITICAL: No external imports (no lucide-react, no framer-motion, no
 * GlassCard). This file renders before any providers are ready. All styling
 * is inline to guarantee it can never throw.
 *
 * This also serves as a Suspense boundary for the RSC payload: during dev
 * cold starts, Turbopack compiles Client Component bundles on-demand. Without
 * this loading.tsx, React would try to hydrate the dashboard immediately and
 * fail with "Lazy element type must resolve to a class or function" if any
 * Client Component module hasn't finished loading yet.
 */
export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        {/* Spinner */}
        <div
          style={{
            width: '2.5rem',
            height: '2.5rem',
            border: '3px solid rgba(99,102,241,0.15)',
            borderTopColor: 'rgba(99,102,241,0.8)',
            borderRadius: '50%',
            margin: '0 auto 1.25rem',
            animation: 'dash-spin 0.7s linear infinite',
          }}
        />
        <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
          Loading your dashboard&hellip;
        </p>
        {/* Inline keyframes — no external CSS dependency */}
        <style>{`@keyframes dash-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
