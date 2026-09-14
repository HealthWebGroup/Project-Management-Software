/**
 * A menu that escapes its container.
 *
 * The kanban lanes scroll: `.lanes` clips on both axes and `.lane-body`
 * has its own overflow. Anything `position: absolute` inside a card is
 * therefore clipped by them, which is why clicking "+ Priority" or
 * "+ Assign" looked like nothing happened — the menu was rendering
 * correctly, a few pixels outside a box with `overflow: hidden`, and the
 * only hint was a sliver of it poking out at the lane edge.
 *
 * No amount of z-index fixes that: z-index orders what is painted, it does
 * not exempt anything from clipping. The only reliable answer is to render
 * somewhere else in the DOM entirely — a portal on <body> — and position
 * it against the button's on-screen rectangle.
 *
 * Which is why this is `position: fixed` and not absolute: fixed is
 * relative to the viewport, and the rect from getBoundingClientRect() is
 * in viewport coordinates too, so the two agree with no scroll maths.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** The button the menu belongs to. */
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
  /** Preferred side. 'auto' puts it below unless it would fall off. */
  placement?: 'auto' | 'top' | 'bottom'
  className?: string
}

const GAP = 6
const MARGIN = 8

export default function Popover({
  anchor, onClose, children, placement = 'auto', className = '',
}: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    // Off-screen and invisible for the first frame: the position cannot be
    // known until the panel has been measured, and a menu that appears in
    // the corner and jumps looks broken.
    position: 'fixed', top: -9999, left: -9999, visibility: 'hidden',
  })

  useLayoutEffect(() => {
    if (!anchor) return

    const place = () => {
      const a = anchor.getBoundingClientRect()
      const p = panel.current?.getBoundingClientRect()
      const h = p?.height ?? 0
      const w = p?.width ?? 0

      const roomBelow = window.innerHeight - a.bottom
      const above = placement === 'top' || (placement === 'auto' && roomBelow < h + GAP + MARGIN)

      let top = above ? a.top - h - GAP : a.bottom + GAP
      // If it does not fit either way, pin it inside the viewport rather
      // than letting it hang off the top of the screen.
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN))

      let left = a.left
      if (left + w > window.innerWidth - MARGIN) left = window.innerWidth - w - MARGIN
      left = Math.max(MARGIN, left)

      setStyle({ position: 'fixed', top, left, visibility: 'visible' })
    }

    place()

    // Reposition rather than close on scroll. Closing is the easy answer and
    // the wrong one: the lanes scroll horizontally, so a stray trackpad
    // nudge while reaching for an option would dismiss the menu.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, placement, children])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t)) return
      if (anchor?.contains(t)) return   // the button handles its own toggle
      onClose()
    }
    document.addEventListener('keydown', onKey)
    // Capture phase, so this runs before a click inside the page can act.
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={panel} className={`popover-panel ${className}`} style={style}>
      {children}
    </div>,
    document.body,
  )
}
