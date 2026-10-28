import { Delete } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { PIN_LENGTH } from '@/config/app'
import { cn } from '@/lib/cn'

interface Props {
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  disabled?: boolean
  error?: string | null
  label?: string
}

/** Six dot PIN entry with an on-screen keypad. Also accepts the physical keyboard. */
export function PinPad({ value, onChange, onComplete, disabled, error, label }: Props) {
  const push = (d: string) => {
    if (disabled || value.length >= PIN_LENGTH) return
    const next = value + d
    onChange(next)
    if (next.length === PIN_LENGTH) onComplete?.(next)
  }
  const pop = () => {
    if (!disabled) onChange(value.slice(0, -1))
  }

  // The key listener always calls the latest handlers without being re-registered on every keypress.
  const handlers = useRef({ push, pop })
  useEffect(() => {
    handlers.current = { push, pop }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (/^\d$/.test(e.key)) handlers.current.push(e.key)
      else if (e.key === 'Backspace') handlers.current.pop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="select-none" aria-label={label ?? 'Enter PIN'}>
      <div className="mb-2 flex justify-center gap-3" role="img" aria-label={`${value.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn('size-3.5 rounded-full border-2 transition', i < value.length ? 'border-brand-500 bg-brand-500' : 'border-brand-200', error && 'border-bad bg-bad/20')}
          />
        ))}
      </div>
      <p role="alert" className="mb-3 h-5 text-center text-sm text-bad">
        {error ?? ''}
      </p>
      <div className="mx-auto grid max-w-[260px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => push(d)} disabled={disabled}>
            {d}
          </Key>
        ))}
        <span />
        <Key onClick={() => push('0')} disabled={disabled}>
          0
        </Key>
        <Key onClick={pop} disabled={disabled} aria-label="Delete">
          <Delete className="mx-auto size-5" />
        </Key>
      </div>
    </div>
  )
}

function Key({ children, onClick, disabled, ...rest }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 rounded-2xl bg-canvas font-display text-xl font-semibold text-ink transition active:scale-95 active:bg-brand-100 disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  )
}
