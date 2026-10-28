import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { concealMarkupFacet, cursorEngagedField } from './styledSource'
import { MAX_RENDERED_ROWS, findTables, moveIntoTable, parseAlignments, tablesField, type InlinePiece } from './tables'

function create(doc: string, options: { conceal?: boolean; cursor?: number } = {}) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(options.cursor ?? 0),
    extensions: [
      markdown({ base: markdownLanguage }),
      concealMarkupFacet.of(options.conceal ?? true),
      cursorEngagedField,
      tablesField,
    ],
  })
}

/** 渲染成表格的区间 */
function rendered(state: EditorState): [number, number][] {
  const out: [number, number][] = []
  state.field(tablesField).decorations.between(0, state.doc.length, (from, to) => {
    out.push([from, to])
  })
  return out
}

/** 单元格内容 → 便于断言的字符串：**b** → <bold>b</bold> */
function flat(pieces: InlinePiece[]): string {
  return pieces
    .map((piece) => {
      if (piece.kind === 'text') return piece.text
      if (piece.kind === 'code') return `<code>${piece.text}</code>`
      return `<${piece.kind}>${flat(piece.children)}</${piece.kind}>`
    })
    .join('')
}

const TABLE = '| 字段 | 值 |\n|---|---|\n| Project | RTC |\n| Labels | 无 |'

describe('parseAlignments', () => {
  it('reads colons on each column', () => {
    expect(parseAlignments('|:---|---:|:---:|---|')).toEqual(['left', 'right', 'center', null])
    expect(parseAlignments('--- | :-:')).toEqual([null, 'center'])
  })
})

describe('findTables', () => {
  it('splits rows into cells and keeps inline styling', () => {
    const doc = 'intro\n\n| a | **b** | |\n|:---|---:|---|\n| `x` \\| y | [link](u) | ~~z~~ |\n| only |\n\nafter'
    const [table] = findTables(create(doc))
    expect(table).toBeDefined()
    expect(doc.slice(table!.from, table!.to)).toBe(doc.slice(7, doc.indexOf('\n\nafter')))
    expect(table!.model.align).toEqual(['left', 'right', null])
    expect(table!.model.header.map((cell) => flat(cell.content))).toEqual(['a', '<bold>b</bold>', ''])
    expect(table!.model.rows.map((row) => row.map((cell) => flat(cell.content)))).toEqual([
      ['<code>x</code> | y', '<link>link</link>', '<strike>z</strike>'],
      ['only', '', ''],
    ])
  })

  it('places each cell offset at the end of its source text', () => {
    const state = create(TABLE)
    const [table] = findTables(state)
    const valueCell = table!.model.rows[0]![1]!
    expect(state.doc.sliceString(0, table!.from + valueCell.offset).endsWith('| Project | RTC')).toBe(true)
  })

  it('keeps brackets of [x] check marks that are not links', () => {
    const [table] = findTables(create('| 完成 | 项 |\n|---|---|\n| [x] | [链接](u) |'))
    expect(table!.model.rows[0]!.map((cell) => flat(cell.content))).toEqual(['[x]', '<link>链接</link>'])
  })

  it('leaves very long tables as source', () => {
    const rows = Array.from({ length: MAX_RENDERED_ROWS + 1 }, (_, i) => `| ${i} | x |`).join('\n')
    expect(findTables(create(`| a | b |\n|---|---|\n${rows}`))).toEqual([])
  })

  it('ignores tables nested in block quotes', () => {
    expect(findTables(create('> | a | b |\n> |---|---|\n> | 1 | 2 |'))).toEqual([])
  })
})

describe('tablesField', () => {
  it('renders the whole table as one block outside the cursor', () => {
    const state = create(`text\n\n${TABLE}`)
    expect(rendered(state)).toEqual([[6, state.doc.length]])
  })

  it('shows source once the cursor moves into the table', () => {
    let state = create(`text\n\n${TABLE}`)
    state = state.update({ selection: { anchor: state.doc.length }, userEvent: 'select' }).state
    expect(rendered(state)).toEqual([])
    state = state.update({ selection: { anchor: 0 }, userEvent: 'select' }).state
    expect(rendered(state)).toEqual([[6, state.doc.length]])
  })

  it('keeps rendering while the cursor has not been moved yet', () => {
    expect(rendered(create(TABLE))).toEqual([[0, TABLE.length]])
  })

  it('shows source when markup is set to visible', () => {
    expect(rendered(create(`text\n\n${TABLE}`, { conceal: false }))).toEqual([])
  })

  it('picks up a table typed into the document', () => {
    let state = create('text\n\n')
    state = state.update({ changes: { from: state.doc.length, insert: TABLE }, selection: { anchor: 0 } }).state
    expect(rendered(state)).toEqual([[6, state.doc.length]])
  })
})

describe('table model reuse', () => {
  const doc = `段落\n\n${TABLE}\n\n结尾`

  it('keeps the model of a table the edit did not touch', () => {
    const state = create(doc)
    const before = state.field(tablesField).tables[0]!.model
    const typed = state.update({ changes: { from: 1, insert: '加字' } }).state
    const after = typed.field(tablesField).tables[0]!
    expect(after.model).toBe(before)
    expect(after.from).toBe(doc.indexOf('|') + 2)
  })

  it('rebuilds the table that was edited', () => {
    const state = create(doc)
    const before = state.field(tablesField).tables[0]!.model
    const pos = doc.indexOf('RTC') + 3
    const typed = state.update({ changes: { from: pos, insert: '-1' } }).state
    const after = typed.field(tablesField).tables[0]!.model
    expect(after).not.toBe(before)
    expect(flat(after.rows[0]![1]!.content)).toBe('RTC-1')
  })
})

describe('moveIntoTable', () => {
  const doc = `above\n\n${TABLE}\n\nbelow`
  const tableFrom = 'above\n\n'.length
  const tableTo = tableFrom + TABLE.length

  it('lands on the first table line instead of jumping over it downward', () => {
    const state = create(doc, { cursor: 2 })
    expect(moveIntoTable(state, 2, tableTo + 4, true)).toBe(tableFrom + 2)
  })

  it('lands on the last table line moving upward', () => {
    const state = create(doc, { cursor: tableTo + 4 })
    const lastLine = state.doc.lineAt(tableTo)
    expect(moveIntoTable(state, tableTo + 4, 2, false)).toBe(lastLine.from + 2)
  })

  it('leaves moves that do not cross a table alone', () => {
    const state = create(doc, { cursor: 2 })
    expect(moveIntoTable(state, 2, tableFrom + 1, true)).toBeNull()
  })
})
