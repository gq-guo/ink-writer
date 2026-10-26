/**
 * 编辑器桥接：让非 EditorHost 组件也能操作编辑器，而不必 import @codemirror/*（spec §4.3.1）
 */

export interface EditorBridge {
  /** 替换全文；preserveSelection 时按行列就近恢复光标 */
  setContent: (text: string, options?: { preserveSelection?: boolean }) => void
  /** 滚动到并选中一段范围 */
  revealRange: (range: [number, number]) => void
  getContent: () => string
  focus: () => void
  /** 打开查找面板（⌘F） */
  openFind?: () => void
  /** 跳到某个位置：光标放到该行末，该行滚到视口上部（目录跳转用） */
  jumpTo?: (pos: number) => void
  /** 切换选区所在行的任务框（⌘L） */
  toggleTask?: () => void
}

let bridge: EditorBridge | null = null

export function registerEditorBridge(next: EditorBridge): () => void {
  bridge = next
  return () => {
    if (bridge === next) bridge = null
  }
}

export const editorBridge = {
  setContent: (text: string, options?: { preserveSelection?: boolean }) =>
    bridge?.setContent(text, options),
  revealRange: (range: [number, number]) => bridge?.revealRange(range),
  getContent: () => bridge?.getContent() ?? '',
  focus: () => bridge?.focus(),
  openFind: () => bridge?.openFind?.(),
  jumpTo: (pos: number) => bridge?.jumpTo?.(pos),
  toggleTask: () => bridge?.toggleTask?.(),
  isReady: () => bridge !== null,
}
