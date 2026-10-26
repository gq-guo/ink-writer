/**
 * 任务列表 `- [ ]` / `- [x]`
 *
 * 磁盘上的文本照旧一字不差，这里做三件事：
 * - 光标外的任务项显示成复选框（styledSource 用 TaskCheckboxWidget 替换 `- [ ] `，
 *   与隐藏 # ** 同一套规则：设置「显示 Markdown 标记」关闭、光标不在这一行）
 * - 点复选框 / 任务框 `[ ]` 切换完成状态（只改框里那个字符，光标不动）
 * - ⌘L 切换选区覆盖的每一行：普通行 → `- [ ] `，列表项 → 加任务框，`[ ]` ⇄ `[x]`
 *
 * 已完成项变淡加删除线在 styledSource 里（TaskMarker / Task 节点）。
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'

/**
 * 改动不算「输入」：不触发打字居中、临时空行等只针对打字的行为；
 * 也不算「用户动过光标」（styledSource 的 cursorEngagedField），点复选框不会让光标所在行露出标记
 */
export const TASK_TOGGLE_EVENT = 'toggle.task'

/** ⌘L 前补全语法树最多等这么久（大文档里光标附近之外可能还没解析） */
const PARSE_TIMEOUT_MS = 200

/** 行首的缩进与引用标记（可多层），任务框加在它们之后 */
const QUOTE_PREFIX = /^(?:\s*>)*\s*/
/** 列表项上的任务框：标记 + 空格 + [ ] / [x]，后面是空白或行尾 */
const TASK_ITEM = /^((?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])\](?=\s|$)/
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

/** 光标外替换 `- [ ] ` 的复选框；点击由 inkTaskClickHandler 处理 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    /** 无序列表：连同 `- ` 一起替换，复选框外悬在左边距里（与列表标记同位置） */
    readonly hanging: boolean,
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.hanging === this.hanging
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-md-checkbox'
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    if (this.checked) box.dataset.checked = ''
    const wrap = document.createElement('span')
    wrap.className = this.hanging ? 'cm-md-checkbox-hang' : 'cm-md-checkbox-inline'
    wrap.appendChild(box)
    return wrap
  }

  /** 不忽略：mousedown 要交给 inkTaskClickHandler */
  ignoreEvent(): boolean {
    return false
  }
}

function insideSkippedBlock(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (SKIP_NODES.has(node.name)) return true
  }
  return false
}

function ancestor(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) return current
  }
  return null
}

/** 列表项自己的任务框（ListItem > Task > TaskMarker） */
export function taskMarkerOf(item: SyntaxNode): SyntaxNode | null {
  const task = item.getChild('Task')
  const marker = task?.firstChild
  return marker?.name === 'TaskMarker' ? marker : null
}

/** 把 from 处的 `[ ]` / `[x]` 翻转；from 指向 `[` */
function flipMarker(state: EditorState, from: number): ChangeSpec {
  const checked = state.doc.sliceString(from + 1, from + 2) !== ' '
  return { from: from + 1, to: from + 2, insert: checked ? ' ' : 'x' }
}

/**
 * 这一行切换时实际作用的行：列表项的续行（`- [ ] a` 下面缩进的 `b`）作用到列表项的首行，
 * 不在续行上另起一个子任务
 */
function targetLine(state: EditorState, tree: Tree, lineNumber: number): number {
  const line = state.doc.line(lineNumber)
  const restFrom = line.from + QUOTE_PREFIX.exec(line.text)![0].length
  // 列表项里的代码块等：行本身不切换（toggleLineChange 会跳过），也不去勾所属的列表项
  if (restFrom === line.to || insideSkippedBlock(tree, restFrom)) return lineNumber
  const item = ancestor(tree.resolveInner(restFrom, 1), 'ListItem')
  return item ? state.doc.lineAt(item.from).number : lineNumber
}

