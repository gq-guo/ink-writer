/**
 * Focus Mode（spec §9）
 *
 * 当前块 = 光标所在的最外层块级语法节点（paragraph / heading / blockquote / 整个 list …），
 * 其余块 opacity 0.35。
 *
 * 用行装饰（Decoration.line）切 class，而不是给整块文字套 mark：
 * 行元素会被 CM6 复用、只改 class，CSS 的 opacity 过渡才生效；
 * mark 的 span 在切换段落时会被删掉重建，过渡对新元素无效，表现为硬切。
 *
 * 实现说明：spec §8.2 建议用 StateField，但可见区间（view.visibleRanges）只有 View 上才有，
 * 因此这里用 ViewPlugin 承载 DecorationSet —— 行为与 spec 一致，且保证只计算可见区间 ±200 行。
 */
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

import { paddedVisibleRanges } from './styledSource'

/** 打开 / 关闭 Focus Mode */
export const setFocusModeEffect = StateEffect.define<boolean>()

/** 防抖到期后触发一次重绘（插件在 update 之外改了装饰，需要一个事务让 CM6 重新读取） */
const refreshFocusEffect = StateEffect.define<null>()

/** Focus Mode 开关状态 */
export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusModeEffect)) return effect.value
    }
    return value
  },
  // 编辑器上挂 ink-focus-on：渲染好的表格是块级 widget，行装饰的 ink-focus-dim 落不到它身上，
  // 由 CSS 按这个 class 让它变淡（光标在表格里时表格是源码，走行装饰）
  provide: (field) =>
    EditorView.editorAttributes.from(field, (on): Record<string, string> => (on ? { class: 'ink-focus-on' } : {})),
})

/** 重算防抖（spec §9.3） */
const RECOMPUTE_DEBOUNCE_MS = 100
/** 语法树还没解析到可见区：每 30ms 再算一次，最多这么多次 */
const PARSE_RETRY_MS = 30
const MAX_PARSE_RETRIES = 50

/** 取得光标所在的最外层块 */
export function topLevelBlockAt(tree: Tree, pos: number): SyntaxNode | null {
  // side = 1：优先取「从 pos 开始」的节点，否则会拿到根节点
  let node = tree.resolveInner(pos, 1)
  if (node.parent === null) {
    const before = tree.resolveInner(pos, -1)
    if (before.parent !== null) node = before
  }
  if (node.parent === null) return null
  while (node.parent && node.parent.parent) {
    node = node.parent
  }
  return node.parent?.parent === null ? node : null
}

/**
 * 当前块：光标所在的最外层块。
 * 光标在空行上时（比如段落末尾刚按了回车），空行不属于任何块：
 * 改为取紧挨着这一行的上 / 下块 —— 接着打字时内容正是并入它们，亮起的范围前后连贯；
 * 中间隔了空行（连按两次回车 = 开始新段落）则不算，只标当前空行。
 */
function activeBlocksAt(state: EditorState, tree: Tree, head: number): SyntaxNode[] {
  const block = topLevelBlockAt(tree, head)
  if (block) return [block]
  const line = state.doc.lineAt(head)
  if (line.text.trim() !== '') return []
  const neighbours: SyntaxNode[] = []
  for (const number of [line.number - 1, line.number + 1]) {
    if (number < 1 || number > state.doc.lines) continue
    const neighbour = state.doc.line(number)
    if (neighbour.text.trim() === '') continue
    const adjacent = topLevelBlockAt(tree, neighbour.from)
    if (adjacent) neighbours.push(adjacent)
  }
  return neighbours
}

/** 可见区间内的最外层块 */
function topLevelBlocksIn(tree: Tree, from: number, to: number): SyntaxNode[] {
  const blocks: SyntaxNode[] = []
  tree.iterate({
    from,
    to,
    enter(ref) {
      const node = ref.node
      // SyntaxNode 不是引用相等的对象，只能按结构判断（Document 是根节点）
      if (node.parent && node.parent.name === 'Document' && node.parent.parent === null) {
        blocks.push(node)
      }
      return true
    },
  })
  return blocks
}

