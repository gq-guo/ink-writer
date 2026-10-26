/**
 * 图片拖拽 / 粘贴（spec §15.4 / R8）
 *
 * - 拖拽 / 粘贴 → 复制到文档同级 assets/，重名追加 -2/-3
 * - 插入相对路径 ![alt](assets/xxx.png)
 * - 不渲染图片 widget（只做语法样式）
 */
import { invoke } from '@tauri-apps/api/core'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { t } from '@/lib/i18n'
import { errorMessage } from '@/lib/errors'

export interface ImageHandlerOptions {
  /** 当前文档所在目录 */
  getDocDir: () => string
  /** 出错回调 */
  onError: (message: string) => void
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

function altFromName(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  // 方括号会提前结束 alt 文本，链接就不成立了
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[[\]]/g, '')
}

async function insertImages(
  view: EditorView,
  files: File[],
  pos: number,
  options: ImageHandlerOptions,
): Promise<void> {
  const docDir = options.getDocDir()
  if (!docDir) {
    options.onError(t('toast.imageNoDoc'))
    return
  }

  const snippets: string[] = []
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer()
      const bytes = Array.from(new Uint8Array(buffer))
      const relativePath = await invoke<string>('copy_image_bytes', {
        docDir,
        fileName: file.name || 'image.png',
        bytes,
      })
      snippets.push(`![${altFromName(file.name || relativePath)}](${relativePath})`)
    } catch (error) {
      options.onError(errorMessage(error))
    }
  }

  if (snippets.length === 0) return
  const text = snippets.join('\n')
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  })
  view.focus()
}

/**
 * 图片拖到正文以外（两侧空白、侧栏、顶栏）：插在光标处，而不是什么都不做。
 * 挂在 document 上（冒泡）：正文里的拖放已经被上面的 drop 处理并取消了默认行为，这里跳过；
 * window 上的 dropGuard 比这里更晚，兜底取消其余文件拖放的默认「打开文件」
 */
function outsideDropPlugin(options: ImageHandlerOptions) {
  return ViewPlugin.define((view) => {
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented) return
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isImage)
      if (files.length === 0) return
      event.preventDefault()
      void insertImages(view, files, view.state.selection.main.head, options)
    }
    const doc = view.dom.ownerDocument
    doc.addEventListener('drop', onDrop)
    return { destroy: () => doc.removeEventListener('drop', onDrop) }
  })
}

export function inkImageHandler(options: ImageHandlerOptions) {
  return [outsideDropPlugin(options), inkImageDomHandlers(options)]
}

function inkImageDomHandlers(options: ImageHandlerOptions) {
  return EditorView.domEventHandlers({
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isImage)
      if (files.length === 0) return false
      event.preventDefault()
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head
      void insertImages(view, files, pos, options)
      return true
    },

    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isImage)
      if (files.length === 0) return false
      event.preventDefault()
      void insertImages(view, files, view.state.selection.main.head, options)
      return true
    },
  })
}
