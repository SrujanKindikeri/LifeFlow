'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut, Menu, X, UserCircle, ChevronDown, Shield } from 'lucide-react'
import type { AdminRole } from '@/models/AdminUser'
import { AdminSidebar } from './AdminSidebar'

interface AdminHeaderProps {
  title:       string
  adminName:   string
  adminRole:   AdminRole
  breadcrumb?: { label: string; href?: string }[]
}

const ROLE_COLORS: Record<AdminRole, string> = {
  super_admin: '#dc2626',
  admin:       '#2563eb',
  support:     '#16a34a',
  auditor:     '#d97706',
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function AdminHeader({ title, adminName, adminRole, breadcrumb }: AdminHeaderProps) {
  const router   = useRouter()
  const pathname = usePathname()

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen]   = useState(false)
  const [loggingOut, setLoggingOut]       = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)

  // Close dropdown on route change
  useEffect(() => { setDropdownOpen(false) }, [pathname])

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!dropdownOpen) return

    function onPointerDown(e: PointerEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current  && !triggerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dropdownOpen])

  async function handleLogout() {
    setLoggingOut(true)
    setDropdownOpen(false)
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  const initials = getInitials(adminName)
  const roleColor = ROLE_COLORS[adminRole]

  return (
    <>
      {/* ── Mobile sidebar overlay ─────────────────────────────────── */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 bottom-0 w-64 z-50">
            <AdminSidebar adminName={adminName} adminRole={adminRole} />
          </div>
        </div>
      )}

      {/* ── Header bar ────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 lg:px-6 py-3"
        style={{
          background:     'var(--glass-panel-bg)',
          backdropFilter: 'blur(var(--glass-panel-blur)) saturate(var(--glass-panel-saturate))',
          WebkitBackdropFilter: 'blur(var(--glass-panel-blur)) saturate(var(--glass-panel-saturate))',
          borderBottom:   '1px solid var(--glass-panel-border)',
          minHeight:      56,
        }}
      >
        {/* Left — mobile menu + breadcrumb/title */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => setMobileNavOpen((v) => !v)}
            className="lg:hidden p-1.5 rounded-lg transition-colors shrink-0"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="min-w-0">
            {breadcrumb && breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 mb-0.5">
                {breadcrumb.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && (
                      <span style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>/</span>
                    )}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="text-[11px] transition-colors hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className="text-[11px]"
                        style={{ color: i === breadcrumb.length - 1 ? 'var(--text-muted)' : 'var(--accent)' }}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
            <h1
              className="text-[17px] font-bold tracking-tight truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h1>
          </div>
        </div>

        {/* Right — avatar dropdown */}
        <div className="relative flex items-center gap-2 flex-shrink-0">

          {/* Avatar button */}
          <button
            ref={triggerRef}
            onClick={() => setDropdownOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
            aria-label="Admin account menu"
            className="flex items-center gap-2 rounded-xl transition-all"
            style={{
              padding: '0.3125rem 0.625rem 0.3125rem 0.375rem',
              background: dropdownOpen ? 'var(--glass-subtle-bg)' : 'transparent',
              border: `1px solid ${dropdownOpen ? 'var(--border)' : 'transparent'}`,
              minHeight: 40,
            }}
            onMouseEnter={(e) => {
              if (!dropdownOpen) {
                e.currentTarget.style.background = 'var(--glass-subtle-bg)'
                e.currentTarget.style.borderColor = 'var(--border)'
              }
            }}
            onMouseLeave={(e) => {
              if (!dropdownOpen) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'transparent'
              }
            }}
          >
            {/* Initials avatar */}
            <div
              className="flex items-center justify-center rounded-full text-[11px] font-bold shrink-0"
              style={{
                width: 28, height: 28,
                background: `${roleColor}18`,
                border:     `1.5px solid ${roleColor}35`,
                color:       roleColor,
              }}
              aria-hidden="true"
            >
              {initials}
            </div>

            {/* Name — hidden on very narrow screens */}
            <span
              className="hidden sm:block text-[13px] font-semibold truncate"
              style={{ color: 'var(--text-primary)', maxWidth: 120 }}
            >
              {adminName}
            </span>

            <ChevronDown
              size={13}
              className="shrink-0 transition-transform"
              style={{
                color: 'var(--text-muted)',
                transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
              aria-hidden="true"
            />
          </button>

          {/* Dropdown panel */}
          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                ref={dropdownRef}
                role="menu"
                aria-label="Admin account menu"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 glass-floating rounded-2xl overflow-hidden"
                style={{
                  top: 'calc(100% + 0.5rem)',
                  minWidth: 210,
                  boxShadow: 'var(--glass-shadow-lg)',
                  border: '1px solid var(--glass-floating-border)',
                  zIndex: 50,
                }}
              >
                {/* Identity header */}
                <div
                  style={{
                    padding: '0.75rem 1rem 0.625rem',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex items-center justify-center rounded-full text-[13px] font-bold shrink-0"
                      style={{
                        width: 36, height: 36,
                        background: `${roleColor}18`,
                        border:     `1.5px solid ${roleColor}30`,
                        color:       roleColor,
                      }}
                      aria-hidden="true"
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p
                        className="font-semibold truncate"
                        style={{ color: 'var(--text-primary)', fontSize: '0.8125rem', lineHeight: 1.3 }}
                      >
                        {adminName}
                      </p>
                      <p
                        className="truncate font-medium"
                        style={{ color: roleColor, fontSize: '0.6875rem', lineHeight: 1.3 }}
                      >
                        {adminRole.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div style={{ padding: '0.375rem' }}>
                  <DropdownItem
                    href="/admin/profile"
                    icon={<UserCircle size={14} />}
                    label="My Profile"
                    active={!!pathname?.startsWith('/admin/profile')}
                    onClick={() => setDropdownOpen(false)}
                  />
                  <DropdownItem
                    href="/admin/security"
                    icon={<Shield size={14} />}
                    label="Security"
                    active={!!pathname?.startsWith('/admin/security')}
                    onClick={() => setDropdownOpen(false)}
                  />
                </div>

                {/* Divider + logout */}
                <div style={{ padding: '0 0.375rem 0.375rem' }}>
                  <div style={{ borderTop: '1px solid var(--border)', marginBottom: '0.375rem' }} />
                  <button
                    role="menuitem"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="w-full flex items-center gap-2.5 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                    style={{
                      padding: '0.5rem 0.75rem',
                      color: 'var(--text-muted)',
                      minHeight: 40,
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--danger-dim)'
                      e.currentTarget.style.color = 'var(--danger-text)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--text-muted)'
                    }}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    {loggingOut ? 'Signing out…' : 'Sign Out'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
    </>
  )
}

// ── Dropdown link item ────────────────────────────────────────────────────────

function DropdownItem({
  href, icon, label, active, onClick,
}: {
  href:    string
  icon:    React.ReactNode
  label:   string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl text-[13px] font-medium transition-colors"
      style={{
        padding: '0.5rem 0.75rem',
        color:      active ? 'var(--accent-text)' : 'var(--text-secondary)',
        background: active ? 'var(--accent-dim)'  : 'transparent',
        minHeight: 40,
        display: 'flex',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--glass-subtle-bg)'
          e.currentTarget.style.color = 'var(--text-primary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
    >
      <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} aria-hidden="true">
        {icon}
      </span>
      {label}
    </Link>
  )
}
