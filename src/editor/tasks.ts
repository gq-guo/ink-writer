/**
 * 任务列表 `- [ ]` / `- [x]`
 *
 * 文本照旧一字不差（spec §2.1），这里只做两件事：
 * - 点任务框 `[ ]` 切换完成状态（只改框里那个字符，光标不动）
 * - ⌘L 切换选区覆盖的每一行：普通行 → `- [ ] `，列表项 → 加任务框，`[ ]` ⇄ `[x]`
 *
 * 已完成项变淡加删除线在 styledSource 里（TaskMarker / Task 节点）。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** 改动不算「输入」：不触发打字居中、临时空行等只针对打字的行为 */
const USER_EVENT = 'toggle.task'

/** 行首的缩进与引用标记（可多层），任务框加在它们之后 */
const QUOTE_PREFIX = /^(?:\s*>)*\s*/
/** 列表项上的任务框：标记 + 空格 + [ ] / [x] */
const TASK_ITEM = /^((?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])\]/
/** 列表标记（没有任务框）：标记 + 空格或行尾 */
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(?:\s+|$)/

/** 这些块里的行不当成任务来切换 */
const SKIP_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'Table',
  'HorizontalRule',
])

function insideSkippedBlock(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (SKIP_NODES.has(node.name)) return true
  }
  return false
}

/** pos 处是否是一个真的任务框（不是代码块里长得像的文字） */
function taskMarkerAt(state: EditorState, pos: number): boolean {
  return syntaxTree(state).resolveInner(pos, 1).name === 'TaskMarker'
}

/** 把 from 处的 `[ ]` / `[x]` 翻转；from 指向 `[` */
function flipMarker(state: EditorState, from: number): ChangeSpec {
  const checked = state.doc.sliceString(from + 1, from + 2) !== ' '
  return { from: from + 1, to: from + 2, insert: checked ? ' ' : 'x' }
}

/** 单独一行该怎么改；不改返回 null */
function toggleLineChange(state: EditorState, lineNumber: number, onlyLine: boolean): ChangeSpec | null {
  const line = state.doc.line(lineNumber)
  const prefix = QUOTE_PREFIX.exec(line.text)![0]
  const rest = line.text.slice(prefix.length)
  const restFrom = line.from + prefix.length

  if (rest.trim() === '') {
    // 选了多行时跳过空行；单独一行空行直接起一个任务
    return onlyLine ? { from: restFrom, to: line.to, insert: '- [ ] ' } : null
  }
  if (insideSkippedBlock(state, restFrom)) return null

  const task = TASK_ITEM.exec(rest)
  if (task) {
    const markerFrom = restFrom + task[1]!.length - 1
    if (taskMarkerAt(state, markerFrom)) return flipMarker(state, markerFrom)
  }

  // 列表项：标记后面补上任务框（标记与文字之间的空格统一成一个）
  const list = LIST_ITEM.exec(rest)
  if (list && syntaxTree(state).resolveInner(restFrom, 1).name === 'ListMark') {
    return { from: restFrom + list[1]!.length, to: restFrom + list[0].length, insert: ' [ ] ' }
  }

  return { from: restFrom, insert: '- [ ] ' }
}

/** ⌘L：切换选区覆盖的每一行；没有可改的行时返回 null */
export function toggleTaskSpec(state: EditorState): TransactionSpec | null {
  const lineNumbers = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    // 选区恰好结束在下一行行首时，不算那一行
    const endLine = state.doc.lineAt(range.to)
    const last = range.to > range.from && range.to === endLine.from ? endLine.number - 1 : endLine.number
    for (let ln = first; ln <= Math.max(first, last); ln++) lineNumbers.add(ln)
  }

  const onlyLine = lineNumbers.size === 1
  const changes: ChangeSpec[] = []
  for (const ln of [...lineNumbers].sort((a, b) => a - b)) {
    const change = toggleLineChange(state, ln, onlyLine)
    if (change) changes.push(change)
  }
  if (changes.length === 0) return null

  const changeSet = state.changes(changes)
  // 在光标处插入的标记要落到光标前面（assoc = 1）：空行起任务后光标在 `- [ ] ` 之后
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1)),
    ),
    state.selection.mainIndex,
  )
  return { changes: changeSet, selection, userEvent: USER_EVENT }
}

/** 点击 pos 处的任务框；pos 不在任务框上时返回 null */
export function clickTaskSpec(state: EditorState, pos: number): TransactionSpec | null {
  const node = syntaxTree(state).resolveInner(pos, 1)
  const marker = node.name === 'TaskMarker' ? node : syntaxTree(state).resolveInner(pos, -1)
  if (marker.name !== 'TaskMarker') return null
  return { changes: flipMarker(state, marker.from), userEvent: USER_EVENT }
}

export function toggleTask(view: EditorView): boolean {
  const spec = toggleTaskSpec(view.state)
  if (!spec) return false
  view.dispatch(spec)
  return true
}

/** 点任务框切换：不移动光标、不抢走选区（styledSource 给任务框加了 cm-md-task-marker） */
export const inkTaskClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
    const target = event.target instanceof Element ? event.target.closest('.cm-md-task-marker') : null
    if (!target) return false
    const spec = clickTaskSpec(view.state, view.posAtDOM(target))
    if (!spec) return false
    event.preventDefault()
    view.dispatch(spec)
    return true
  },
})
