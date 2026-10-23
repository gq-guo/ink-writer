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
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** 可见区间外扩的行数（spec §18.2） */
const PAD_LINES = 200

/**
 * 「临时空行」：刚按回车产生、光标还停在上面的空行（值为行首位置）。
 *
 * Markdown 里段落中间多出一个空行，就把这段拆成了两段 —— 段间距随之出现；
 * 一打字两段又合并，间距消失，下面的行会跳一下。用户刚按回车时其实是在「换行写下一句」，
 * 所以这一行在光标离开之前不算段落分隔、不加段间距。
 * 光标离开或这一行有了内容，就不再是临时空行（连按两次回车 = 开始新段落，间距照常出现）。
 */
export const transientBlankLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    const line = tr.state.doc.lineAt(tr.state.selection.main.head)
    if (line.text.trim() !== '') return null

    if (tr.docChanged && tr.isUserEvent('input')) {
      let insertedNewline = false
      tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (inserted.toString().includes('\n')) insertedNewline = true
      })
      if (insertedNewline) return line.from
    }

    if (value === null) return null
    const mapped = tr.docChanged ? tr.changes.mapPos(value) : value
    // 光标离开了这一行
    return tr.state.doc.lineAt(mapped).from === line.from ? line.from : null
  },
})

/** 插件在 update 之外重建了装饰（解析延迟），用一个空事务让 CM6 重新读取 */
const refreshStyledSourceEffect = StateEffect.define<null>()

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
            const target = paragraphSpacingLine(state, node.to)
            if (target !== null) addLineClass(target, 'cm-md-para')
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

  // 临时空行自成一段时（上下都不挨着段落，比如连按两次回车）：打字后它会是一个新段落，
  // 提前按新段落给它留好下方的段间距，打字前后布局一致
  const transient = state.field(transientBlankLineField, false) ?? null
  if (transient !== null && visibleRanges.some((r) => transient >= r.from && transient <= r.to)) {
    const line = state.doc.lineAt(transient)
    const joinsAbove = line.number > 1 && isParagraphLine(state, line.number - 1)
    const joinsBelow = line.number < state.doc.lines && isParagraphLine(state, line.number + 1)
    if (!joinsAbove && !joinsBelow) {
      const target = paragraphSpacingLine(state, line.to)
      if (target !== null) addLineClass(target, 'cm-md-para')
    }
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

/**
 * 段间距放在哪一行（返回行号；null = 这一段之后暂不加间距）。
 *
 * 段间距不能加在段落内部的行上（换行段落会被撑开），放在段落之后：
 * - 段落后紧跟空行（Markdown 的段落分隔）→ 加在第一个「非临时」空行上；
 * - 后面只有临时空行（刚按回车、还没打字）→ 不加，打字后它并入本段，位置不变；
 * - 后面没有空行（文末 / 紧挨下一个块）→ 加在段落最后一行。
 * 若总加在段落最后一行：段末按回车后光标会停在间距下方，一打字间距挪走，光标往上跳。
 */
function paragraphSpacingLine(state: EditorState, paragraphEnd: number): number | null {
  const doc = state.doc
  const lastLine = doc.lineAt(paragraphEnd)
  const transient = state.field(transientBlankLineField, false) ?? null
  let sawTransient = false
  for (let number = lastLine.number + 1; number <= doc.lines; number++) {
    const line = doc.line(number)
    if (line.text.trim() !== '') break
    if (line.from === transient) {
      sawTransient = true
      continue
    }
    return number
  }
  return sawTransient ? null : lastLine.number
}

/** 这一行是否属于某个段落（Paragraph 节点） */
function isParagraphLine(state: EditorState, lineNumber: number): boolean {
  const line = state.doc.line(lineNumber)
  if (line.text.trim() === '') return false
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + (line.text.length - line.text.trimStart().length), 1)
  while (node) {
    if (node.name === 'Paragraph') return true
    node = node.parent
  }
  return false
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
    private timer: ReturnType<typeof setTimeout> | null = null
    private destroyed = false

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
        this.rebuild(update.view)
      }
    }

    destroy() {
      this.destroyed = true
      if (this.timer) clearTimeout(this.timer)
    }

    private rebuild(view: EditorView) {
      this.decorations = buildDecorations(view.state, paddedVisibleRanges(view, PAD_LINES))
      /*
       * 增量解析是异步的：刚按 Enter 时语法树还没更新，立即重建会让
       * 新行短暂丢失「段落末行」等样式（段落间距不一致）。
       * 解析未完成时延迟一拍再建一次。
       */
      if (!syntaxTreeAvailable(view.state)) {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          if (this.destroyed) return
          this.decorations = buildDecorations(
            this.view.state,
            paddedVisibleRanges(this.view, PAD_LINES),
          )
          // 不触发一次更新的话，新装饰要等下一次按键才生效 —— 间距会在打字时才突然变化
          this.view.dispatch({ effects: refreshStyledSourceEffect.of(null) })
        }, 30)
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)
