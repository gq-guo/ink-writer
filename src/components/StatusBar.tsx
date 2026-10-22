/**
 * 状态栏（效果图 2 · 8. 文章统计）
 *
 * - 右下常驻显示「N 字 · 约 M 分钟」（效果图是常驻，不是 hover 才出现）
 * - 点击展开统计卡：字数 / 字符 / 段落 / 句子 / 阅读时长
 */
import { useEffect, useRef, useState } from 'react'

import { formatNumber } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { SidebarToggle } from './TopBar'

export function StatusBar() {
  const t = useT()
  const statistics = useEditorStore((state) => state.statistics)

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

  // 效果图 1：Focus Mode 下底部栏仍显示（字数 + 侧栏开关）
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
          {formatNumber(statistics.words)} {t('common.wordsUnit')}&nbsp;&nbsp;·&nbsp;&nbsp;{statistics.readingMinutes} {t('common.minReadUnit')}
        </button>
      </div>

      {expanded ? (
        <div className="ink-status-card" ref={cardRef}>
          <div className="ink-status-head">
            <strong>{formatNumber(statistics.words)}</strong> {t('common.wordsUnit')}
            <span>≈ {statistics.readingMinutes} {t('common.minReadUnit')}</span>
          </div>
          <dl>
            <div className="ink-status-row">
              <dt>{t('stats.words')}</dt>
              <dd>{formatNumber(statistics.words)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>{t('stats.characters')}</dt>
              <dd>{formatNumber(statistics.characters)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>{t('stats.paragraphs')}</dt>
              <dd>{formatNumber(statistics.paragraphs)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>{t('stats.sentences')}</dt>
              <dd>{formatNumber(statistics.sentences)}</dd>
            </div>
            <div className="ink-status-row">
              <dt>{t('stats.readingTime')}</dt>
              <dd>{statistics.readingMinutes} min</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </>
  )
}
