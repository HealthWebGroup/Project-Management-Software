import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog that behaves like one: Escape closes it, focus moves into it and
 * stays there while it is open, and focus goes back where it came from after.
 */
export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  /**
   * Focus, once.
   *
   * This used to live in the same effect as the key handler, which depends on
   * `onClose` - and every caller passes an inline arrow, so `onClose` is a new
   * function on every parent render. The effect therefore re-ran constantly,
   * and each re-run pulled focus back to the close button. On a board with a
   * timer running the page re-renders once a second, so a dialog was almost
   * unusable: dropdowns snapped shut and typing went nowhere.
   *
   * An empty dependency list is the point here, not an oversight.
   */
  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const restore = returnTo.current
    return () => restore?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !ref.current) return

      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) return

      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </>
  )
}
