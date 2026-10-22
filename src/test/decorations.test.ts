import { describe, expect, it } from 'vitest'
import { Decoration } from '@codemirror/view'

describe('CM6 decoration overlap', () => {
  it('allows nested mark decorations in one set', () => {
    const outer = Decoration.mark({ class: 'outer' }).range(0, 9)
    const inner = Decoration.mark({ class: 'inner' }).range(2, 7)
    expect(() => Decoration.set([outer, inner], true)).not.toThrow()
  })

  it('allows partially overlapping mark decorations', () => {
    const outer = Decoration.mark({ class: 'outer' }).range(0, 5)
    const other = Decoration.mark({ class: 'other' }).range(3, 9)
    expect(() => Decoration.set([outer, other], true)).not.toThrow()
  })

  it('allows mixing line and mark decorations', () => {
    const line = Decoration.line({ class: 'line' }).range(0)
    const mark = Decoration.mark({ class: 'mark' }).range(0, 5)
    expect(() => Decoration.set([line, mark], true)).not.toThrow()
  })
})
