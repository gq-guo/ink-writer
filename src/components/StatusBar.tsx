/**
 * 状态栏（效果图 2 · 8. 文章统计）
 *
 * - 右下常驻显示「N 字 · 约 M 分钟」（效果图是常驻，不是 hover 才出现）
 * - 点击展开统计卡：字数 / 字符 / 段落 / 句子 / 阅读时长
 */
import { useEffect, useRef, useState } from 'react'

import { formatNumber } from '@/lib/format'
import { useEditorStore } from '@/stores/editorStore'
import { SidebarToggle } from './TopBar'

export function StatusBar() {
  const statistics = useEditorStore((state) => state.statistics)
  const focusMode = useEditorStore((state) => state.focusMode)

  const [expanded, setExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!expanded) return
    const onDown = (event: MouseEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [expanded])

  if (focusMode) return null

  return (
    <>
      <div className="ink-statusbar">
        <SidebarToggle />
        <button
          className="ink-statusbar-text"
          onClick={() => setExpanded((value) => !value)}
          role="button"
          tabIndex={0}
        >
          {formatNumber(statistics.words)} 字&nbsp;&nbsp;约 {statistics.readingMinutes} 分钟
        </button>
      </div>

      {expanded ? (
        <div className="ink-status-card" ref={cardRef}>
          <div className="ink-status-head">
            <strong>{formatNumber(statistics.words)}</strong> 字
            <span>≈ {statistics.readingMinutes} 分钟</span>
          </div>
          <dl>
            <div className="ink-status-row">
              <dt>字数</dt>
              <dd>{formatNumber(statistics.words)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>字符</dt>
              <dd>{formatNumber(statistics.characters)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>段落</dt>
              <dd>{formatNumber(statistics.paragraphs)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>句子</dt>
              <dd>{formatNumber(statistics.sentences)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>阅读时长</dt>
              <dd>{statistics.readingMinutes} 分钟</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </>
  )
}
