/**
 * 编辑器内联图片的读取与缓存
 *
 * 经 Rust 的 read_image 读字节（只放行库内 / 已打开文档旁的图片文件），转成 blob URL。
 * 同一篇文档里同一张图只读一次；切换文档时清空并释放 blob URL。
 * 读失败不缓存：图片可能稍后才被放进 assets/。
 */
import { invoke } from '@tauri-apps/api/core'

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
}

const cache = new Map<string, Promise<string>>()

function mimeTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

export function loadInlineImage(path: string): Promise<string> {
  const cached = cache.get(path)
  if (cached) return cached
  const loading = invoke<ArrayBuffer>('read_image', { path }).then((bytes) =>
    URL.createObjectURL(new Blob([bytes], { type: mimeTypeOf(path) })),
  )
  cache.set(path, loading)
  loading.catch(() => cache.delete(path))
  return loading
}

/** 切换文档时调用：释放上一篇的 blob URL */
export function clearInlineImageCache(): void {
  for (const loading of cache.values()) {
    void loading.then(URL.revokeObjectURL, () => {})
  }
  cache.clear()
}
