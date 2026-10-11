import { describe, expect, it } from 'vitest'
import { applyMatrix, invertMatrix, viewportMatrix } from './coords'

const letter: [number, number, number, number] = [0, 0, 612, 792]

describe('PDF coordinate transforms', () => {
  it('maps user space to viewport with a y flip at rotation 0', () => {
    const m = viewportMatrix(letter, 1, 0)
    expect(applyMatrix(m, 0, 792)).toEqual([0, 0]) // top-left
    expect(applyMatrix(m, 612, 0)).toEqual([612, 792]) // bottom-right
  })

  it('round-trips through the inverse at any zoom and rotation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const scale of [0.5, 1, 1.75, 3]) {
        const m = viewportMatrix(letter, scale, rotation)
        const inv = invertMatrix(m)
        const [vx, vy] = applyMatrix(m, 123.4, 567.8)
        const [x, y] = applyMatrix(inv, vx, vy)
        expect(x).toBeCloseTo(123.4, 6)
        expect(y).toBeCloseTo(567.8, 6)
      }
    }
  })

  it('keeps a stored annotation on the same page feature after zoom changes', () => {
    // A highlight stored in user space must land on proportionally the same screen spot.
    const point: [number, number] = [306, 396] // page centre
    const at1 = applyMatrix(viewportMatrix(letter, 1, 0), ...point)
    const at2 = applyMatrix(viewportMatrix(letter, 2, 0), ...point)
    expect(at2[0]).toBeCloseTo(at1[0] * 2)
    expect(at2[1]).toBeCloseTo(at1[1] * 2)
  })

  it('rotates 90 degrees clockwise: the top-left corner moves to the top-right', () => {
    const m = viewportMatrix(letter, 1, 90)
    const [x, y] = applyMatrix(m, 0, 792)
    expect(x).toBeCloseTo(792)
    expect(y).toBeCloseTo(0)
  })

  it('handles view boxes that do not start at the origin', () => {
    const m = viewportMatrix([50, 50, 662, 842], 1, 0)
    expect(applyMatrix(m, 50, 842)).toEqual([0, 0])
  })
})
