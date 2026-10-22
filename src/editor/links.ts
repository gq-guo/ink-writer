/**
 * ⌘Click 行为（spec §2.1）
 *
 * - 链接：⌘Click 用系统默认程序打开
 * - 图片：⌘Click 在 Finder 中显示
 */
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export interface LinkHandlerOptions {
  onOpenUrl: (url: string) => void
  onRevealPath: (path: string) => void
  /** 当前文档所在目录（图片路径相对于它） */
  getDocDir: () => string
}

function nodeUrlAt(
  state: EditorState,
  pos: number,
): { url: string; isImage: boolean } | null {
  const tree = syntaxTree(state)
  let node: SyntaxNode | null = tree.resolveInner(pos, 0)
  while (node) {
    if (node.name === 'URL') {
      const text = state.doc.sliceString(node.from, node.to)
      let isImage = false
      let parent: SyntaxNode | null = node.parent
      while (parent) {
        if (parent.name === 'Image') {
          isImage = true
          break
        }
        if (parent.name === 'Link') break
        parent = parent.parent
      }
      return { url: text, isImage }
    }
    node = node.parent
  }
  return null
}

export function inkLinkHandler(options: LinkHandlerOptions) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const target = nodeUrlAt(view.state, pos)
      if (!target) return false
      event.preventDefault()

      if (target.isImage) {
        const docDir = options.getDocDir()
        const path = target.url.startsWith('/') ? target.url : `${docDir}/${target.url}`
        options.onRevealPath(path)
      } else {
        options.onOpenUrl(target.url)
      }
      return true
    },
  })
}
