/**
 * Adding a task, in one action.
 *
 * What this replaces: press "+ Add item", which created a row literally
 * called "New item"; find it; click its title; select the placeholder text;
 * type the real name; press Enter. Six actions to record one task, and a
 * board that filled up with rows called "New item" whenever someone was
 * interrupted halfway.
 *
 * Now: type the name, press Enter. The row is created with the right title
 * first time, the field clears, and focus stays put — so ten tasks off a
 * meeting note are ten lines of typing rather than sixty interactions.
 *
 * Escape gives the field up, which is what lets the board's keyboard
 * shortcuts take over again without reaching for the mouse.
 */

import { useRef, useState } from 'react'

export default function QuickAdd({
  onAdd,
  label = 'Add an item',
}: {
  /** Resolves when the item exists. Rejecting leaves the text in place. */
  onAdd: (title: string) => Promise<void>
  label?: string
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function commit() {
    const text = title.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onAdd(text)
      // Only clear on success. A failed save that also ate what you typed
      // is the worst outcome here.
      setTitle('')
    } finally {
      setBusy(false)
      // Belt and braces: the board re-renders around this input when the new
      // row lands, and a re-render can take focus with it. Without this the
      // second task of a batch needs a click, which defeats the point.
      requestAnimationFrame(() => input.current?.focus())
    }
  }

  return (
    <div className="quick-add">
      <span className="qa-plus" aria-hidden="true">+</span>
      <input
        ref={input}
        className="qa-input"
        type="text"
        value={title}
        placeholder={label}
        aria-label={label}
        // Deliberately not `disabled` while saving: disabling an input blurs
        // it, and getting focus back afterwards is unreliable. It stays
        // live and simply refuses a second Enter until the first lands.
        readOnly={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            setTitle('')
            input.current?.blur()
          }
        }}
      />
      {title.trim() && (
        <kbd className="qa-hint" aria-hidden="true">
          Enter
        </kbd>
      )}
    </div>
  )
}
