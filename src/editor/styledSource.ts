/**
 * 样式化源码插件（spec §2 / R1）
 *
 * 原则：语法符号只弱化不删改；标题、加粗等做视觉增强。文本与磁盘文件一字不差。
 *
 * 标记隐藏（设置「显示 Markdown 标记」关闭时，默认）：光标不在的行隐藏
 * 标题的 # 、粗斜体的 * _、删除线的 ~~、行内代码的反引号、行内链接的 [ ](url)、转义的 \；
 * 光标所在行（含选区覆盖的行）照常显示全部标记，编辑时看到的仍是源码。
 * 列表、引用、图片、引用式链接、表格的标记不隐藏（只弱化）。
 *
 * 块级样式：遍历 syntaxTree(view.state) 的可见区间（view.visibleRanges）
 * 行内样式：同一插件对可见区间内的行内节点产出 Decoration.mark
 * 只计算可见区间 ±200 行，禁止全文档 decoration
 */
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import {
  Compartment,
  Facet,
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Range,
} from '@codemirror/state'
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

/** 是否隐藏光标外的标记（= 设置里「显示 Markdown 标记」关闭） */
export const concealMarkupFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[values.length - 1] ?? false,
})

/** 设置切换时重配 concealMarkupFacet，不重建 EditorView */
export const concealCompartment = new Compartment()

/**
 * 用户是否已经动过光标（点击、方向键、输入）。
 * 刚打开文档时光标默认停在第一行（多半是 H1），这不代表用户在编辑这一行，
 * 标记照常隐藏；用户第一次操作之后，光标所在行才显示标记。打开新文档会重建 EditorState，随之复位。
 */
export const cursorEngagedField = StateField.define<boolean>({
  create: () => false,
  update: (engaged, tr) => engaged || tr.annotation(Transaction.userEvent) !== undefined,
})

