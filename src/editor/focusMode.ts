/**
 * Focus Mode（spec §9）
 *
 * 当前块 = 光标所在的最外层块级语法节点（paragraph / heading / blockquote / 整个 list …），
 * 其余块 opacity 0.35。
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

/** Focus Mode 开关状态 */
export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusModeEffect)) return effect.value
    }
    return value
  },
})

/** 重算防抖（spec §9.3） */
const RECOMPUTE_DEBOUNCE_MS = 100

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
  const activeBlock = topLevelBlockAt(tree, head)

  const ranges: { from: number; to: number }[] = []
  const activeLines: number[] = []

  for (const range of visibleRanges) {
    for (const block of topLevelBlocksIn(tree, range.from, range.to)) {
      const isActive =
        activeBlock !== null &&
        block.from === activeBlock.from &&
        block.to === activeBlock.to
      if (isActive) {
        // 当前块用 accent 竖线标识（效果图 1）
        const firstLine = state.doc.lineAt(block.from).number
        const lastLine = state.doc.lineAt(block.to).number
        for (let line = firstLine; line <= lastLine; line++) activeLines.push(line)
        continue
      }
      ranges.push({ from: block.from, to: block.to })
    }
  }

  const decorations: Range<Decoration>[] = ranges.map((range) =>
    Decoration.mark({ class: 'ink-focus-dim' }).range(range.from, range.to),
  )

  // 当前块的行装饰（左侧竖线）
  for (const line of new Set(activeLines)) {
    const lineStart = state.doc.line(line).from
    decorations.push(Decoration.line({ class: 'ink-focus-active' }).range(lineStart))
  }

  return Decoration.set(decorations, true)
}

export const inkFocusModePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    view: EditorView
    private timer: ReturnType<typeof setTimeout> | null = null

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

      if (update.docChanged) {
        // 防抖：打字穿越块边界时避免 decoration 抖动（CSS 过渡兜底）
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          this.recompute(update.view)
        }, RECOMPUTE_DEBOUNCE_MS)
        return
      }

      if (update.selectionSet || update.viewportChanged) {
        this.recompute(update.view)
      }
    }

    private recompute(view: EditorView) {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      this.decorations = computeFocusDecorations(
        view.state,
        paddedVisibleRanges(view, focusPadLines(view.state.doc.length)),
      )
      if (!syntaxTreeAvailable(view.state)) {
        this.timer = setTimeout(() => {
          this.timer = null
          this.recompute(this.view)
        }, 30)
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
