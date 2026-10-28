import { useQuery } from '@tanstack/react-query'
import { BookUser, ClipboardPaste, ScanLine } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { isValidAddress, shortAddress } from '@/lib/format'
import { Input } from './ui/Input'
import { ErrorState, EmptyState, Skeleton, notifyToast } from './ui/Feedback'
import { BottomSheet } from './ui/Overlay'
import { QrScanner, addressFromQr } from './Qr'

interface Props {
  value: string
  onChange: (v: string) => void
  error?: string | null
  disabled?: boolean
}

export function AddressInput({ value, onChange, error, disabled }: Props) {
  const [scan, setScan] = useState(false)
  const [book, setBook] = useState(false)
  const found = useCallback(
    (a: string) => {
      onChange(a)
      setScan(false)
    },
    [onChange],
  )

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const addr = addressFromQr(text)
      if (!addr) return notifyToast.error('The clipboard does not contain a valid wallet address.')
      onChange(addr)
    } catch {
      notifyToast.error('Cannot read the clipboard. Long-press the field and paste instead.')
    }
  }

  const invalid = value.length > 0 && !isValidAddress(value) ? 'Enter a valid 0x wallet address' : null
  const btn = 'grid size-9 shrink-0 place-items-center rounded-xl text-brand-600 hover:bg-brand-50 disabled:opacity-40'

  return (
    <>
      <Input
        label="Recipient address"
        placeholder="0x…"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        error={error ?? invalid}
        disabled={disabled}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        trailing={
          <span className="flex items-center">
            <button type="button" className={btn} onClick={paste} disabled={disabled} aria-label="Paste address">
              <ClipboardPaste className="size-5" />
            </button>
            <button type="button" className={btn} onClick={() => setScan(true)} disabled={disabled} aria-label="Scan QR code">
              <ScanLine className="size-5" />
            </button>
            <button type="button" className={btn} onClick={() => setBook(true)} disabled={disabled} aria-label="Pick from address book">
              <BookUser className="size-5" />
            </button>
          </span>
        }
      />
      <QrScanner open={scan} onClose={() => setScan(false)} onAddress={found} />
      <BottomSheet open={book} onClose={() => setBook(false)} title="Address book">
        <ContactPicker
          onPick={(a) => {
            onChange(a)
            setBook(false)
          }}
        />
      </BottomSheet>
    </>
  )
}

function ContactPicker({ onPick }: { onPick: (address: string) => void }) {
  const q = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() })
  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
  if (q.error) return <ErrorState message={describeError(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />
  const contacts = q.data?.data ?? []
  if (contacts.length === 0) return <EmptyState title="No contacts yet" body="Save addresses in Settings, then pick them here." />
  return (
    <ul className="space-y-2">
      {contacts.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onPick(c.address)} className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-canvas px-4 text-left hover:bg-brand-50">
            <span className="grid size-10 place-items-center rounded-full bg-brand-100 font-semibold text-brand-700">{c.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{c.name}</span>
              <span className="block font-mono text-xs text-ink-mute">{shortAddress(c.address)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
