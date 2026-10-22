/**
 * 顶栏（效果图 1 / 效果图 2）
 *
 * 左：文档图标 + 文件名（点击就地内联编辑，Finder 风格）
 * 中：Focus Mode 状态胶囊；右：搜索 / 排版 / 更多
 *
 * 注意：window.prompt 在 Tauri 的 WKWebView 里不受支持（返回 null），
 * 所有重命名入口（顶栏点击 / 更多菜单 / 命令面板）统一走内联编辑。
 */
import { useEffect, useRef, useState } from 'react'

import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { ensureMarkdownExtension, sanitizeFileName } from '@/lib/naming'
import { useT } from '@/lib/i18n'
import { editorBridge } from '@/editor/bridge'
import { TypographyPopover } from './TypographyPopover'
import { MoreMenu } from './MoreMenu'

export function TopBar() {
  const t = useT()
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const focusMode = useEditorStore((state) => state.focusMode)
  const typewriterMode = useSettingsStore((state) => state.settings.typewriterMode)
  const setSidebarVisible = useUiStore((state) => state.setSidebarVisible)
  void setSidebarVisible
  const showQuickOpen = useUiStore((state) => state.showQuickOpen)
  const renameSignal = useUiStore((state) => state.renameSignal)

  const [typographyOpen, setTypographyOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  // 点击菜单外部时关闭
  useEffect(() => {
    if (!menuOpen && !typographyOpen) return
    const onDown = (event: MouseEvent) => {
      if (moreRef.current && moreRef.current.contains(event.target as Node)) return
      if ((event.target as HTMLElement | null)?.closest('.ink-popover')) return
      setMenuOpen(false)
      setTypographyOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen, typographyOpen])

  // ── 文件名内联编辑 ──
  const [editing, setEditing] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  /** 防重入：Enter 提交后 input 卸载会再触发一次 blur，导致 rename 跑两遍 */
  const committingRef = useRef(false)

  const startEditing = () => {
    if (!activeDocument) return
    committingRef.current = false
    setNameValue(activeDocument.fileName.replace(/\.(md|markdown|mdown|txt)$/i, ''))
    setEditing(true)
  }

  // 命令 / 菜单触发（renameSignal 变化）；延迟到下一拍执行避免级联渲染告警
  useEffect(() => {
    if (renameSignal === 0) return
    const timer = setTimeout(() => startEditing(), 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal])

  useEffect(() => {
    if (editing) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [editing])

  const commitRename = () => {
    if (committingRef.current) return
    committingRef.current = true
    setEditing(false)
    editorBridge.focus()
    if (!activeDocument) return
    const name = ensureMarkdownExtension(sanitizeFileName(nameValue))
    if (!name || name === activeDocument.fileName) return
    void renameDocument(activeDocument.path, name)
  }

  const fileName = activeDocument?.fileName ?? ''

  return (
    <div className="ink-topbar">
      <div className="ink-topbar-left">
        <span className="ink-icon ink-icon-file" aria-hidden />
        {editing ? (
          <input
            ref={nameInputRef}
            className="ink-topbar-input"
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
                editorBridge.focus()
              }
            }}
          />
        ) : fileName ? (
          <button className="ink-topbar-name" title={t('topbar.rename')} onClick={startEditing}>
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
