/**
 * 表格渲染
 *
 * 与隐藏 # ** 同一套规则（设置「显示 Markdown 标记」关闭、光标不在表格里）：
 * 整张 GFM 表格换成一个带边框的 HTML 表格；光标进到表格的任何一行，整张表变回源码。
 * 磁盘上的文本一字不差，只是显示换了。
 *
 * - 跨行替换只能由 StateField 提供（ViewPlugin 不允许），所以这里用 StateField；
 * - 只认文档顶层的表格：引用、列表里的表格前面有 `> ` 或缩进，整行替换会把它们一起藏掉；
 * - 单元格里的粗体、斜体、删除线、行内代码、链接文字照样式显示，其余语法原样显示；
 * - 内容一律用 textContent 写进 DOM，不拼 HTML；
 * - 点单元格：光标落到那一格源码的末尾，表格随即变回源码；
 * - ↑↓ 不会跨过渲染好的表格，而是走进它的首行 / 末行（否则键盘进不去表格）；
 * - 每次击键只重建改动碰到的表格，其余沿用上一次的结果；超过 MAX_RENDERED_ROWS 行的表格保持源码。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, Prec, StateField, type ChangeDesc, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import { isPerformanceMode } from './performance'
import { concealMarkupFacet, cursorEngagedField } from './styledSource'

export type TableAlign = 'left' | 'center' | 'right' | null

export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'bold' | 'italic' | 'strike' | 'link'; children: InlinePiece[] }
  | { kind: 'code'; text: string }

export interface TableCellModel {
  /** 点这一格时光标落到的位置（相对表格首行行首） */
  offset: number
  content: InlinePiece[]
}

export interface TableModel {
  align: TableAlign[]
  header: TableCellModel[]
  rows: TableCellModel[][]
}

export interface TableBlock {
  /** 首行行首 */
  from: number
  /** 末行行尾 */
  to: number
  model: TableModel
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child)
  return out
}

