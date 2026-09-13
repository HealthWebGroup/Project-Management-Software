/**
 * Compact or comfortable.
 *
 * Density is a matter of eyesight and monitor, not taste, so it belongs to
 * the person rather than to the design. The choice is written to the root
 * element as a data attribute — one CSS token block redefines the spacing
 * scale and every table, list and toolbar follows, because none of them
 * hard-code a padding.
 *
 * It is remembered per browser. localStorage throws outright in a few
 * contexts (private windows with site data blocked, embedded previews), so
 * every read and write is wrapped: a failure here must cost the setting,
 * never the board.
 */

import { useEffect, useState } from 'react'

export type Density = 'compact' | 'comfortable'

const KEY = 'workos.density'

export function readDensity(): Density {
  try {
    return localStorage.getItem(KEY) === 'comfortable' ? 'comfortable' : 'compact'
  } catch {
    return 'compact'
  }
}

export function applyDensity(density: Density) {
  document.documentElement.setAttribute('data-density', density)
  try {
    localStorage.setItem(KEY, density)
  } catch {
    /* the setting is a convenience; losing it is not worth an error */
  }
}

export default function DensityToggle() {
  const [density, setDensity] = useState<Density>(readDensity)

  useEffect(() => {
    applyDensity(density)
  }, [density])

  const next: Density = density === 'compact' ? 'comfortable' : 'compact'

  return (
    <button
      type="button"
      className="density-toggle"
      onClick={() => setDensity(next)}
      title={
        density === 'compact'
          ? 'Rows are tight — switch to roomier spacing'
          : 'Rows are roomy — switch to tighter spacing'
      }
      aria-label={`Row spacing: ${density}. Switch to ${next}.`}
    >
      <span className={`dt-bars ${density}`} aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="dt-label">{density === 'compact' ? 'Compact' : 'Roomy'}</span>
    </button>
  )
}
