/**
 * 文档目录（右侧悬浮目录的数据源）
 *
 * - 标题：只遍历语法树的顶层节点（Document 的直接子节点），不深入段落内部，大文档也便宜
 * - 当前章节：按「阅读位置」算 —— 视口 30% 高度处所在的那一节；
 *   打字时光标附近就是阅读位置，滚动浏览时跟着滚动走
 * - 结果通过回调交给 React（editorStore），本模块不碰 UI
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

import type { OutlineHeading } from '@/lib/types'

const HEADING_LEVEL: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
}

/** 阅读位置：视口自上而下 30% 处 */
const READING_LINE_RATIO = 0.3
/** 编辑后重算标题的防抖 */
const RECOMPUTE_DEBOUNCE_MS = 150

/** 提取全文标题（去掉 # 标记与 Setext 下划线） */
export function extractHeadings(state: EditorState): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  const tree = syntaxTree(state)
  const cursor = tree.topNode.cursor()
  if (!cursor.firstChild()) return headings
  do {
    const level = HEADING_LEVEL[cursor.name]
    if (!level) continue
    const firstLine = state.doc.lineAt(cursor.from)
    const text = firstLine.text
      .replace(/^\s{0,3}#{1,6}\s*/, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
    if (text) headings.push({ level, text, pos: cursor.from })
  } while (cursor.nextSibling())
  return headings
}

/** pos 所在的章节：最后一个起点 ≤ pos 的标题；在第一个标题之前返回 -1 */
export function activeHeadingIndex(headings: OutlineHeading[], pos: number): number {
  let active = -1
  for (let i = 0; i < headings.length; i++) {
    if (headings[i]!.pos <= pos) active = i
    else break
  }
  return active
}

function readingPosition(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  const height = rect.top + view.scrollDOM.clientHeight * READING_LINE_RATIO - view.documentTop
  return view.lineBlockAtHeight(Math.max(0, height)).from
}

function sameHeadings(a: OutlineHeading[], b: OutlineHeading[]): boolean {
  return (
    a.length === b.length &&
    a.every((h, i) => h.pos === b[i]!.pos && h.level === b[i]!.level && h.text === b[i]!.text)
  )
}

export function inkOutlinePlugin(
  onChange: (headings: OutlineHeading[], active: number) => void,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private headings: OutlineHeading[] = []
      private active = -1
      private timer: ReturnType<typeof setTimeout> | null = null
      private frame: number | null = null
      private readonly onScroll = () => {
        if (this.frame !== null) return
        this.frame = requestAnimationFrame(() => {
          this.frame = null
          this.refreshActive()
        })
      }

      constructor(readonly view: EditorView) {
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
        // 首次在下一拍计算：构造时布局还没完成
        this.timer = setTimeout(() => this.recompute(), 0)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          if (this.timer) clearTimeout(this.timer)
          this.timer = setTimeout(() => this.recompute(), RECOMPUTE_DEBOUNCE_MS)
        } else if (update.viewportChanged || update.geometryChanged) {
          this.onScroll()
        }
      }

      destroy() {
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
        if (this.timer) clearTimeout(this.timer)
        if (this.frame !== null) cancelAnimationFrame(this.frame)
      }

      private recompute() {
        this.timer = null
        const headings = extractHeadings(this.view.state)
        const changed = !sameHeadings(headings, this.headings)
        if (changed) this.headings = headings
        this.refreshActive(changed)
      }

      private refreshActive(force = false) {
        const active = activeHeadingIndex(this.headings, readingPosition(this.view))
        if (!force && active === this.active) return
        this.active = active
        onChange(this.headings, active)
      }
    },
  )
}