/** 分隔行 `|:---|---:|:---:|` → 每列的对齐方式 */
export function parseAlignments(delimiterRow: string): TableAlign[] {
  const segments = delimiterRow.trim().split('|')
  if (segments[0]?.trim() === '') segments.shift()
  if (segments.length > 0 && segments[segments.length - 1]?.trim() === '') segments.pop()
  return segments.map((segment) => {
    const spec = segment.trim()
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

const WRAPPERS: Record<string, { kind: 'bold' | 'italic' | 'strike'; mark: string }> = {
  StrongEmphasis: { kind: 'bold', mark: 'EmphasisMark' },
  Emphasis: { kind: 'italic', mark: 'EmphasisMark' },
  Strikethrough: { kind: 'strike', mark: 'StrikethroughMark' },
}

/** [from, to) 内的行内内容：子节点之间的空隙是纯文本，已知的行内语法换成对应样式 */
function inlinePieces(state: EditorState, parent: SyntaxNode, from: number, to: number): InlinePiece[] {
  const pieces: InlinePiece[] = []
  const pushText = (start: number, end: number) => {
    if (end <= start) return
    const text = state.doc.sliceString(start, end)
    const last = pieces[pieces.length - 1]
    if (last?.kind === 'text') last.text += text
    else pieces.push({ kind: 'text', text })
  }

  let pos = from
  for (const child of childrenOf(parent)) {
    if (child.to <= from || child.from >= to) continue
    pushText(pos, child.from)
    pos = child.to
    const marks = childrenOf(child)
    const wrapper = WRAPPERS[child.name]
    if (wrapper) {
      const open = marks[0]
      const close = marks[marks.length - 1]
      if (open?.name === wrapper.mark && close?.name === wrapper.mark && open !== close) {
        pieces.push({ kind: wrapper.kind, children: inlinePieces(state, child, open.to, close.from) })
        continue
      }
    } else if (child.name === 'InlineCode') {
      const open = marks[0]
      const close = marks[marks.length - 1]
      if (open?.name === 'CodeMark' && close?.name === 'CodeMark' && open !== close) {
        pieces.push({ kind: 'code', text: state.doc.sliceString(open.to, close.from).trim() })
        continue
      }
    } else if (child.name === 'Link' && marks.some((mark) => mark.name === 'URL' || mark.name === 'LinkLabel')) {
      // 只认带地址或 [label] 的链接：单独的 [x]（勾选列）语法树也算 Link，要原样显示
      const linkMarks = marks.filter((mark) => mark.name === 'LinkMark')
      const open = linkMarks[0]
      const close = linkMarks.find((mark) => state.doc.sliceString(mark.from, mark.to) === ']')
      if (open && close && close.from >= open.to) {
        pieces.push({ kind: 'link', children: inlinePieces(state, child, open.to, close.from) })
        continue
      }
    } else if (child.name === 'Escape') {
      pushText(child.from + 1, child.to)
      continue
    }
    // 其余语法（图片、HTML、自动链接等）原样显示源码
    pushText(child.from, child.to)
  }
  pushText(pos, to)
  return pieces
}

/** 一行（表头或数据行）按 | 切成单元格，补齐 / 截断到 columns 列 */
function rowCells(state: EditorState, row: SyntaxNode, tableFrom: number, columns: number): TableCellModel[] {
  const children = childrenOf(row)
  const segments: { start: number; cell: SyntaxNode | null }[] = []
  let current: { start: number; cell: SyntaxNode | null } = { start: row.from, cell: null }
  for (const child of children) {
    if (child.name === 'TableDelimiter') {
      segments.push(current)
      current = { start: child.to, cell: null }
    } else if (child.name === 'TableCell') {
      current.cell = child
    }
  }
  segments.push(current)
  // 行首、行尾的 | 外面没有单元格
  if (children[0]?.name === 'TableDelimiter') segments.shift()
  if (children[children.length - 1]?.name === 'TableDelimiter') segments.pop()

  const cells: TableCellModel[] = []
  for (let index = 0; index < columns; index++) {
    const segment = segments[index]
    if (!segment) {
      cells.push({ offset: row.to - tableFrom, content: [] })
      continue
    }
    const { cell } = segment
    cells.push({
      offset: (cell ? cell.to : segment.start) - tableFrom,
      content: cell ? inlinePieces(state, cell, cell.from, cell.to) : [],
    })
  }
  return cells
}

/** 再长的表格不渲染：整张表是一个不虚拟化的 DOM，光标每次离开都要重画 */
export const MAX_RENDERED_ROWS = 1000

export function tableModel(state: EditorState, table: SyntaxNode, tableFrom: number): TableModel | null {
  const children = childrenOf(table)
  const header = children.find((child) => child.name === 'TableHeader')
  const delimiter = children.find((child) => child.name === 'TableDelimiter')
  if (!header || !delimiter) return null
  if (children.filter((child) => child.name === 'TableRow').length > MAX_RENDERED_ROWS) return null
  const align = parseAlignments(state.doc.sliceString(delimiter.from, delimiter.to))
  if (align.length === 0) return null
  return {
    align,
    header: rowCells(state, header, tableFrom, align.length),
    rows: children
      .filter((child) => child.name === 'TableRow')
      .map((row) => rowCells(state, row, tableFrom, align.length)),
  }
}

/**
 * 文档顶层的表格（语法树已解析到的部分）。
 * 给了上一次的结果和这次的改动时：改动没碰到的表格（映射后首尾位置不变）直接沿用 model，
 * 只重建被改的那张 —— 长文里每次击键不必把所有表格重新拆一遍
 */
export function findTables(
  state: EditorState,
  previous?: { tables: TableBlock[]; changes: ChangeDesc },
): TableBlock[] {
  const reusable = new Map<string, TableModel>()
  if (previous) {
    for (const table of previous.tables) {
      if (previous.changes.touchesRange(table.from, table.to)) continue
      const from = previous.changes.mapPos(table.from)
      const to = previous.changes.mapPos(table.to)
      reusable.set(`${from}:${to}`, table.model)
    }
  }
  const tables: TableBlock[] = []
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'Table') continue
    const from = state.doc.lineAt(node.from).from
    const to = state.doc.lineAt(node.to).to
    const model = reusable.get(`${from}:${to}`) ?? tableModel(state, node, from)
    if (model) tables.push({ from, to, model })
  }
  return tables
}

function renderPieces(pieces: InlinePiece[], parent: HTMLElement): void {
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      parent.appendChild(document.createTextNode(piece.text))
      continue
    }
    const span = document.createElement('span')
    if (piece.kind === 'code') {
      span.className = 'cm-md-code'
      span.textContent = piece.text
    } else {
      span.className = {
        bold: 'cm-md-bold',
        italic: 'cm-md-italic',
        strike: 'cm-md-strike',
        link: 'cm-md-link-text',
      }[piece.kind]
      renderPieces(piece.children, span)
    }
    parent.appendChild(span)
  }
}

class TableWidget extends WidgetType {
  /** 单元格位置相对表格首行，表格整体挪动时 model 照样可用 */
  constructor(readonly model: TableModel) {
    super()
  }

