/**
 * 顶栏（效果图 1 / 效果图 2）
 *
 * 左：文档图标 + 文件名；中：Focus Mode 状态胶囊；右：搜索 / 排版 / 更多
 * 整条很轻，不做传统工具栏 —— 只保留三个图标与文件名。
 */
import { useEffect, useRef, useState } from 'react'

import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/lib/i18n'
import { TypographyPopover } from './TypographyPopover'
import { MoreMenu } from './MoreMenu'

export function TopBar() {
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const focusMode = useEditorStore((state) => state.focusMode)
  const typewriterMode = useSettingsStore((state) => state.settings.typewriterMode)
  const showQuickOpen = useUiStore((state) => state.showQuickOpen)

  const t = useT()
  const [typographyOpen, setTypographyOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const fileName = activeDocument?.fileName ?? ''

  return (
    <div className="ink-topbar">
      <div className="ink-topbar-left">
        <span className="ink-icon ink-icon-file" aria-hidden />
        {fileName ? (
          <button
            className="ink-topbar-name"
            title={t('topbar.rename')}
            onClick={() => {
              const name = window.prompt('重命名文档', fileName.replace(/\.md$/i, ''))
              if (name && activeDocument) void renameDocument(activeDocument.path, name)
            }}
          >
            {fileName}
          </button>
        ) : null}
      </div>

      <div className="ink-topbar-center">
        {focusMode ? (
          <span className="ink-mode-pill">
            <span className="ink-icon ink-icon-target" aria-hidden />
            {t('topbar.focusMode')}
          </span>
        ) : null}
        {typewriterMode ? (
          <span className="ink-mode-pill">
            <span className="ink-icon ink-icon-feather" aria-hidden />
            {t('topbar.typewriter')}
          </span>
        ) : null}
      </div>

      <div className="ink-topbar-right">
        <button className="ink-icon-btn" title={t('topbar.search')} onClick={showQuickOpen}>
          <span className="ink-icon ink-icon-search" aria-hidden />
        </button>

        <div className="ink-popover-anchor">
          <button
            className="ink-icon-btn ink-aa-btn"
            title={t('topbar.typography')}
            onClick={() => {
              setTypographyOpen((open) => !open)
              setMenuOpen(false)
            }}
          >
            Aa
          </button>
          {typographyOpen ? (
            <TypographyPopover onClose={() => setTypographyOpen(false)} />
          ) : null}
        </div>

        <div className="ink-popover-anchor" ref={moreRef}>
          <button
            className="ink-icon-btn"
            title={t('topbar.more')}
            onClick={() => {
              setMenuOpen((open) => !open)
              setTypographyOpen(false)
            }}
          >
            <span className="ink-icon ink-icon-more" aria-hidden />
          </button>
          {menuOpen ? <MoreMenu onClose={() => setMenuOpen(false)} /> : null}
        </div>
      </div>
    </div>
  )
}

/** 侧边栏开关（效果图左下角） */
export function SidebarToggle() {
  const t = useT()
  const visible = useUiStore((state) => state.sidebarVisible)
  const toggle = useUiStore((state) => state.toggleSidebar)
  return (
    <button
      className="ink-icon-btn ink-sidebar-toggle"
      title={t(visible ? 'topbar.hideSidebar' : 'topbar.showSidebar')}
      onClick={toggle}
    >
      <span className="ink-icon ink-icon-panel" aria-hidden />
    </button>
  )
}
