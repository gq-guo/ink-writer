/**
 * 样式化源码插件（spec §2 / R1）
 *
 * 原则：语法符号始终可见，只是弱化；标题、加粗等做视觉增强。
 * 不隐藏任何字符 —— 光标在任何位置，看到的文本与磁盘文件一字不差。
 *
 * 块级样式：遍历 syntaxTree(view.state) 的可见区间（view.visibleRanges）
 * 行内样式：同一插件对可见区间内的行内节点产出 Decoration.mark
 * 只计算可见区间 ±200 行，禁止全文档 decoration
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** 可见区间外扩的行数（spec §18.2） */
const PAD_LINES = 200

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1',
  SetextHeading2: 'cm-md-h2',
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  let child = node.firstChild
  while (child) {
    out.push(child)
    child = child.nextSibling
  }
  return out
}

/** 取得「标记之间」的内容区间（粗体 / 斜体 / 删除线 / 行内代码 / 链接文本） */
function contentBetweenMarkers(node: SyntaxNode): { from: number; to: number } | null {
  const children = childrenOf(node)
  if (children.length < 2) return null
  const first = children[0]!
  const last = children[children.length - 1]!
  if (first.from >= last.from) return null
  return { from: first.to, to: last.from }
}

interface Builder {
  marks: Range<Decoration>[]
  lines: Map<number, Set<string>>
  lineStyles: Map<number, string>
}

export function buildDecorations(
  state: EditorState,
  visibleRanges: { from: number; to: number }[],
): DecorationSet {
  const builder: Builder = { marks: [], lines: new Map(), lineStyles: new Map() }

  const addMark = (from: number, to: number, cls: string) => {
    if (to <= from) return
    builder.marks.push(Decoration.mark({ class: cls }).range(from, to))
  }

  const addLineClass = (lineNumber: number, cls: string) => {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return
    let set = builder.lines.get(lineNumber)
    if (!set) {
      set = new Set()
      builder.lines.set(lineNumber, set)
    }
    set.add(cls)
  }

  const addLineRangeClass = (from: number, to: number, cls: string) => {
    const startLine = state.doc.lineAt(from).number
    const endLine = state.doc.lineAt(to).number
    for (let ln = startLine; ln <= endLine; ln++) addLineClass(ln, cls)
  }

  for (const range of visibleRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(ref) {
        const node = ref.node
        const name = node.name
        const children = childrenOf(node)

        switch (name) {
          case 'Paragraph': {
            // 段间距只加在段落的**最后一行**（避免换行段落内部被撑开）
            const lastLine = state.doc.lineAt(node.to)
            addLineClass(lastLine.number, 'cm-md-para')
            break
          }
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6':
          case 'SetextHeading1':
          case 'SetextHeading2': {
            addLineRangeClass(node.from, node.to, HEADING_CLASS[name]!)
            // 标题文字用 accent 色（效果图：# Hello World 整体蓝色），
            // 内容区间 = 首个标记之后 ~ 末尾标记之前
            const content = contentBetweenMarkers(node)
            if (content) addMark(content.from, content.to, 'cm-md-heading-text')
            break
          }
          case 'HeaderMark':
          case 'QuoteMark':
          case 'ListMark':
          case 'CodeMark':
          case 'CodeInfo':
          case 'LinkMark':
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            addMark(node.from, node.to, 'cm-md-mark')
            break
          }
          case 'StrongEmphasis': {
            const content = contentBetweenMarkers(node)
            addMark(content ? content.from : node.from, content ? content.to : node.to, 'cm-md-bold')
            break
          }
          case 'Emphasis': {
            const content = contentBetweenMarkers(node)
            addMark(content ? content.from : node.from, content ? content.to : node.to, 'cm-md-italic')
            break
          }
          case 'Strikethrough': {
            const content = contentBetweenMarkers(node)
            addMark(content ? content.from : node.from, content ? content.to : node.to, 'cm-md-strike')
            break
          }
          case 'InlineCode': {
            const content = contentBetweenMarkers(node)
            addMark(content ? content.from : node.from, content ? content.to : node.to, 'cm-md-code')
            break
          }
          case 'Blockquote': {
            addLineRangeClass(node.from, node.to, 'cm-md-quote')
            break
          }
          case 'ListItem': {
            // 悬挂缩进：以列表标记宽度对齐
            const mark = children.find((c) => c.name === 'ListMark')
            if (mark) {
              const markText = state.doc.sliceString(mark.from, mark.to)
              const width = markText.length + 1
              const depth = listDepth(node)
              const indent = depth * 2 + width
              const lineNumber = state.doc.lineAt(node.from).number
              builder.lineStyles.set(lineNumber, `padding-left:${indent}ch;text-indent:-${width}ch`)
              addMark(mark.from, mark.to, 'cm-md-mark')
            }
            break
          }
          case 'FencedCode': {
            addLineRangeClass(node.from, node.to, 'cm-md-codeblock')
            addLineClass(state.doc.lineAt(node.from).number, 'cm-md-codeblock-start')
            addLineClass(state.doc.lineAt(node.to).number, 'cm-md-codeblock-end')
            break
          }
          case 'CodeText': {
            addMark(node.from, node.to, 'cm-md-codeblock-text')
            break
          }
          case 'Link':
          case 'Image': {
            const content = contentBetweenMarkers(node)
            if (content) addMark(content.from, content.to, 'cm-md-link-text')
            break
          }
          case 'URL': {
            addMark(node.from, node.to, 'cm-md-url')
            break
          }
          case 'HorizontalRule': {
            addMark(node.from, node.to, 'cm-md-hr')
            break
          }
          default:
            break
        }
        return true
      },
    })
  }

  // 行装饰
  const lineDecorations: Range<Decoration>[] = []
  for (const [lineNumber, classes] of builder.lines) {
    const line = state.doc.line(lineNumber)
    lineDecorations.push(
      Decoration.line({ class: [...classes].join(' ') }).range(line.from),
    )
  }
  const lineStyles = builder.lineStyles
  for (const [lineNumber, style] of lineStyles) {
    const line = state.doc.line(lineNumber)
    lineDecorations.push(
      Decoration.line({ attributes: { style } }).range(line.from),
    )
  }

  return Decoration.set([...builder.marks, ...lineDecorations], true)
}

