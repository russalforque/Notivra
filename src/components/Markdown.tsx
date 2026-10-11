import type { ReactNode } from 'react'

/**
 * Minimal, safe Markdown renderer for summaries and reviewers: headings, paragraphs, bullet
 * and numbered lists, bold, italic and inline code. It builds React elements directly and
 * never uses innerHTML, so generated or imported content cannot inject markup or scripts.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flushParagraph()
      flushList()
    } else if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1]!.length
      const content = inline(heading[2]!)
      blocks.push(level <= 2 ? <h3 key={blocks.length}>{content}</h3> : <h4 key={blocks.length}>{content}</h4>)
    } else if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)![1]!)
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushList()

  return (
    <div className="space-y-3 text-sm leading-relaxed [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      {blocks}
    </div>
  )
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={m.index}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) out.push(<code key={m.index} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">{token.slice(1, -1)}</code>)
    else out.push(<em key={m.index}>{token.slice(1, -1)}</em>)
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
