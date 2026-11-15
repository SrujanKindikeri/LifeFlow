/**
 * app/app/loading.tsx — Authenticated shell loading UI.
 *
 * Renders while any route under /app/* is being compiled or fetched.
 * No external imports — this runs before ThemeProvider and providers are ready.
 */
export default function AppLoading() {
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
        <div
          style={{
            width: '2.5rem',
            height: '2.5rem',
            border: '3px solid rgba(99,102,241,0.15)',
            borderTopColor: 'rgba(99,102,241,0.8)',
            borderRadius: '50%',
            margin: '0 auto 1.25rem',
            animation: 'app-spin 0.7s linear infinite',
          }}
        />
        <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>Loading&hellip;</p>
        <style>{`@keyframes app-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
