import { Sidebar }  from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { AppHeader } from '@/components/layout/AppHeader'
import { CommandPalette } from '@/components/ui/CommandPalette'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-bg min-h-screen flex">

        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Mobile top bar */}
          <AppHeader />

          {/* Page content */}
          <main
            className="flex-1 overflow-y-auto"
            style={{ paddingBottom: 'calc(var(--bottomnav-height, 68px) + 16px)' }}
          >
            <div className="lg:pb-8">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile bottom nav */}
        <BottomNav />
      </div>

      {/* Global command palette — rendered as overlay portal, outside the flex row */}
      <CommandPalette />
    </>
  )
}