  /** 表格没被改过时 model 是同一个对象（findTables 沿用），DOM 不必重画 */
  eq(other: TableWidget): boolean {
    return other.model === this.model
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-ink-table'
    const table = document.createElement('table')

    const addRow = (section: HTMLElement, cells: TableCellModel[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr')
      cells.forEach((cell, index) => {
        const element = document.createElement(tag)
        element.dataset.offset = String(cell.offset)
        const align = this.model.align[index]
        if (align) element.style.textAlign = align
        renderPieces(cell.content, element)
        tr.appendChild(element)
      })
      section.appendChild(tr)
    }

    const head = document.createElement('thead')
    addRow(head, this.model.header, 'th')
    table.appendChild(head)
    if (this.model.rows.length > 0) {
      const body = document.createElement('tbody')
      for (const row of this.model.rows) addRow(body, row, 'td')
      table.appendChild(body)
    }
    wrap.appendChild(table)

    // 点哪一格，光标就落到那一格源码的末尾（表格随之变回源码）
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      // 点在单元格外（表格太宽时的横向滚动条、表格下方的留白）：交给浏览器，滚动条照常能拖
      const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-offset]')
      if (!cell) return
      event.preventDefault()
      const offset = Number(cell.dataset.offset)
      const pos = Math.min(view.posAtDOM(wrap) + offset, view.state.doc.length)
      view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' })
      view.focus()
    })
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }

  get estimatedHeight(): number {
    return (this.model.rows.length + 1) * 36 + 20
  }
}

interface TableState {
  tables: TableBlock[]
  decorations: DecorationSet
}

/** 光标（或选区）碰到的表格显示源码，其余换成渲染好的表格 */
function tableDecorations(state: EditorState, tables: TableBlock[]): DecorationSet {
  if (tables.length === 0 || !state.facet(concealMarkupFacet)) return Decoration.none
  // 刚打开文档、用户还没动过光标：光标停在开头不算在编辑表格（同 styledSource）
  const engaged = state.field(cursorEngagedField, false) ?? true
  const ranges: Range<Decoration>[] = []
  for (const table of tables) {
    const touched =
      engaged && state.selection.ranges.some((range) => range.from <= table.to && range.to >= table.from)
    if (touched) continue
    ranges.push(
      Decoration.replace({
        widget: new TableWidget(table.model),
        block: true,
      }).range(table.from, table.to),
    )
  }
  return Decoration.set(ranges)
}

function build(state: EditorState, previous?: { tables: TableBlock[]; changes: ChangeDesc }): TableState {
  const tables = isPerformanceMode(state.doc.length) ? [] : findTables(state, previous)
  return { tables, decorations: tableDecorations(state, tables) }
}

export const tablesField = StateField.define<TableState>({
  create: (state) => build(state),
  update(value, tr) {
    // 文本变了，或后台解析推进了（长文的表格可能刚解析到）：重新找表格，没被改的沿用
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return build(tr.state, { tables: value.tables, changes: tr.changes })
    }
    const engagedChanged =
      tr.state.field(cursorEngagedField, false) !== tr.startState.field(cursorEngagedField, false)
    if (tr.selection || tr.reconfigured || engagedChanged) {
      return { tables: value.tables, decorations: tableDecorations(tr.state, value.tables) }
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

/**
 * 单光标 ↑↓ 会整块跳过替换掉的表格：跳过时改落到表格的首行（向下）/ 末行（向上），
 * 尽量保持所在列。返回 null 表示这次移动没跨过表格，交给默认键位
 */
export function moveIntoTable(state: EditorState, head: number, target: number, forward: boolean): number | null {
  const crossed = state.field(tablesField, false)?.tables.find((table) =>
    forward ? head < table.from && target > table.to : head > table.to && target < table.from,
  )
  if (!crossed) return null
  const column = head - state.doc.lineAt(head).from
  const line = state.doc.lineAt(forward ? crossed.from : crossed.to)
  return Math.min(line.from + column, line.to)
}

function arrow(forward: boolean) {
  return (view: EditorView): boolean => {
    const { selection } = view.state
    if (selection.ranges.length > 1 || !selection.main.empty) return false
    const target = view.moveVertically(selection.main, forward)
    const pos = moveIntoTable(view.state, selection.main.head, target.head, forward)
    if (pos === null) return false
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

export const inkTableKeymap = Prec.high(
  keymap.of([
    { key: 'ArrowDown', run: arrow(true) },
    { key: 'ArrowUp', run: arrow(false) },
  ]),
)
