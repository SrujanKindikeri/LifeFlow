'use client'

import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'

type PaddingSize = 'none' | 'xs' | 'sm' | 'md' | 'lg'
type GlassLevel  = 'subtle' | 'regular' | 'elevated' | 'floating'

interface GlassCardProps extends HTMLMotionProps<'div'> {
  children:   React.ReactNode
  className?: string
  hover?:     boolean
  padding?:   PaddingSize
  level?:     GlassLevel
  glow?:      boolean
  highlight?: boolean
}

const paddingMap: Record<PaddingSize, string> = {
  none: '',
  xs:   'p-3',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
}

const levelMap: Record<GlassLevel, string> = {
  subtle:   'glass-subtle',
  regular:  'glass',
  elevated: 'glass-elevated',
  floating: 'glass-floating',
}

export function GlassCard({
  children,
  className,
  hover     = false,
  padding   = 'md',
  level     = 'regular',
  glow      = false,
  highlight = false,
  ...props
}: GlassCardProps) {
  return (
    <motion.div
      className={cn(
        'relative rounded-2xl',
        levelMap[level],
        paddingMap[padding],
        hover && [
          'cursor-pointer transition-all duration-200',
          'hover:shadow-[0_8px_32px_rgba(0,0,0,0.10)]',
          'hover:-translate-y-0.5',
        ],
        glow && 'shadow-[0_0_32px_rgba(37,99,235,0.10)]',
        highlight && 'glass-highlight',
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}
