/**
 * 文档头（元信息行）
 *
 * 以块级 widget 的形式放进编辑器，而不是放在编辑器外面：
 * - 首个非空行是 H1：元信息行紧跟在 H1 下方（效果图 2：标题在上、元信息在下）；
 * - 否则放在正文最上方。
 * 不再画「没有 H1 时的文件名大标题」：文件名就是文档名，显示在侧栏和顶栏，
 * 正文里画一个改不了的标题只会和真正的文字混在一起。
 * 文档头随正文一起滚动，并且和正文共用同一列，左边缘天然对齐。
 *
 * 块级装饰只能由 StateField 提供（ViewPlugin 不允许），
 * 内容由 EditorHost 通过 setDocHeaderEffect 推送。
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface DocHeaderInfo {
  /** 元信息片段（目前只有修改时间） */
  meta: string[]
}

/** null = 不显示文档头（侧栏收起 / Focus Mode） */
export const setDocHeaderEffect = StateEffect.define<DocHeaderInfo | null>()

/** 只看文档开头这么多行来找首个非空行，避免大文档逐行扫描 */
const LEADING_LINES_LIMIT = 50
const H1_LINE = /^# [ \t]*\S/

class DocHeaderWidget extends WidgetType {
  constructor(
    readonly info: DocHeaderInfo,
    readonly afterH1: boolean,
  ) {
    super()
  }

  eq(other: DocHeaderWidget): boolean {
    return (
      other.afterH1 === this.afterH1 &&
      other.info.meta.join('\u0000') === this.info.meta.join('\u0000')
    )
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div')
    root.className = 'ink-doc-header'
    root.dataset.afterH1 = String(this.afterH1)
    const meta = document.createElement('div')
    meta.className = 'ink-doc-meta'
    this.info.meta.forEach((part, index) => {
      if (index > 0) {
        const dot = document.createElement('span')
        dot.className = 'ink-dot'
        dot.textContent = '·'
        meta.appendChild(dot)
      }
      meta.appendChild(document.createTextNode(part))
    })
    root.appendChild(meta)
    return root
  }

  ignoreEvent(): boolean {
    return true
  }
}

/** 首个非空行若是 H1，返回该行末尾位置 */
function leadingH1End(state: EditorState): number | null {
  const doc = state.doc
  const last = Math.min(doc.lines, LEADING_LINES_LIMIT)
  for (let number = 1; number <= last; number++) {
    const line = doc.line(number)
    if (line.text.trim() === '') continue
    return H1_LINE.test(line.text) ? line.to : null
  }
  return null
}

function build(state: EditorState, info: DocHeaderInfo | null): DecorationSet {
  if (!info) return Decoration.none
  const h1End = leadingH1End(state)
  const widget = new DocHeaderWidget(info, h1End !== null)
  return Decoration.set(
    h1End !== null
      ? Decoration.widget({ widget, block: true, side: 1 }).range(h1End)
      : Decoration.widget({ widget, block: true, side: -1 }).range(0),
  )
}

const docHeaderInfoField = StateField.define<DocHeaderInfo | null>({
  create: () => null,
  update(info, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDocHeaderEffect)) return effect.value
    }
    return info
  },
})

const docHeaderDecorations = StateField.define<DecorationSet>({
  create: (state) => build(state, state.field(docHeaderInfoField)),
  update(decorations, tr) {
    const changedInfo = tr.effects.some((effect) => effect.is(setDocHeaderEffect))
    // 只有开头几行变化才可能影响位置；其余编辑只需平移
    const touchesLeading =
      tr.docChanged &&
      tr.changes.touchesRange(0, tr.startState.doc.line(Math.min(tr.startState.doc.lines, LEADING_LINES_LIMIT)).to)
    if (changedInfo || touchesLeading) return build(tr.state, tr.state.field(docHeaderInfoField))
    return decorations.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const inkDocHeader = [docHeaderInfoField, docHeaderDecorations]
