/**
 * 顶栏
 *
 * 左：文件名（点击就地内联编辑，Finder 风格）；和正文里看得到的标题同名时不显示，避免重复
 * 中：Focus Mode 状态胶囊；右：搜索 / 排版 / 更多
 *
 * 文件名与右侧工具默认隐藏，鼠标移到窗口顶部才慢慢浮现（⌘K 覆盖绝大多数操作）；
 * 模式胶囊是状态提示，始终可见。
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

/** 鼠标进入窗口顶部这么高的范围内时显示工具 */
const REVEAL_ZONE_PX = 76
/** 离开到这么低以下才收起（留一段缓冲，鼠标在边界附近晃动时不闪） */
const HIDE_ZONE_PX = 120

export function TopBar() {
  const t = useT()
  const [revealed, setRevealed] = useState(false)
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const focusMode = useEditorStore((state) => state.focusMode)
  const typewriterMode = useSettingsStore((state) => state.settings.typewriterMode)
  const showQuickOpen = useUiStore((state) => state.showQuickOpen)
  const renameSignal = useUiStore((state) => state.renameSignal)
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)

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

  // 鼠标靠近顶部时显示；菜单 / 排版弹层 / 重命名期间保持显示
  const pinned = menuOpen || typographyOpen || editing
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (event.clientY <= REVEAL_ZONE_PX) setRevealed(true)
      else if (event.clientY > HIDE_ZONE_PX) setRevealed(false)
    }
    const onLeave = () => setRevealed(false)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const fileName = activeDocument?.fileName ?? ''
  // 正文里能看到标题时（首行 H1，或文档头的文件名大标题，后者与 EditorHost 的显示条件一致），
  // 文件名和它同名就是重复信息；重命名仍可走侧栏双击 / 更多菜单 / 命令面板
  const titleVisible = !!activeDocument && (activeDocument.titleFromH1 || (sidebarVisible && !focusMode))
  const duplicatesTitle =
    titleVisible && fileName.replace(/\.(md|markdown|mdown|txt)$/i, '') === activeDocument?.displayTitle

  return (
    <div className="ink-topbar" data-revealed={revealed || pinned}>
      <div className="ink-topbar-left">
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
        ) : fileName && !duplicatesTitle ? (
          <button
            className="ink-topbar-name"
            title={`${activeDocument?.path ?? ''} — ${t('topbar.rename')}`}
            onClick={startEditing}
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

      <div className="ink-topbar-right" ref={moreRef}>
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

        <div className="ink-popover-anchor">
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