/** 选区覆盖的行（这些行显示全部标记） */
function selectionLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let line = first; line <= last; line++) lines.add(line)
  }
  return lines
}

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

  /**
   * 外悬标记的定宽盒：「- 」「## 」这类标记的实际字宽和 Nch 对不上（- 和空格都比 0 窄），
   * 只靠 text-indent:-Nch 会让后面的文字偏离左边缘；把标记连同空格放进正好 Nch 宽的盒子，
   * 文字就精确落在 text-indent 抵消之后的位置
   */
  const addHangBox = (from: number, to: number, widthCh: number) => {
    if (to <= from) return
    builder.marks.push(
      Decoration.mark({ class: 'cm-md-hang', attributes: { style: `width:${widthCh}ch` } }).range(from, to),
    )
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

  // 没装 cursorEngagedField（单测）时按「已操作」处理
  const engaged = state.field(cursorEngagedField, false) ?? true
  const activeLines = state.facet(concealMarkupFacet)
    ? engaged
      ? selectionLines(state)
      : new Set<number>()
    : null
  const conceal = (from: number, to: number) => {
    if (!activeLines || to <= from) return
    const line = state.doc.lineAt(from).number
    // ViewPlugin 的装饰不能替换换行（跨行的链接等保持原样）
    if (activeLines.has(line) || state.doc.lineAt(to).number !== line) return
    builder.marks.push(Decoration.replace({}).range(from, to))
  }

  /** 链接 / 图片的文字：[ 与 ] 之间（不含后面的 (url) 或 [label]） */
  const linkText = (node: SyntaxNode): { open: SyntaxNode; close: SyntaxNode } | null => {
    const marks = childrenOf(node).filter((child) => child.name === 'LinkMark')
    const open = marks[0]
    const close = marks.find((mark) => state.doc.sliceString(mark.from, mark.to) === ']')
    return open && close && close.from >= open.to ? { open, close } : null
  }

  /** ATX 标题的 # ：开头的连同后面的空格、结尾的连同前面的空格一起隐藏 */
  const concealHeaderMark = (mark: SyntaxNode) => {
    const heading = mark.parent
    if (!heading || !heading.name.startsWith('ATXHeading')) return
    const content = contentBetweenMarkers(heading)
    const text = state.doc.sliceString(heading.from, heading.to)
    if (!/^\s*#{1,6}\s+\S/.test(text)) return
    const line = state.doc.lineAt(mark.from)
    if (heading.firstChild?.from === mark.from) {
      let end = mark.to
      while (end < line.to && /\s/.test(state.doc.sliceString(end, end + 1))) end++
      conceal(mark.from, end)
    } else if (content) {
      let start = mark.from
      while (start > line.from && /\s/.test(state.doc.sliceString(start - 1, start))) start--
      conceal(start, mark.to)
    }
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
          // 任务项的文字是 Task 节点而不是 Paragraph：同样给段间距，任务列表与普通列表疏密一致
          case 'Paragraph':
          case 'Task': {
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
            // Setext 标题的下划线（=== / ---）单独成行，不按标题字号放大
            const underline = name.startsWith('Setext') ? children.find((c) => c.name === 'HeaderMark') : null
            if (underline && state.doc.lineAt(underline.from).number > state.doc.lineAt(node.from).number) {
              addLineRangeClass(node.from, state.doc.lineAt(underline.from).from - 1, HEADING_CLASS[name]!)
            } else {
              addLineRangeClass(node.from, node.to, HEADING_CLASS[name]!)
            }
            // 标题文字用 accent 色（效果图：# Hello World 整体蓝色），
            // 内容区间 = 首个标记之后 ~ 末尾标记之前
            const content = contentBetweenMarkers(node)
            if (content) addMark(content.from, content.to, 'cm-md-heading-text')
            // ATX 标题的「# 」可见时（光标所在行，或关闭了隐藏标记）外悬到左边距：
            // 标题文字始终落在正文左边缘，光标进出这一行时不会左右跳
            const openMark = children[0]
            const headingLine = state.doc.lineAt(node.from)
            const marksVisible = !activeLines || activeLines.has(headingLine.number)
            if (
              name.startsWith('ATX') &&
              marksVisible &&
              openMark?.name === 'HeaderMark' &&
              openMark.from === headingLine.from &&
              !builder.lineStyles.has(headingLine.number)
            ) {
              let end = openMark.to
              while (end < headingLine.to && /\s/.test(state.doc.sliceString(end, end + 1))) end++
              if (end > openMark.to) {
                builder.lineStyles.set(headingLine.number, `text-indent:-${end - headingLine.from}ch`)
                addHangBox(headingLine.from, end, end - headingLine.from)
              }
            }
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
            if (name === 'HeaderMark') concealHeaderMark(node)
            else if (name === 'EmphasisMark' || name === 'StrikethroughMark') conceal(node.from, node.to)
            else if (name === 'CodeMark' && node.parent?.name === 'InlineCode') conceal(node.from, node.to)
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
            // 嵌套靠源码里的前导空格表达：衬线体的空格很窄，两个空格几乎看不出层级，
            // 所以把前导空格加宽（cm-md-list-lead），每个约 0.6em；
            // 标记外悬：「- 」「1. 」挂到左边距里，列表文字与正文段落同一条左边缘；
            // 折行后的文字仍与列表文字对齐（padding-left 只算前导空格，不算标记）
            const mark = children.find((c) => c.name === 'ListMark')
            if (mark) {
              const line = state.doc.lineAt(node.from)
              if (line.from > mark.from) break
              const prefix = line.text.slice(0, mark.from - line.from)
              let spaces = 0
              let others = 0
              for (const ch of prefix) {
                if (ch === ' ') spaces += 1
                else if (ch === '\t') spaces += 4
                else others += 1
              }
              for (const run of prefix.matchAll(/[ \t]+/g)) {
                addMark(line.from + run.index, line.from + run.index + run[0].length, 'cm-md-list-lead')
              }
              const markWidth = state.doc.sliceString(mark.from, mark.to).length + 1
              const lead = `${(spaces * LIST_LEAD_SPACE_EM).toFixed(2)}em + ${others}ch`
              const hang = `${lead} + ${markWidth}ch`
              // 引用里的列表：行内 style 会盖掉 .cm-md-quote 的左内边距，这里补回来
              const quote = hasAncestor(node, 'Blockquote') ? `${QUOTE_PADDING_PX}px + ` : ''
              builder.lineStyles.set(
                line.number,
                `padding-left:calc(${quote}${lead});text-indent:calc(-1 * (${hang}))`,
              )
              addMark(mark.from, mark.to, 'cm-md-mark')
              if (state.doc.sliceString(mark.to, mark.to + 1) === ' ') addHangBox(mark.from, mark.to + 1, markWidth)
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
            const text = linkText(node)
            if (!text) break
            addMark(text.open.to, text.close.from, 'cm-md-link-text')
            // 行内链接 [文字](url)：光标外只留下划线的文字；图片与引用式链接保持原样
            if (name === 'Link' && children.some((child) => child.name === 'URL')) {
              conceal(text.open.from, text.open.to)
              conceal(text.close.from, node.to)
            }
            break
          }
          case 'Escape': {
            // \* → 光标外只显示 *
            conceal(node.from, node.from + 1)
            break
          }
          case 'TaskMarker': {
            // 任务框可点（tasks.ts 按 cm-md-task-marker 认）；已完成的 [x] 后面的文字变淡加删除线
            addMark(node.from, node.to, 'cm-md-mark')
            addMark(node.from, node.to, 'cm-md-task-marker')
            const task = node.parent
            if (task?.name === 'Task' && /[xX]/.test(state.doc.sliceString(node.from + 1, node.to - 1))) {
              addMark(node.to, task.to, 'cm-md-task-done')
            }
            break
          }
          case 'TableDelimiter':
          case 'HTMLTag':
          case 'HTMLBlock':
          case 'CommentBlock':
          case 'Comment': {
            addMark(node.from, node.to, 'cm-md-mark')
            break
          }
          case 'TableHeader': {
            for (const cell of children) {
              if (cell.name === 'TableCell') addMark(cell.from, cell.to, 'cm-md-bold')
            }
            break
          }
          case 'CodeBlock': {
            // 缩进代码块：与围栏代码块同样的底色
            addLineRangeClass(node.from, node.to, 'cm-md-codeblock')
            addLineClass(state.doc.lineAt(node.from).number, 'cm-md-codeblock-start')
            addLineClass(state.doc.lineAt(node.to).number, 'cm-md-codeblock-end')
            break
          }
          case 'URL': {
            addMark(node.from, node.to, 'cm-md-url')
            break
          }
          case 'HorizontalRule': {
            // 横线画在整行上（贯穿正文栏），--- 本身透明
            addMark(node.from, node.to, 'cm-md-hr')
            addLineClass(state.doc.lineAt(node.from).number, 'cm-md-hr-line')
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

/** 列表前导空格加宽后的宽度（衬线体空格约 0.25em + letter-spacing 0.35em） */
const LIST_LEAD_SPACE_EM = 0.6
/** 与 theme.ts 的 .cm-md-quote paddingLeft 一致 */
const QUOTE_PADDING_PX = 16

function hasAncestor(node: SyntaxNode, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true
  }
  return false
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
        (update.selectionSet && selectionCrossedLine(update)) ||
        update.startState.facet(concealMarkupFacet) !== update.state.facet(concealMarkupFacet) ||
        update.startState.field(cursorEngagedField, false) !== update.state.field(cursorEngagedField, false)
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
