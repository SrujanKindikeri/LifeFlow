import { Sidebar }           from '@/components/layout/Sidebar'
import { BottomNav }          from '@/components/layout/BottomNav'
import { AppHeader }          from '@/components/layout/AppHeader'
import { CommandPalette }     from '@/components/ui/CommandPalette'
import { PushRegistrar }      from '@/components/notifications/PushRegistrar'
import { InactivityMonitor }  from '@/components/providers/InactivityMonitor'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        min-h-dvh:  uses the *dynamic* viewport height unit which correctly
                    excludes the mobile browser chrome (address bar, tab bar).
                    Falls back to min-h-screen on browsers that don't support dvh.

        The sidebar is position:fixed so it is removed from normal document flow.
        The main column therefore takes the full width of this container and must
        add a left offset equal to the sidebar width on desktop (lg+) so its
        content is not hidden behind the fixed sidebar.

        The offset is set via a CSS custom property (--sidebar-width) which is
        already defined in globals.css and updated at each responsive breakpoint,
        so the margin tracks the sidebar width automatically without JS.
        On mobile (< lg) the sidebar is hidden and the offset is 0.
      */}
      <div className="app-bg app-shell-min-h flex w-full">

        {/* Desktop sidebar — position:fixed, hidden below lg (1024 px) */}
        <Sidebar />

        {/*
          Main column — full width on mobile (sidebar hidden).
          On desktop (lg+) the sidebar-offset class (defined in globals.css) adds
          padding-left equal to --sidebar-width so content never slides under the
          fixed sidebar.  The transition matches the sidebar collapse animation.
        */}
        <div className="sidebar-offset flex-1 flex flex-col min-w-0 w-full">

          {/* Mobile / tablet top bar — hidden on lg+ */}
          <AppHeader />

          {/*
            Page content scroll container.

            On mobile (< lg): bottom padding = bottomnav height + safe-area-inset-bottom.
            We cannot use calc() with env() directly in Tailwind's arbitrary value syntax
            reliably, so we use a CSS custom property approach combined with a
            pb-[env-bottomnav] utility class defined in globals.css.

            overflow-y: auto is removed here — we let the browser's native scroll
            apply to the whole page instead of clipping inside a nested container.
            This fixes iOS Safari momentum scrolling and rubber-band behaviour.
          */}
          <main className="flex-1 min-h-0 w-full pb-mobile-nav lg:pb-8">
            {children}
          </main>
        </div>

        {/* Mobile / tablet bottom nav — hidden on lg+ */}
        <BottomNav />
      </div>

      {/* Global command palette — overlay portal, outside the flex row */}
      <CommandPalette />

      {/* Silently registers the service worker for push notifications */}
      <PushRegistrar />

      {/*
        Client-side inactivity guard.  Redirects to /login with a toast if the
        user has been idle for SESSION_IDLE_TIMEOUT_MINUTES.  The server enforces
        the same limit independently; this component is a UX aid only.
      */}
      <InactivityMonitor />
    </>
  )
}
