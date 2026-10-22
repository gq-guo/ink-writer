/**
 * 主区域头部（效果图 2 · 侧边栏面板）
 *
 * 规则（解决「一个文档四个名字」的混乱）：
 * - 文档名 = 正文首个 H1 ?? 文件名去扩展名（spec R3）
 * - 首行是 H1 时，大标题由正文首行承担，这里**只留元信息行**，不再重复
 * - 无 H1 时才显示文件名大标题 + 元信息行
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
  const t = useT()
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const statistics = useEditorStore((state) => state.statistics)
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)

  // 效果图 1：侧边栏收起时标题由顶栏文件名承担，正文区不重复
  if (!activeDocument || !sidebarVisible) return null

  const meta = (
    <div className="ink-doc-meta">
      {formatMetaTime(activeDocument.mtime, t)}
      <span className="ink-dot">·</span>
      {formatNumber(statistics.words)} {t('common.wordsUnit')}
      <span className="ink-dot">·</span>
      {statistics.readingMinutes} {t('common.minReadUnit')}
    </div>
  )

  // 首行就是 H1：正文首行已是大标题，这里只留元信息
  if (activeDocument.titleFromH1) {
    return (
      <header className="ink-doc-header" data-compact="true">
        {meta}
      </header>
    )
  }

  return (
    <header className="ink-doc-header">
      <h1 className="ink-doc-heading">
        {activeDocument.displayTitle || activeDocument.fileName}
      </h1>
      {meta}
    </header>
  )
}
