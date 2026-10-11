import { useId } from 'react'
import { Link } from 'react-router'

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  // Unique per instance: duplicate SVG ids resolve to the first (possibly hidden) element.
  const gradientId = `notivra-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gradientId})`} />
      <path d="M18 46V18l28 28V18" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46" cy="46" r="4.5" fill="#fbbf24" />
    </svg>
  )
}

export function Logo({ showText = true }: { showText?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-lg" aria-label="Notivra home">
      <LogoMark />
      {showText && <span className="text-lg font-bold tracking-tight">Notivra</span>}
    </Link>
  )
}
