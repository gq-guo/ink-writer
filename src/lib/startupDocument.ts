/**
 * 启动 / 刷新时打开哪一篇
 *
 * 优先回到上次打开的那篇（uiStore.lastDocumentPath）：刷新或重启后还停在原来的文档，
 * 而不是跳到库里最新修改的第一篇。只认库里还在的文档 ——
 * 被删 / 改名了，或者是从 Finder 打开的库外文件（刷新后不再有读权限），都退回到第一篇。
 */
import type { DocumentMeta } from '@/lib/types'

export function pickStartupDocument(
  documents: DocumentMeta[],
  lastDocumentPath: string | null | undefined,
): string | null {
  if (lastDocumentPath && documents.some((document) => document.path === lastDocumentPath)) {
    return lastDocumentPath
  }
  return documents[0]?.path ?? null
}
