'use client'

/**
 * hooks/useAppearance.ts
 *
 * Convenience re-export of the ThemeContext so any component can access
 * appearance preferences (theme, Night Shift, Turn Tone settings) and
 * apply changes without importing from the providers directory directly.
 *
 * Usage:
 *   const { appearance, applyAppearance, nightShiftActive } = useAppearance()
 */

export { useTheme as useAppearance } from '@/components/providers/ThemeProvider'
export type { ThemeContextValue as AppearanceContextValue } from '@/components/providers/ThemeProvider'
