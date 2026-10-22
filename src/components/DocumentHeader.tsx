/**
 * 主区域头部（效果图 2 · 侧边栏面板）
 *
 * 文档大标题 + 元信息行（Today, 10:24 · 1,248 words · 8 min read）
 * 文档内容本身（含 H1）照常渲染在下方。
 */
import { formatNumber, relativeTime } from '@/lib/format'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'

export function DocumentHeader() {
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const statistics = useEditorStore((state) => state.statistics)

  if (!activeDocument) return null

  return (
    <header className="ink-doc-header">
      <h1 className="ink-doc-heading">{activeDocument.displayTitle || activeDocument.fileName}</h1>
      <div className="ink-doc-meta">
        {relativeTime(activeDocument.mtime)}
        <span className="ink-dot">·</span>
        {formatNumber(statistics.words)} words
        <span className="ink-dot">·</span>
        {statistics.readingMinutes} min read
      </div>
    </header>
  )
}