/** 大文件时收窄 Focus Mode 的计算范围（spec §18.2） */
export function focusPadLines(docLength: number): number {
  return docLength > 5 * 1024 * 1024 ? 50 : 200
}

export function computeFocusDecorations(
  state: EditorState,
  visibleRanges: { from: number; to: number }[],
): DecorationSet {
  if (!state.field(focusModeField, false)) return Decoration.none

  const head = state.selection.main.head
  const tree = syntaxTree(state)
  const activeBlocks = activeBlocksAt(state, tree, head)

  // 行号 → class；同一行只取一个（块边界可能落在同一行）
  const lineClasses = new Map<number, string>()
  // 光标所在的空行不属于任何块，也标为当前块，保证光标所在行总有 ink-focus-active
  const cursorLine = state.doc.lineAt(head)
  if (cursorLine.text.trim() === '') lineClasses.set(cursorLine.number, 'ink-focus-active')

  for (const range of visibleRanges) {
    for (const block of topLevelBlocksIn(tree, range.from, range.to)) {
      const isActive = activeBlocks.some(
        (active) => block.from === active.from && block.to === active.to,
      )
      // 当前块保持原样，其余块变淡
      const cls = isActive ? 'ink-focus-active' : 'ink-focus-dim'
      const firstLine = state.doc.lineAt(block.from).number
      const lastLine = state.doc.lineAt(block.to).number
      for (let line = firstLine; line <= lastLine; line++) {
        if (lineClasses.get(line) !== 'ink-focus-active') lineClasses.set(line, cls)
      }
    }
  }

  const decorations: Range<Decoration>[] = []
  for (const [line, cls] of lineClasses) {
    decorations.push(Decoration.line({ class: cls }).range(state.doc.line(line).from))
  }
  return Decoration.set(decorations, true)
}

export const inkFocusModePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    view: EditorView
    private timer: ReturnType<typeof setTimeout> | null = null
    private parseRetries = 0

    constructor(view: EditorView) {
      this.view = view
      this.decorations = computeFocusDecorations(
        view.state,
        paddedVisibleRanges(view, focusPadLines(view.state.doc.length)),
      )
    }

    update(update: ViewUpdate) {
      const toggled = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setFocusModeEffect)),
      )

      if (toggled) {
        this.recompute(update.view)
        return
      }

      if (update.docChanged && update.startState.doc.lines !== update.state.doc.lines) {
        // 换行 / 合并行：行号整体移动，立刻重算，不等防抖（否则会有 100ms 的 class 错位）
        this.recompute(update.view)
        return
      }

      if (update.docChanged) {
        // 防抖：打字穿越块边界时避免 decoration 抖动（CSS 过渡兜底）；
        // 等待期间先把旧装饰映射到新位置
        this.decorations = this.decorations.map(update.changes)
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          this.recompute(this.view)
          this.view.dispatch({ effects: refreshFocusEffect.of(null) })
        }, RECOMPUTE_DEBOUNCE_MS)
        return
      }

      if (update.selectionSet || update.viewportChanged) {
        this.recompute(update.view)
      }
    }

    private recompute(view: EditorView, retry = false) {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      if (!retry) this.parseRetries = 0
      const ranges = paddedVisibleRanges(view, focusPadLines(view.state.doc.length))
      this.decorations = computeFocusDecorations(view.state, ranges)
      // 只等「可见区」的语法树：CM6 后台只解析到视口后约 10 万字符，
      // 等整篇解析完的话长文永远等不到，会每 30ms 空转一次
      const upto = ranges.length > 0 ? ranges[ranges.length - 1]!.to : 0
      if (
        view.state.field(focusModeField, false) &&
        !syntaxTreeAvailable(view.state, upto) &&
        this.parseRetries < MAX_PARSE_RETRIES
      ) {
        this.parseRetries += 1
        this.timer = setTimeout(() => {
          this.timer = null
          this.recompute(this.view, true)
          this.view.dispatch({ effects: refreshFocusEffect.of(null) })
        }, PARSE_RETRY_MS)
      }
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer)
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)
