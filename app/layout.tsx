import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from '@/components/ui/Toast'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

export const metadata: Metadata = {
  title: 'LifeFlow — Personal Daily Dashboard',
  description:
    'Manage your notes, tasks, habits, and expenses in one beautiful personal dashboard.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
