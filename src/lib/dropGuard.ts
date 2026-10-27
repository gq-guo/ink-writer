/**
 * 拖放兜底：文件拖到编辑区以外（侧栏、顶栏、正文两侧的空白……）时，WebKit 默认会「打开」这个文件 ——
 * 整个窗口变成一张图片，App 回不来（tauri.conf.json 关了 dragDropEnabled，拖放走 HTML5）。
 *
 * 这里在 window 上最后一个接手：编辑器没处理的文件拖放一律取消默认行为。
 * 图片插入由编辑器负责（imageHandler：落在正文里插在落点，落在别处插在光标处）。
 * Rust 端的主窗口也拒绝跳到 file: 地址（window_theme.rs），两边都拦。
 */

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function carriesImage(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

export function installDropGuard(target: Window = window): () => void {
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    // 取消 dragover 才会收到 drop；不是图片时显示「不能放」
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = carriesImage(event) ? 'copy' : 'none'
  }
  const onDrop = (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault()
  }
  target.addEventListener('dragover', onDragOver)
  target.addEventListener('drop', onDrop)
  return () => {
    target.removeEventListener('dragover', onDragOver)
    target.removeEventListener('drop', onDrop)
  }
}
