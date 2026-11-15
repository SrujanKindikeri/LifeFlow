'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Bell, RefreshCw, Activity,
  Shield, FileText, Server, Megaphone, HeadphonesIcon,
  UserCog, Settings, LogOut, StickyNote, CheckSquare,
  Flame, FolderOpen, Wallet, CreditCard, UserCircle,
} from 'lucide-react'
import type { AdminRole } from '@/models/AdminUser'

interface AdminSidebarProps {
  adminName: string
  adminRole: AdminRole
}

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: '/admin/dashboard',  icon: LayoutDashboard, label: 'Overview',     roles: ['super_admin', 'admin', 'support', 'auditor'] },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/admin/users',      icon: Users,           label: 'User Management', roles: ['super_admin', 'admin', 'support'] },
    ],
  },
  {
    label: 'Features',
    items: [
      { href: '/admin/notes',         icon: StickyNote,  label: 'Notes',         roles: ['super_admin', 'admin'] },
      { href: '/admin/tasks',         icon: CheckSquare, label: 'Tasks',         roles: ['super_admin', 'admin'] },
      { href: '/admin/habits',        icon: Flame,       label: 'Habits',        roles: ['super_admin', 'admin'] },
      { href: '/admin/projects',      icon: FolderOpen,  label: 'Projects',      roles: ['super_admin', 'admin'] },
      { href: '/admin/expenses',      icon: Wallet,      label: 'Expenses',      roles: ['super_admin', 'admin'] },
      { href: '/admin/subscriptions', icon: CreditCard,  label: 'Subscriptions', roles: ['super_admin', 'admin'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/notifications', icon: Bell,         label: 'Notifications',  roles: ['super_admin', 'admin', 'support'] },
      { href: '/admin/sync',          icon: RefreshCw,    label: 'Data Sync',      roles: ['super_admin', 'admin'] },
      { href: '/admin/announcements', icon: Megaphone,    label: 'Announcements',  roles: ['super_admin', 'admin'] },
      { href: '/admin/support',       icon: HeadphonesIcon, label: 'Support',      roles: ['super_admin', 'admin', 'support'] },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/security',         icon: Shield,      label: 'Security',       roles: ['super_admin', 'admin'] },
      { href: '/admin/audit-logs',       icon: FileText,    label: 'Audit Logs',     roles: ['super_admin', 'admin', 'auditor'] },
      { href: '/admin/health',           icon: Server,      label: 'System Health',  roles: ['super_admin', 'admin', 'auditor'] },
      { href: '/admin/admin-management', icon: UserCog,     label: 'Admin Mgmt',     roles: ['super_admin'] },
      { href: '/admin/settings',         icon: Settings,    label: 'Settings',       roles: ['super_admin'] },
      { href: '/admin/analytics',        icon: Activity,    label: 'Analytics',      roles: ['super_admin', 'admin'] },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/admin/profile', icon: UserCircle, label: 'My Profile', roles: ['super_admin', 'admin', 'support', 'auditor'] },
    ],
  },
]

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  support:     'Support',
  auditor:     'Auditor',
}

const ROLE_COLORS: Record<AdminRole, string> = {
  super_admin: '#dc2626',
  admin:       '#2563eb',
  support:     '#16a34a',
  auditor:     '#d97706',
}

export function AdminSidebar({ adminName, adminRole }: AdminSidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  const initials = adminName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  return (
    <aside
      className="hidden lg:flex flex-col p-3"
      style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 'var(--admin-sidebar-width, 240px)',
        zIndex: 20,
      }}
    >
      <div
        className="glass-panel glass-catchlight flex flex-col rounded-2xl py-4 overflow-hidden"
        style={{
          height: '100%', minHeight: 0,
          paddingLeft: '10px', paddingRight: '10px',
          border: '1px solid var(--glass-panel-border)',
          boxShadow: 'var(--glass-panel-shadow)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-2 mb-4 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg,rgba(220,38,38,0.14),rgba(239,68,68,0.09))',
              border: '1px solid rgba(220,38,38,0.18)',
            }}
          >
            <Shield size={14} style={{ color: 'var(--danger)' }} />
          </div>
          <div className="overflow-hidden">
            <p className="text-[13px] font-bold tracking-tight leading-none" style={{ color: 'var(--text-primary)' }}>
              LifeFlow
            </p>
            <p className="text-[10px] font-medium leading-none mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Control Panel
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav
          className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-hidden sidebar-nav-scroll"
          aria-label="Admin navigation"
        >
          {NAV_GROUPS.map((group, gi) => {
            // Filter items by role
            const visibleItems = group.items.filter((item) =>
              (item.roles as string[]).includes(adminRole)
            )
            if (visibleItems.length === 0) return null

            return (
              <div key={gi}>
                {group.label && (
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.12em] px-3 mb-1"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                    return (
                      <Link key={item.href} href={item.href} className="w-full">
                        <div className="relative w-full">
                          {isActive && (
                            <motion.div
                              layoutId="admin-sidebar-active-pill"
                              className="absolute inset-0 rounded-xl"
                              style={{
                                background: 'rgba(220,38,38,0.08)',
                                border: '1px solid rgba(220,38,38,0.14)',
                              }}
                              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                            />
                          )}
                          <motion.div
                            whileHover={{ x: isActive ? 0 : 2 }}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                            className={cn(
                              'relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-medium transition-colors',
                              !isActive && 'nav-hover'
                            )}
                            style={{
                              color: isActive ? '#b91c1c' : 'var(--text-secondary)',
                            }}
                          >
                            <item.icon
                              size={14}
                              className="shrink-0"
                              style={{ color: isActive ? 'var(--danger)' : 'var(--text-muted)' }}
                            />
                            <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
                              {item.label}
                            </span>
                          </motion.div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="my-2 mx-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }} />

        {/* Admin profile + logout */}
        <div className="flex-shrink-0 px-2 space-y-1">
          {/* Avatar card — links to /admin/profile */}
          <Link href="/admin/profile" className="block w-full">
            <motion.div
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors"
              style={{
                background: pathname.startsWith('/admin/profile') ? 'rgba(220,38,38,0.06)' : 'var(--glass-subtle-bg)',
                border: pathname.startsWith('/admin/profile') ? '1px solid rgba(220,38,38,0.12)' : '1px solid transparent',
              }}
              aria-label="Go to My Profile"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{
                  background: `${ROLE_COLORS[adminRole]}18`,
                  border: `1px solid ${ROLE_COLORS[adminRole]}30`,
                  color: ROLE_COLORS[adminRole],
                }}
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate leading-none" style={{ color: 'var(--text-primary)' }}>
                  {adminName}
                </p>
                <p
                  className="text-[10px] font-medium mt-0.5 leading-none"
                  style={{ color: ROLE_COLORS[adminRole] }}
                >
                  {ROLE_LABELS[adminRole]}
                </p>
              </div>
              <UserCircle
                size={13}
                className="shrink-0"
                style={{ color: 'var(--text-faint)' }}
                aria-hidden="true"
              />
            </motion.div>
          </Link>

          <button onClick={handleLogout} className="w-full text-left">
            <motion.div
              whileHover={{ x: 2 }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-medium transition-colors nav-hover-danger"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <LogOut size={13} className="shrink-0" />
              <span>Sign Out</span>
            </motion.div>
          </button>
        </div>
      </div>
    </aside>
  )
}
