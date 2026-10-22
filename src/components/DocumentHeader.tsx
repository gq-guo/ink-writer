/**
 * 主区域头部（效果图 2 · 侧边栏面板）
 *
 * 文档大标题 + 元信息行（Today, 10:24 · 1,248 words · 8 min read）
 * 文档内容本身（含 H1）照常渲染在下方。
 */
import { formatNumber, groupFor } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

function formatMetaTime(mtimeSeconds: number, t: (key: string) => string): string {
  const date = new Date(mtimeSeconds * 1000)
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const group = groupFor(mtimeSeconds)
  if (group === 'today') return `${t('meta.today')}, ${hm}`
  if (group === 'yesterday') return `${t('meta.yesterday')}, ${hm}`
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y === new Date().getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`
}

export function DocumentHeader() {
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const statistics = useEditorStore((state) => state.statistics)
  const t = useT()
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)

  // 效果图 1：侧边栏收起时标题由顶栏文件名承担，正文区不重复大标题
  if (!activeDocument || !sidebarVisible) return null

  return (
    <header className="ink-doc-header">
      <h1 className="ink-doc-heading">{activeDocument.displayTitle || activeDocument.fileName}</h1>
      <div className="ink-doc-meta">
        {formatMetaTime(activeDocument.mtime, t)}
        <span className="ink-dot">·</span>
        {formatNumber(statistics.words)} {t('common.wordsUnit')}
        <span className="ink-dot">·</span>
        {statistics.readingMinutes} {t('common.minReadUnit')}
      </div>
    </header>
  )
}
