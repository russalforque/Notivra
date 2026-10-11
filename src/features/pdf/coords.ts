/**
 * Affine matrices in PDF/canvas convention: [a, b, c, d, e, f] maps
 *   x' = a·x + c·y + e,  y' = b·x + d·y + f.
 *
 * Annotations are stored in PDF user space (unrotated, origin bottom-left). pdf.js gives a
 * viewport matrix (user space → CSS pixels) that already includes zoom and rotation, so
 * rendering applies that matrix and input applies its inverse. This is what keeps
 * annotations correctly positioned at every zoom level and rotation, and after reopening.
 */
export type Matrix = [number, number, number, number, number, number]

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function invertMatrix(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (det === 0) throw new Error('Matrix is not invertible')
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/**
 * Builds the same user-space → viewport matrix pdf.js computes, from a page's view box,
 * scale and rotation. Used where pdf.js isn't available (tests, export checks).
 */
export function viewportMatrix(viewBox: [number, number, number, number], scale: number, rotation: number): Matrix {
  const [x1, y1, x2, y2] = viewBox
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const r = ((rotation % 360) + 360) % 360
  let rA: number, rB: number, rC: number, rD: number
  switch (r) {
    case 90:
      ;[rA, rB, rC, rD] = [0, 1, 1, 0]
      break
    case 180:
      ;[rA, rB, rC, rD] = [-1, 0, 0, 1]
      break
    case 270:
      ;[rA, rB, rC, rD] = [0, -1, -1, 0]
      break
    default:
      ;[rA, rB, rC, rD] = [1, 0, 0, -1]
  }
  const offsetCanvasX = rA === 0 ? Math.abs(cy - y1) * scale : Math.abs(cx - x1) * scale
  const offsetCanvasY = rA === 0 ? Math.abs(cx - x1) * scale : Math.abs(cy - y1) * scale
  return [
    rA * scale,
    rB * scale,
    rC * scale,
    rD * scale,
    offsetCanvasX - rA * scale * cx - rC * scale * cy,
    offsetCanvasY - rB * scale * cx - rD * scale * cy,
  ]
}

export function toSvgMatrix(m: Matrix): string {
  return `matrix(${m.map((v) => +v.toFixed(6)).join(' ')})`
}
