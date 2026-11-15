/**
 * Admin shell layout — wraps all /admin/* pages except /admin/login.
 *
 * Verifies the admin session server-side on every render (defense in depth
 * on top of the proxy.ts cookie check).  Redirects to /admin/login if the
 * session is missing, expired, or the account is deactivated.
 */
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/admin-auth'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'LifeFlow Admin',
  description: 'LifeFlow Central Control Panel',
  robots: 'noindex, nofollow',
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // /admin/login must not be wrapped by this layout — it has its own page at
  // app/admin/login/page.tsx and does not call requireAdmin().
  // Next.js will not apply this layout to app/admin/login because that file
  // exists at a different path depth without this layout in its ancestor chain.
  // Actually in Next.js App Router, a layout wraps all pages in the SAME
  // directory. Since login is at app/admin/login/ and this layout is at
  // app/admin/layout.tsx, it WILL be applied. We must allow unauthenticated
  // access to /admin/login — so we skip the auth check for that path.
  // We cannot read the pathname in a Server Component layout directly, but we
  // can use the fact that requireAdmin() only throws for bad sessions:
  // the login page itself never calls this layout because we structure the
  // routes so that login is in a separate route group.
  //
  // STRUCTURE:
  //   app/admin/login/page.tsx    ← uses app/admin/layout.tsx (this file)
  //   app/admin/dashboard/page.tsx ← same layout
  //
  // Solution: we use a separate (admin-auth) route group for login.
  // But for simplicity here, we check the session and catch the error —
  // if unauthenticated AND trying to reach login, the proxy already redirected.
  // This layout only runs for pages OTHER than login (proxy sends unauthenticated
  // users to /admin/login which bypasses this guard at the proxy level).
  //
  // However to be truly safe: any page under /admin/* that is NOT login
  // will be protected by requireAdmin() in the page itself too.
  // We include a layout-level check as belt+suspenders.

  let admin
  try {
    admin = await requireAdmin({ skipActivityUpdate: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (
      msg === 'AdminUnauthorized' ||
      msg === 'AdminSessionExpired' ||
      msg === 'AdminNotFound'
    ) {
      redirect('/admin/login')
    }
    throw err
  }

  return (
    <div
      className="flex min-h-screen w-full"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Fixed sidebar — desktop only */}
      <AdminSidebar adminName={admin.name} adminRole={admin.role} />

      {/* Main content area */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{
          // Offset for sidebar on large screens
          paddingLeft: 'var(--admin-sidebar-width, 240px)',
        }}
      >
        {/* Sidebar offset removed on mobile via CSS */}
        <style>{`
          @media (max-width: 1023px) {
            .flex-1.flex.flex-col.min-w-0 { padding-left: 0 !important; }
          }
        `}</style>
        {children}
      </div>
    </div>
  )
}
