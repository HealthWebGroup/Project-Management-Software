const KNOWN = ['grey', 'blue', 'green', 'amber', 'red', 'violet', 'teal']

export function colourClass(colour?: string): string {
  const c = (colour ?? 'grey').toLowerCase()
  return KNOWN.includes(c) ? c : 'grey'
}

export default function Pill({ colour, children }: { colour?: string; children: React.ReactNode }) {
  return <span className={`pill ${colourClass(colour)}`}>{children}</span>
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, title }: { name: string; title?: string }) {
  return (
    <span className="avatar" title={title ?? name}>
      {initials(name)}
    </span>
  )
}
