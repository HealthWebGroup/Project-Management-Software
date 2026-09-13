/**
 * One highlight that travels between items, instead of one per item
 * fading in and out.
 *
 * The idea is the AnimatedBackground pattern from motion-primitives. The
 * implementation is ours: that library is built on Framer Motion, and
 * pulling in an animation runtime — plus its bundle — to move one
 * rectangle is a poor trade in an app that ships on a free plan and is
 * measured in kilobytes. This is a single absolutely-positioned element
 * whose transform is set from the active child's measured box.
 *
 * Why it is worth having at all: when a selection fades out here and in
 * over there, the eye has to find the new one. When a single shape slides,
 * the eye is carried to it. On a tab strip switched dozens of times a day
 * that is the difference between reading the interface and using it.
 *
 * It measures rather than assuming: children can be any width, wrap, or
 * change (a board's view switcher is three fixed tabs, the top nav is
 * five links of different lengths). A ResizeObserver keeps it correct when
 * the container reflows, and it recomputes when the active id changes.
 *
 * Under `prefers-reduced-motion` the highlight still moves — it simply
 * arrives instantly, because a highlight that does not move at all would
 * leave no visible selection.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export default function SlidingHighlight({
  activeId,
  children,
  className = '',
  vertical = false,
}: {
  /** Must match a child's `data-slide-id`. Null hides the highlight. */
  activeId: string | null
  children: ReactNode
  className?: string
  /** Vertical strips animate top/height instead of left/width. */
  vertical?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  // Nothing should animate on the very first paint: an interface that
  // slides its highlight in from the corner on load looks broken.
  const [ready, setReady] = useState(false)

  const measure = useCallback(() => {
    const root = container.current
    if (!root || !activeId) {
      setBox(null)
      return
    }

    // Escaping the id keeps a client name with a quote in it from throwing
    // inside querySelector, which would take the whole page down.
    const escaped =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(activeId) : activeId.replace(/"/g, '\\"')
    const target = root.querySelector<HTMLElement>(`[data-slide-id="${escaped}"]`)
    if (!target) {
      setBox(null)
      return
    }

    const outer = root.getBoundingClientRect()
    const inner = target.getBoundingClientRect()
    setBox({
      left: inner.left - outer.left,
      top: inner.top - outer.top,
      width: inner.width,
      height: inner.height,
    })
  }, [activeId])

  // Layout effect, not effect: measuring after the browser has painted
  // shows one frame of the highlight in its old place.
  useLayoutEffect(() => {
    measure()
  }, [measure, children])

  useEffect(() => {
    const root = container.current
    if (!root) return

    const observer = new ResizeObserver(() => measure())
    observer.observe(root)
    for (const child of Array.from(root.children)) observer.observe(child)

    // Web fonts land after first paint and change every measurement with
    // them. Without this the highlight sits a few pixels wrong until the
    // next interaction — subtle, and exactly the sort of thing that reads
    // as "not quite finished".
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    fonts?.ready?.then(() => measure()).catch(() => {})

    window.addEventListener('resize', measure)
    const raf = requestAnimationFrame(() => setReady(true))

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(raf)
    }
  }, [measure])

  return (
    <div className={`slider ${className}`} ref={container}>
      {box && (
        <span
          className={ready ? 'slider-pill glide' : 'slider-pill'}
          aria-hidden="true"
          style={
            vertical
              ? { transform: `translateY(${box.top}px)`, height: box.height }
              : { transform: `translateX(${box.left}px)`, width: box.width, height: box.height }
          }
        />
      )}
      {children}
    </div>
  )
}
