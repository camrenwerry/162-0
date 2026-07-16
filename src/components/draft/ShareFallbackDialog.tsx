import { useEffect, useRef, useState } from 'react'
import { useDialogFocusTrap } from '../useDialogFocusTrap'

interface ShareFallbackDialogProps {
  text: string
  onClose: () => void
}

export default function ShareFallbackDialog({ text, onClose }: ShareFallbackDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [status, setStatus] = useState('')
  useDialogFocusTrap(true, dialogRef)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Result copied')
    } catch {
      textRef.current?.focus()
      textRef.current?.select()
      setStatus('Select the text and copy it manually')
    }
  }

  return (
    <div className="share-fallback" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-fallback-title">
        <span>Share Result</span>
        <h2 id="share-fallback-title">Copy your result</h2>
        <p>Automatic clipboard access is unavailable. Copy the selectable summary below.</p>
        <textarea ref={textRef} readOnly value={text} aria-label="Pennant Pursuit result summary" />
        <div><button type="button" onClick={onClose}>Close</button><button type="button" onClick={copy}>Copy</button></div>
        <small role="status" aria-live="polite">{status}</small>
      </section>
    </div>
  )
}
