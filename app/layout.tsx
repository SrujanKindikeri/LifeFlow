import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ToastProvider } from '@/components/ui/Toast'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

export const metadata: Metadata = {
  title: 'LifeFlow — Personal Daily Dashboard',
  description:
    'Manage your notes, tasks, habits, and expenses in one beautiful personal dashboard.',
  icons: { icon: '/favicon.ico' },
}

/*
  generateViewport is the correct Next.js 15+ / 16+ API for viewport configuration.
  The old metadata.viewport field is deprecated and produces a build warning.
  viewportFit:'cover' is critical — without it env(safe-area-inset-*) returns 0 on iOS.
*/
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,      // allow pinch-to-zoom for accessibility
  userScalable: true,   // required for WCAG 1.4.4 — never lock zoom
  viewportFit: 'cover', // iOS safe-area support
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is intentional and scoped to <html> only.
    // The inline script below runs synchronously before React hydration and
    // writes data-theme / data-night-shift onto <html>. The server renders
    // neither attribute (it has no access to the user's localStorage), so
    // React would otherwise report a mismatch. suppressHydrationWarning tells
    // React to accept the client-modified attributes on this single element
    // without erroring — the documented pattern for pre-hydration theme scripts.
    // It does NOT suppress warnings anywhere else in the component tree.
    <html lang="en" suppressHydrationWarning>
      {/*
        Inline script — runs synchronously before any React hydration.
        Reads the stored appearance preferences from localStorage and applies
        data-theme / data-night-shift to <html> immediately, preventing any
        flash of the wrong theme on page load or browser restart.
        This script is intentionally tiny and has no external dependencies.
      */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var LS_KEY = 'lf_appearance';
  var defaults = { theme: 'light', nightShiftEnabled: false, nightShiftStart: '22:00', nightShiftEnd: '07:00' };
  try {
    var raw = localStorage.getItem(LS_KEY);
    var prefs = raw ? JSON.parse(raw) : defaults;
    var theme = prefs.theme || 'light';
    var resolved;
    if (theme === 'dark') {
      resolved = 'dark';
    } else if (theme === 'light') {
      resolved = 'light';
    } else {
      // system
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);

    // Night Shift check (timezone not available yet — use local time as approximation)
    var ns = prefs.nightShiftEnabled;
    if (ns) {
      var start = prefs.nightShiftStart || '22:00';
      var end   = prefs.nightShiftEnd   || '07:00';
      var now   = new Date();
      var hh    = String(now.getHours()).padStart(2, '0');
      var mm    = String(now.getMinutes()).padStart(2, '0');
      var cur   = hh + ':' + mm;
      var active;
      if (start < end) {
        active = cur >= start && cur < end;
      } else {
        active = cur >= start || cur < end;
      }
      document.documentElement.setAttribute('data-night-shift', active ? 'true' : 'false');
    } else {
      document.documentElement.setAttribute('data-night-shift', 'false');
    }
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-night-shift', 'false');
  }
})();
            `.trim(),
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
