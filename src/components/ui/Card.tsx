import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl2 bg-white p-4 shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-mute">{children}</h2>
      {action}
    </div>
  )
}

export function Row({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-ink-mute">{label}</span>
      <span className={cn('max-w-[65%] break-all text-right font-medium text-ink tabular', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  )
}
