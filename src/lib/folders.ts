/**
 * 侧边栏的文件夹列表：从文档的 dirPrefix 推出来，不单独扫描目录
 *
 * 只列出含有文档的文件夹（空文件夹、只放图片的 assets/ 不出现）；
 * 子文件夹排在父文件夹下面，数量包含子文件夹里的文档。
 */
import type { DocumentMeta } from './types'

export interface FolderEntry {
  /** 相对库根目录的前缀，如 "Project/Drafts/"；与 DocumentMeta.dirPrefix 同一格式 */
  prefix: string
  /** 最后一级文件夹名 */
  name: string
  /** 0 = 库根目录下的一级文件夹 */
  depth: number
  /** 文件夹（含子文件夹）里的文档数 */
  count: number
}

function compareSegments(a: string[], b: string[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = a[index]!.localeCompare(b[index]!, undefined, { numeric: true, sensitivity: 'base' })
    if (order !== 0) return order
    // 只差大小写 / 重音的同名文件夹（Notes 与 notes、resume 与 résumé）是不同的文件夹：再按原文排，
    // 否则两者的子文件夹会交错，缩进到错的父文件夹下
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1
  }
  return a.length - b.length
}

export function listFolders(documents: DocumentMeta[]): FolderEntry[] {
  const counts = new Map<string, number>()
  for (const document of documents) {
    const segments = document.dirPrefix.split('/').filter(Boolean)
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = `${segments.slice(0, depth).join('/')}/`
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([prefix, count]) => {
      const segments = prefix.split('/').filter(Boolean)
      return { prefix, name: segments[segments.length - 1]!, depth: segments.length - 1, count, segments }
    })
    .sort((a, b) => compareSegments(a.segments, b.segments))
    .map(({ prefix, name, depth, count }) => ({ prefix, name, depth, count }))
}

/** 文档是否在这个文件夹里（含子文件夹） */
export function isInFolder(document: DocumentMeta, prefix: string): boolean {
  return document.dirPrefix.startsWith(prefix)
}