/** 列表项的嵌套深度 */
function listDepth(node: SyntaxNode): number {
  let depth = 0
  let parent = node.parent
  while (parent) {
    if (parent.name === 'ListItem') depth += 1
    parent = parent.parent
  }
  return Math.max(0, depth - 1)
}

/** 可见区间 ± pad 行 */
export function paddedVisibleRanges(
  view: EditorView,
  pad: number,
): { from: number; to: number }[] {
  const { doc } = view.state
  return view.visibleRanges.map((range) => {
    const startLine = Math.max(1, doc.lineAt(range.from).number - pad)
    const endLine = Math.min(doc.lines, doc.lineAt(range.to).number + pad)
    return { from: doc.line(startLine).from, to: doc.line(endLine).to }
  })
}

/** 光标是否跨行移动（跨行才需要重算样式） */
function selectionCrossedLine(update: ViewUpdate): boolean {
  const oldRange = update.startState.selection.main
  const newRange = update.state.selection.main
  if (oldRange.empty && newRange.empty) {
    return update.startState.doc.lineAt(oldRange.head).number !== update.state.doc.lineAt(newRange.head).number
  }
  return true
}

export const inkStyledSourcePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    view: EditorView

    constructor(view: EditorView) {
      this.view = view
      this.decorations = buildDecorations(view.state, paddedVisibleRanges(view, PAD_LINES))
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        (update.selectionSet && selectionCrossedLine(update))
      ) {
        this.decorations = buildDecorations(update.view.state, paddedVisibleRanges(update.view, PAD_LINES))
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)
