import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 70

/** Touch pull-to-refresh for a scrolled-to-top page. Returns the current pull distance and a refreshing flag. */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    const start = (e: TouchEvent) => {
      if (window.scrollY <= 0 && !busy.current) startY.current = e.touches[0].clientY
    }
    const move = (e: TouchEvent) => {
      if (startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0) setPull(Math.min(dy * 0.5, 100))
      else {
        startY.current = null
        setPull(0)
      }
    }
    const end = async () => {
      const shouldRefresh = startY.current !== null && pull >= THRESHOLD
      startY.current = null
      if (!shouldRefresh) return setPull(0)
      busy.current = true
      setRefreshing(true)
      setPull(THRESHOLD)
      try {
        await onRefresh()
      } finally {
        busy.current = false
        setRefreshing(false)
        setPull(0)
      }
    }
    const endHandler = () => void end()
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', endHandler)
    return () => {
      window.removeEventListener('touchstart', start)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', endHandler)
    }
  }, [onRefresh, pull])

  return { pull, refreshing, ready: pull >= THRESHOLD }
}
