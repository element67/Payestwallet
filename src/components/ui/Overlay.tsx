import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

interface OverlayProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Prevents closing by backdrop or Escape (used while a request is pending). */
  locked?: boolean
}

function useOverlayBehaviour(open: boolean, onClose: () => void, locked?: boolean) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previous?.focus?.()
    }
  }, [open, onClose, locked])
  return panel
}

function Header({ title, onClose, locked }: { title?: string; onClose: () => void; locked?: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        disabled={locked}
        aria-label="Close"
        className="grid size-10 place-items-center rounded-full text-ink-mute hover:bg-brand-50 disabled:opacity-40"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}

/** Centered dialog. */
export function Modal({ open, onClose, title, children, locked }: OverlayProps) {
  const panel = useOverlayBehaviour(open, onClose, locked)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={locked ? undefined : onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ y: 16, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.97 }}
            className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-xl3 bg-white p-5 shadow-pop outline-none"
          >
            <Header title={title} onClose={onClose} locked={locked} />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Slides up from the bottom on phones. */
export function BottomSheet({ open, onClose, title, children, locked }: OverlayProps) {
  const panel = useOverlayBehaviour(open, onClose, locked)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={locked ? undefined : onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            className={cn('safe-bottom relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-white px-5 pb-6 pt-3 shadow-pop outline-none')}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-brand-100" aria-hidden />
            <Header title={title} onClose={onClose} locked={locked} />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
