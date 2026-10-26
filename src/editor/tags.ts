/**
 * 行内标签 `#tag`
 *
 * 规则与 Rust 的 src-tauri/src/tags.rs 一致（全库搜索在那边做）：
 * - `#` 在行首或空白之后（`url#anchor`、`[a](#b)`、`\#x`、`##` 都不算）
 * - 后面是字母 / 数字（含中文）/ `_` / `-` / `/`，遇到空格或标点结束；末尾的 `-` `/` 不算
 * - 不能全是数字（`#1`、`#2024` 不算）
 * - 代码（围栏、缩进、行内）、链接地址、HTML 里的不算（编辑器按语法树判断）
 *
 * 编辑器里标签着色（styledSource 调 tagRangesIn）；⌘Click 标签打开 Quick Open 搜这个标签。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

export interface LineTag {
  /** `#` 在行内的位置 */
  start: number
  /** 标签结束位置（行内） */
  end: number
  /** 标签原文（不含 #） */
  tag: string
}

/** 与 Rust 的 char::is_alphanumeric（Alphabetic + Numeric）一致：含印地语、泰语等的元音符号 */
const TAG_CHAR = /[\p{Alphabetic}\p{N}_\-/]/u
/** 与 Rust 的 char::is_whitespace（White_Space 属性）一致 */
const WHITESPACE = /\p{White_Space}/u

/** 找出一行文本里的标签（不判断代码块等上下文） */
export function tagsInLine(line: string): LineTag[] {
  const out: LineTag[] = []
  const chars = Array.from(line)
  let offset = 0
  let index = 0
  while (index < chars.length) {
    const ch = chars[index]!
    const prev = index > 0 ? chars[index - 1]! : null
    if (ch !== '#' || (prev !== null && !WHITESPACE.test(prev))) {
      offset += ch.length
      index++
      continue
    }
    let bodyEnd = index + 1
    while (bodyEnd < chars.length && TAG_CHAR.test(chars[bodyEnd]!)) bodyEnd++
    const raw = chars.slice(index + 1, bodyEnd).join('')
    const body = raw.replace(/[-/]+$/, '')
    if (body !== '' && !/^\d+$/.test(body)) {
      out.push({ start: offset, end: offset + 1 + body.length, tag: body })
    }
    offset += 1 + raw.length
    index = bodyEnd
  }
  return out
}

/** 这些节点里的 `#xxx` 不是标签 */
const NOT_PROSE = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'URL',
  'Autolink',
  'HTMLTag',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'LinkLabel',
])

function insideNonProse(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (NOT_PROSE.has(node.name)) return true
  }
  return false
}

/** 区间内的标签（文档位置），供 styledSource 着色 */
export function tagRangesIn(state: EditorState, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number)
    if (!line.text.includes('#')) continue
    for (const tag of tagsInLine(line.text)) {
      const start = line.from + tag.start
      if (!insideNonProse(state, start)) out.push({ from: start, to: line.from + tag.end })
    }
  }
  return out
}

export interface TagHandlerOptions {
  /** ⌘Click 标签：tag 不含 # */
  onOpenTag: (tag: string) => void
}

/** pos 所在的标签（不含 #）；不在标签上返回 null */
export function tagAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos)
  const tag = tagsInLine(line.text).find((item) => pos >= line.from + item.start && pos <= line.from + item.end)
  if (!tag || insideNonProse(state, line.from + tag.start)) return null
  return tag.tag
}

/**
 * ⌘Click 标签（styledSource 给标签加了 cm-md-tag）。
 * 按点击位置重新识别整个标签：搜索高亮等别的装饰可能把标签的 span 切成几段
 */
export function inkTagHandler(options: TagHandlerOptions) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false
      if (!(event.target instanceof Element) || !event.target.closest('.cm-md-tag')) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      const tag = pos === null ? null : tagAt(view.state, pos)
      if (!tag) return false
      event.preventDefault()
      options.onOpenTag(tag)
      return true
    },
  })
}