/** 单独一行该怎么改；不改返回 null */
function toggleLineChange(state: EditorState, tree: Tree, lineNumber: number, onlyLine: boolean): ChangeSpec | null {
  const line = state.doc.line(lineNumber)
  const prefix = QUOTE_PREFIX.exec(line.text)![0]
  const rest = line.text.slice(prefix.length)
  const restFrom = line.from + prefix.length

  if (insideSkippedBlock(tree, restFrom)) return null
  if (rest.trim() === '') {
    // 选了多行时跳过空行；单独一行空行直接起一个任务
    return onlyLine ? { from: restFrom, to: line.to, insert: '- [ ] ' } : null
  }

  const isListMark = tree.resolveInner(restFrom, 1).name === 'ListMark'

  // 已有任务框（`- [ ]` 后面没有文字时解析器不认 TaskMarker，按文本认）
  const task = TASK_ITEM.exec(rest)
  if (task && isListMark) return flipMarker(state, restFrom + task[1]!.length - 1)

  const list = LIST_ITEM.exec(rest)
  if (list && isListMark) {
    // 列表项里直接是引用、代码块等：没有能挂任务框的段落
    if (/^[>`~]/.test(rest.slice(list[0].length))) return null
    // 标记后面补上任务框（标记与文字之间的空格统一成一个）
    return { from: restFrom + list[1]!.length, to: restFrom + list[0].length, insert: ' [ ] ' }
  }

  return { from: restFrom, insert: '- [ ] ' }
}

/** ⌘L：切换选区覆盖的每一行；没有可改的行（或语法树没能及时解析完）时返回 null */
export function toggleTaskSpec(state: EditorState): TransactionSpec | null {
  const selected = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    // 选区恰好结束在下一行行首时，不算那一行
    const endLine = state.doc.lineAt(range.to)
    const last = range.to > range.from && range.to === endLine.from ? endLine.number - 1 : endLine.number
    for (let ln = first; ln <= Math.max(first, last); ln++) selected.add(ln)
  }

  // 没解析到的地方会把任务误认成普通行（再套一层任务框），解析不完就不动
  // 不用 Math.max(...selected)：全选十几万行时展开参数会栈溢出
  let maxLine = 1
  for (const ln of selected) if (ln > maxLine) maxLine = ln
  const lastLine = state.doc.line(maxLine)
  const tree = ensureSyntaxTree(state, lastLine.to, PARSE_TIMEOUT_MS)
  if (!tree) return null

  const onlyLine = selected.size === 1
  const lineNumbers = new Set([...selected].map((ln) => targetLine(state, tree, ln)))
  const changes: ChangeSpec[] = []
  for (const ln of [...lineNumbers].sort((a, b) => a - b)) {
    const change = toggleLineChange(state, tree, ln, onlyLine)
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
  return { changes: changeSet, selection, userEvent: TASK_TOGGLE_EVENT }
}

/**
 * 点击 pos 处的任务框；pos 不在任务框上时返回 null。
 * pos 可以是任务框本身，也可以是复选框控件的起点（无序列表时是 `-` 的位置）
 */
export function clickTaskSpec(state: EditorState, pos: number): TransactionSpec | null {
  const tree = syntaxTree(state)
  const node = tree.resolveInner(pos, 1)
  let marker: SyntaxNode | null = node.name === 'TaskMarker' ? node : null
  if (!marker && tree.resolveInner(pos, -1).name === 'TaskMarker') marker = tree.resolveInner(pos, -1)
  if (!marker && node.name === 'ListMark' && node.parent) marker = taskMarkerOf(node.parent)
  if (!marker) return null
  return { changes: flipMarker(state, marker.from), userEvent: TASK_TOGGLE_EVENT }
}

export function toggleTask(view: EditorView): boolean {
  const spec = toggleTaskSpec(view.state)
  if (!spec) return false
  view.dispatch(spec)
  return true
}

/** 点复选框 / 任务框切换：不移动光标、不抢走选区 */
export const inkTaskClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
    // 只有点在复选框本身（或「显示标记」时的 [ ]）上才切换；外悬盒里框右边的空白照常放光标
    const element = event.target instanceof Element ? event.target : null
    const box = element?.closest('.cm-md-checkbox') ?? element?.closest('.cm-md-task-marker')
    if (!box) return false
    // 控件取最外层元素：posAtDOM 对控件根元素给出它的起点
    const target = box.closest('.cm-md-checkbox-hang, .cm-md-checkbox-inline') ?? box
    event.preventDefault()
    // 双击的第二下只吞掉（不再切回去，也不选中文字）
    if (event.detail > 1) return true
    const spec = clickTaskSpec(view.state, view.posAtDOM(target))
    if (spec) view.dispatch(spec)
    return true
  },
})
