import { Sidebar }                  from '@/components/layout/Sidebar'
import { BottomNav }                 from '@/components/layout/BottomNav'
import { AppHeader }                 from '@/components/layout/AppHeader'
import { CommandPalette }            from '@/components/ui/CommandPalette'
import { PushRegistrar }             from '@/components/notifications/PushRegistrar'
import { InactivityMonitor }         from '@/components/providers/InactivityMonitor'
import { SyncProvider }              from '@/components/sync/SyncProvider'
import { ClientConflictBridge }      from '@/components/sync/ClientConflictBridge'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      SyncProvider wraps the entire authenticated shell.
      It fetches the server-confirmed userId, calls setActiveUser(), and
      initialises the sync engine. Teardown happens on unmount (logout/session
      expiry navigates away from /app/*).
    */
    <SyncProvider>
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

      {/*
        Service worker registration.
        Now registers /public/sw.js (static file) which handles both
        push notifications AND app-shell caching for offline use.
      */}
      <PushRegistrar />

      {/*
        Client-side inactivity guard.  Redirects to /login with a toast if the
        user has been idle for SESSION_IDLE_TIMEOUT_MINUTES.
      */}
      <InactivityMonitor />

      {/*
        Conflict resolution modal — shown when a record has been modified
        both locally and on the server. ClientConflictBridge is a 'use client'
        component that reads the userId from sessionStorage and conditionally
        renders ConflictResolutionModal.
      */}
      <ClientConflictBridge />
    </SyncProvider>
  )
}
