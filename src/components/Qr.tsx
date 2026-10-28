import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { isValidAddress } from '@/lib/format'
import { Spinner } from './ui/Feedback'
import { Modal } from './ui/Overlay'

export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const [drawn, setDrawn] = useState<{ value: string; src: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const src = drawn?.value === value ? drawn.src : null
  useEffect(() => {
    let live = true
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0F1B33', light: '#FFFFFF' } })
      .then((url) => live && setDrawn({ value, src: url }))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [value, size])
  if (failed) return <p className="text-sm text-bad">Could not draw the QR code.</p>
  if (!src) return <div className="grid place-items-center" style={{ width: size, height: size }}><Spinner /></div>
  return <img src={src} width={size} height={size} alt={`QR code for ${value}`} className="rounded-2xl" />
}

/** Accepts a bare address or an EIP-681 style `ethereum:0x...` URI. */
export function addressFromQr(text: string): string | null {
  const t = text.trim()
  const m = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})/i.exec(t)
  const candidate = m ? m[1] : t
  return isValidAddress(candidate) ? candidate : null
}

export function QrScanner(props: { open: boolean; onClose: () => void; onAddress: (a: string) => void }) {
  return props.open ? <QrScannerInner {...props} /> : null
}

function QrScannerInner({ open, onClose, onAddress }: { open: boolean; onClose: () => void; onAddress: (a: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const onAddressRef = useRef(onAddress)
  useEffect(() => {
    onAddressRef.current = onAddress
  })

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not available in this browser. Paste the address instead.')
        setStarting(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        const el = video.current
        if (!el) return
        el.srcObject = stream
        await el.play()
        setStarting(false)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const scan = () => {
          if (stopped || !ctx) return
          if (el.readyState >= 2 && el.videoWidth > 0) {
            canvas.width = el.videoWidth
            canvas.height = el.videoHeight
            ctx.drawImage(el, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (hit) {
              const addr = addressFromQr(hit.data)
              if (addr) {
                stopped = true
                onAddressRef.current(addr)
                return
              }
              setError('That QR code is not a wallet address. Try another one.')
            }
          }
          raf = requestAnimationFrame(scan)
        }
        scan()
      } catch (err) {
        const name = (err as DOMException)?.name
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access, or paste the address instead.'
            : name === 'NotFoundError'
              ? 'No camera found on this device. Paste the address instead.'
              : 'Could not start the camera. Paste the address instead.',
        )
        setStarting(false)
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <Modal open={open} onClose={onClose} title="Scan QR code">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-ink">
        <video ref={video} muted playsInline className="size-full object-cover" />
        {starting && !error && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner className="text-white" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80" />
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : <p className="mt-3 text-sm text-ink-mute">Point the camera at a wallet address QR code.</p>}
    </Modal>
  )
}
