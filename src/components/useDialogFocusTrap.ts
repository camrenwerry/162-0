import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  restoreFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallbackFocus = restoreFocusRef?.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () => [...(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus())
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleTab)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleTab)
      document.body.style.overflow = previousOverflow
      const restoreTarget = previousFocus && document.contains(previousFocus) ? previousFocus : fallbackFocus
      restoreTarget?.focus()
    }
  }, [active, containerRef, restoreFocusRef])
}
