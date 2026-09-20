'use client'

/**
 * GlassSurface — reusable Liquid Glass surface component.
 *
 * Variants map to the CSS glass hierarchy defined in globals.css:
 *   subtle  → glass-subtle  (decorative backgrounds, list rows)
 *   regular → glass         (standard content cards)
 *   strong  → glass-elevated (important/focused cards, heroes)
 *   modal   → glass-floating (modals, popovers, toasts)
 *   control → glass-elevated + btn styling (segmented controls, toolbars)
 *   panel   → glass-panel   (sticky nav surfaces)
 *
 * Optional modifiers:
 *   catchlight  → adds specular top-left highlight (glass-catchlight)
 *   depth       → inset shadow for recessed-edge feel (glass-depth)
 *   ring        → secondary inner border for maximum premium feel (glass-ring)
 *
 * All variants automatically adapt to Light, Dark, and Night Shift via
 * CSS custom properties — no JS needed.
 *
 * Usage:
 *   <GlassSurface variant="regular" className="rounded-2xl p-5">
 *     content
 *   </GlassSurface>
 *
 *   <GlassSurface variant="strong" catchlight padding="md">
 *     hero card content
 *   </GlassSurface>
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type GlassVariant = 'subtle' | 'regular' | 'strong' | 'modal' | 'control' | 'panel'
export type GlassPadding = 'none' | 'xs' | 'sm' | 'md' | 'lg'
export type GlassRadius  = 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'

export interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual tier of the glass surface. Defaults to 'regular'. */
  variant?:    GlassVariant
  /** Built-in padding shorthand. Defaults to 'none'. */
  padding?:    GlassPadding
  /** Border-radius shorthand. Defaults to 'lg' (20px). */
  radius?:     GlassRadius
  /** Adds a specular top-left catch-light. */
  catchlight?: boolean
  /** Adds an inset depth shadow for recessed-edge feel. */
  depth?:      boolean
  /** Adds a secondary inner ring for maximum premium feel (modals, heroes). */
  ring?:       boolean
  /** Makes the surface a clickable card (hover lift, cursor pointer). */
  interactive?: boolean
  /** Render as a different HTML element. Defaults to 'div'. */
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'nav' | 'main'
  children?: React.ReactNode
}

/* ── Maps ───────────────────────────────────────────────────────────────────── */

const VARIANT_CLASS: Record<GlassVariant, string> = {
  subtle:  'glass-subtle',
  regular: 'glass',
  strong:  'glass-elevated',
  modal:   'glass-floating',
  control: 'glass-elevated',
  panel:   'glass-panel',
}

const PADDING_CLASS: Record<GlassPadding, string> = {
  none: '',
  xs:   'p-3',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
}

const RADIUS_CLASS: Record<GlassRadius, string> = {
  none: 'rounded-none',
  sm:   'rounded-xl',
  md:   'rounded-2xl',
  lg:   'rounded-[20px]',
  xl:   'rounded-[24px]',
  '2xl':'rounded-[32px]',
  full: 'rounded-full',
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(
  (
    {
      variant     = 'regular',
      padding     = 'none',
      radius      = 'md',
      catchlight  = false,
      depth       = false,
      ring        = false,
      interactive = false,
      as: Tag     = 'div',
      className,
      children,
      style,
      ...props
    },
    ref
  ) => {
    return (
      <Tag
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(
          /* Base glass surface */
          VARIANT_CLASS[variant],
          PADDING_CLASS[padding],
          RADIUS_CLASS[radius],
          /* Optional enhancements */
          catchlight && 'glass-catchlight',
          depth      && 'glass-depth',
          ring       && 'glass-ring',
          /* Interactive hover lift */
          interactive && [
            'cursor-pointer',
            'transition-[box-shadow,transform]',
            'duration-200',
            'hover:shadow-[var(--glass-hover-shadow)]',
            'hover:-translate-y-px',
            'active:translate-y-0',
          ],
          className
        )}
        style={style}
        {...props}
      >
        {children}
      </Tag>
    )
  }
)

GlassSurface.displayName = 'GlassSurface'

/* ── Convenience wrappers ───────────────────────────────────────────────────── */

/**
 * GlassCard — the most common usage: a regular glass card with padding.
 * Drop-in for the existing GlassCard when you want a non-motion surface.
 */
export function GlassCardSurface({
  children,
  className,
  padding = 'md',
  catchlight,
  ...props
}: Omit<GlassSurfaceProps, 'variant'>) {
  return (
    <GlassSurface variant="regular" padding={padding} radius="md" catchlight={catchlight} className={className} {...props}>
      {children}
    </GlassSurface>
  )
}

/**
 * GlassHero — elevated surface for section heroes and profile headers.
 * Includes catch-light by default.
 */
export function GlassHero({
  children,
  className,
  padding = 'lg',
  ...props
}: Omit<GlassSurfaceProps, 'variant' | 'catchlight'>) {
  return (
    <GlassSurface variant="strong" padding={padding} radius="md" catchlight className={className} {...props}>
      {children}
    </GlassSurface>
  )
}

/**
 * GlassModal — floating surface for modals, popovers, and sheets.
 */
export function GlassModal({
  children,
  className,
  padding = 'md',
  ...props
}: Omit<GlassSurfaceProps, 'variant' | 'depth'>) {
  return (
    <GlassSurface variant="modal" padding={padding} radius="xl" depth className={className} {...props}>
      {children}
    </GlassSurface>
  )
}

/**
 * GlassInset — subtle inset surface for inner content areas.
 */
export function GlassInset({
  children,
  className,
  padding = 'sm',
  ...props
}: Omit<GlassSurfaceProps, 'variant'>) {
  return (
    <GlassSurface variant="subtle" padding={padding} radius="sm" className={className} {...props}>
      {children}
    </GlassSurface>
  )
}
