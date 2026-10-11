import { rgb, type PDFFont, type RGB } from 'pdf-lib'

// Characters outside Latin-1 that the WinAnsi encoding (used by standard PDF fonts) supports.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/**
 * Standard PDF fonts can only encode WinAnsi characters. Unsupported characters (e.g. CJK,
 * emoji) are replaced with '?' instead of making the whole export fail.
 * Documented limitation: embedding a Unicode font would fix this at the cost of file size.
 */
export function toWinAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) out += ch
    else if (ch === '\t') out += '    '
    else out += '?'
  }
  return out
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return rgb(0, 0, 0)
  return rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255)
}

/** Greedy word wrap using real font metrics. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/)
    let line = ''
    for (const word of words) {
      const candidate = line + word
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = candidate
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}
