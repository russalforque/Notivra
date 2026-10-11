import type { PageTemplate } from '../../db/types'

/** Tiny static preview of a page template used in pickers. */
export function TemplatePreview({ template }: { template: PageTemplate }) {
  return (
    <svg viewBox="0 0 30 40" className="h-10 w-8 rounded-sm border border-border bg-paper" aria-hidden>
      {template === 'lined' && [8, 13, 18, 23, 28, 33].map((y) => <line key={y} x1="3" x2="27" y1={y} y2={y} stroke="#9fb3db" strokeWidth="0.7" />)}
      {template === 'grid' && (
        <>
          {[5, 10, 15, 20, 25].map((x) => (
            <line key={`x${x}`} x1={x} x2={x} y1="0" y2="40" stroke="#c4d0ea" strokeWidth="0.5" />
          ))}
          {[5, 10, 15, 20, 25, 30, 35].map((y) => (
            <line key={`y${y}`} x1="0" x2="30" y1={y} y2={y} stroke="#c4d0ea" strokeWidth="0.5" />
          ))}
        </>
      )}
      {template === 'dotted' &&
        [5, 10, 15, 20, 25].flatMap((x) => [5, 10, 15, 20, 25, 30, 35].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.6" fill="#9fb3db" />))}
    </svg>
  )
}
