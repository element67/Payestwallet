import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Shows a spinner and blocks clicks, preventing double submission. */
  loading?: boolean
  icon?: ReactNode
  full?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn hover:brightness-105 active:brightness-95',
  secondary: 'bg-white text-brand-700 border border-brand-100 hover:bg-brand-50 shadow-card',
  ghost: 'bg-transparent text-brand-600 hover:bg-brand-50',
  danger: 'bg-bad text-white hover:brightness-105',
}
const sizes: Record<Size, string> = {
  sm: 'h-10 px-3.5 text-sm rounded-xl',
  md: 'h-12 px-5 text-[15px] rounded-2xl',
  lg: 'h-14 px-6 text-base rounded-2xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, full, className, children, disabled, type = 'button', onClick, ...rest },
  ref,
) {
  const blocked = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={blocked}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (blocked) return e.preventDefault()
        onClick?.(e)
      }}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
        variants[variant],
        sizes[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

/** Round gradient icon button used for the dashboard actions. */
export function ActionTile({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[44px] flex-col items-center gap-2 disabled:opacity-50"
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn transition group-active:scale-95">
        {icon}
      </span>
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
    </button>
  )
}
