/**
 * 列表 / 引用的回车与退格
 *
 * lang-markdown 自带的命令更偏向「编辑源码」，写作时手感不对：
 * - 退格：列表标记后退格会把 `2. ` 换成等宽空格（变成上一项的续行），要再按一次才回到行首
 *   —— 看起来像「只删了序号，光标还缩进着」。这里一次退格就删掉标记和缩进，光标回到行首。
 * - 回车：在空列表项上回车会先插一个空行（把紧凑列表变成松散列表），空引用行回车会继续生成 `>`，
 *   都要再按一次才退出。这里在空项上回车直接退出：清掉这一行的标记。
 */
import { syntaxTree } from '@codemirror/language'
import { Prec, type EditorState, type TransactionSpec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

/** 行首的列表标记：缩进 + `-` / `*` / `+` / `1.` / `1)` + 可选的任务框 + 至少一个空格（或行尾） */
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s+\[[ xX]\])?(?:\s+|$)/

/** 只有引用标记的行：`>`、`> >`（可带空格） */
const EMPTY_QUOTE = /^\s*>(?:\s*>)*\s*$/

/** pos 处的语法节点是否是指定的标记（排除代码块里长得像标记的文字） */
function isMarkAt(state: EditorState, pos: number, name: string): boolean {
  return syntaxTree(state).resolveInner(pos, 1).name === name
}

/** 光标恰好停在列表标记之后时，返回删除标记的事务；否则 null（交给默认退格） */
export function deleteListMarkerSpec(state: EditorState): TransactionSpec | null {
  const { ranges, main } = state.selection
  if (ranges.length > 1 || !main.empty) return null

  const line = state.doc.lineAt(main.head)
  const match = LIST_MARKER.exec(line.text)
  if (!match || main.head !== line.from + match[0].length) return null

  // 必须真的是列表（代码块里的 `1. ` 不算）
  const markStart = line.from + (line.text.length - line.text.trimStart().length)
  if (!isMarkAt(state, markStart, 'ListMark')) return null

  return {
    changes: { from: line.from, to: main.head },
    selection: { anchor: line.from },
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
}

/** 光标在空列表项 / 空引用行的行尾时，返回清掉这一行标记的事务（退出列表或引用）；否则 null */
export function exitEmptyItemSpec(state: EditorState): TransactionSpec | null {
  const { ranges, main } = state.selection
  if (ranges.length > 1 || !main.empty) return null

  const line = state.doc.lineAt(main.head)
  if (main.head !== line.to || line.text.trim() === '') return null
  const markStart = line.from + (line.text.length - line.text.trimStart().length)

  const list = LIST_MARKER.exec(line.text)
  const emptyListItem = list !== null && list[0].length === line.text.length && isMarkAt(state, markStart, 'ListMark')
  const emptyQuote = EMPTY_QUOTE.test(line.text) && isMarkAt(state, markStart, 'QuoteMark')
  if (!emptyListItem && !emptyQuote) return null

  return {
    changes: { from: line.from, to: line.to },
    selection: { anchor: line.from },
    scrollIntoView: true,
    userEvent: 'delete',
  }
}

/** 优先级高于 lang-markdown 自带的 Enter / Backspace（它们是 Prec.high） */
export const inkListKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Enter',
      run: (view) => {
        const spec = exitEmptyItemSpec(view.state)
        if (!spec) return false
        view.dispatch(spec)
        return true
      },
    },
    {
      key: 'Backspace',
      run: (view) => {
        const spec = deleteListMarkerSpec(view.state)
        if (!spec) return false
        view.dispatch(spec)
        return true
      },
    },
  ]),
)
