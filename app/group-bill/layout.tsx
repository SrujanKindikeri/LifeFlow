/**
 * Layout for all /group-bill/* routes.
 *
 * Intentionally minimal — just renders its children directly.
 * No sidebar, no navigation, no dashboard shell, no profile.
 * The root layout (app/layout.tsx) still wraps this with ThemeProvider
 * and ToastProvider, which is fine (they add no visible UI).
 *
 * This layout exists solely to prevent the authenticated app layout
 * (app/app/layout.tsx) from being applied to these public routes.
 */
export default function GroupBillPublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
