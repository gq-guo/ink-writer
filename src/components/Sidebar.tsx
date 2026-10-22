/**
 * Sidebar（spec W2 / 效果图 2）
 *
 * - 顶部：App 名 + 折叠按钮
 * - 导航：All Documents / Recent / Favorites
 * - 分组：Today / Yesterday / This Week / Earlier
 * - 条目：文档图标 + displayTitle + 相对时间
 * - 底部：+ New Document
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { invoke } from '@tauri-apps/api/core'

import { GROUP_ORDER, groupFor, relativeTime, type DateGroup } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ensureMarkdownExtension, sanitizeFileName } from '@/lib/naming'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import type { DocumentMeta } from '@/lib/types'

/** 超过该数量启用虚拟化（spec §4.3.3） */
const VIRTUALIZE_THRESHOLD = 500
/** Recent 视图显示的条数 */
const RECENT_LIMIT = 10

type ListItem =
  | { kind: 'group'; group: DateGroup }
  | { kind: 'document'; document: DocumentMeta }

interface ContextMenuState {
  x: number
  y: number
  document: DocumentMeta
}



export function Sidebar() {
  const visible = useUiStore((state) => state.sidebarVisible)
  const width = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const view = useUiStore((state) => state.sidebarView)
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const documents = useDocumentStore((state) => state.documents)
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const openDocument = useDocumentStore((state) => state.openDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const deleteDocument = useDocumentStore((state) => state.deleteDocument)
  const createDocument = useDocumentStore((state) => state.createDocument)
  const favorites = useSettingsStore((state) => state.settings.favorites)
  const updateSettings = useSettingsStore((state) => state.update)
  const focusMode = useEditorStore((state) => state.focusMode)

  const t = useT()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const visibleDocuments = useMemo(() => {
    if (view === 'favorites') {
      return documents.filter((document) => favorites.includes(document.path))
    }
    if (view === 'recent') {
      return documents.slice(0, RECENT_LIMIT)
    }
    return documents
  }, [documents, favorites, view])

  const items = useMemo<ListItem[]>(() => {
    if (view !== 'all') {
      return visibleDocuments.map((document) => ({ kind: 'document' as const, document }))
    }
    const grouped = new Map<DateGroup, DocumentMeta[]>()
    for (const document of visibleDocuments) {
      const group = groupFor(document.mtime)
      const list = grouped.get(group)
      if (list) list.push(document)
      else grouped.set(group, [document])
    }
    const result: ListItem[] = []
    for (const group of GROUP_ORDER) {
      const list = grouped.get(group)
      if (!list || list.length === 0) continue
      result.push({ kind: 'group', group })
      for (const document of list) result.push({ kind: 'document', document })
    }
    return result
  }, [visibleDocuments, view])

  // ── 拖动调整宽度 ──
  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      const onMove = (moveEvent: MouseEvent) => {
        setSidebarWidth(startWidth + (moveEvent.clientX - startX))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth, width],
  )

  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingPath])

  const commitRename = useCallback(
    (document: DocumentMeta) => {
      const name = ensureMarkdownExtension(sanitizeFileName(renameValue))
      setRenamingPath(null)
      if (!name) return
      void renameDocument(document.path, name)
    },
    [renameDocument, renameValue],
  )

  const renderItem = useCallback(
    (item: ListItem) => {
      if (item.kind === 'group') {
        return <div className="ink-group-label">{t(`sidebar.group.${item.group}`)}</div>
      }
      const document = item.document
      const isActive = activeDocument?.path === document.path
      const isRenaming = renamingPath === document.path
      const isFavorite = favorites.includes(document.path)
      return (
        <div
          className="ink-doc-item"
          data-active={isActive}
          title={`${document.dirPrefix}${document.fileName}`}
          onClick={() => {
            if (!isRenaming) void openDocument(document.path)
          }}
          onDoubleClick={() => {
            setRenamingPath(document.path)
            setRenameValue(document.fileName.replace(/\.(md|markdown|mdown|txt)$/i, ''))
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextMenu({ x: event.clientX, y: event.clientY, document })
          }}
        >
          <span className="ink-doc-row">
            <span className="ink-icon ink-icon-file ink-doc-icon" aria-hidden />
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="ink-doc-title w-full bg-transparent"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => commitRename(document)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitRename(document)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setRenamingPath(null)
                  }
                }}
              />
            ) : (
              <span className="ink-doc-title">
                {document.displayTitle || document.fileName}
              </span>
            )}
            {isFavorite ? <span className="ink-icon ink-icon-star ink-fav" aria-hidden /> : null}
          </span>
          <span className="ink-doc-time">{relativeTime(document.mtime)}</span>
        </div>
      )
    },
    [activeDocument?.path, commitRename, favorites, openDocument, renameValue, renamingPath, t],
  )

  const hidden = !visible || focusMode

  return (
    <aside className="ink-sidebar relative" data-hidden={hidden} aria-hidden={hidden}>
      <div className="ink-sidebar-head">
        <span className="ink-icon ink-icon-feather ink-brand" aria-hidden />
        <span className="ink-brand-name">ink</span>
        <button className="ink-icon-btn ink-collapse" title={t('sidebar.collapse')} onClick={toggleSidebar}>
          <span className="ink-icon ink-icon-panel" aria-hidden />
        </button>
      </div>

      <nav className="ink-sidebar-nav">
        {(
          [
            ['all', 'sidebar.all', 'ink-icon-file'],
            ['recent', 'sidebar.recent', 'ink-icon-clock'],
            ['favorites', 'sidebar.favorites', 'ink-icon-star'],
          ] as const
        ).map(([itemView, labelKey, icon]) => (
          <button
            key={itemView}
            className="ink-nav-item"
            data-active={view === itemView}
            onClick={() => setSidebarView(itemView)}
          >
            <span className={`ink-icon ${icon}`} aria-hidden />
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden py-2">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-xs" style={{ color: 'var(--secondary)' }}>
            {t(view === 'favorites' ? 'sidebar.empty.favorites' : 'sidebar.empty.library')}
          </div>
        ) : documents.length > VIRTUALIZE_THRESHOLD ? (
          <Virtuoso
            style={{ height: '100%' }}
            data={items}
            itemContent={(_index, item) => renderItem(item)}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            {items.map((item) => (
              <div key={item.kind === 'group' ? `group-${item.group}` : item.document.path}>
                {renderItem(item)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ink-sidebar-foot">
        <button className="ink-nav-item" onClick={() => void createDocument()}>
          <span className="ink-icon ink-icon-plus" aria-hidden />
          {t('sidebar.newDocument')}
        </button>
      </div>

      <div
        className="ink-sidebar-resizer"
        style={{ right: -3 }}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
      />

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          isFavorite={favorites.includes(contextMenu.document.path)}
          onClose={() => setContextMenu(null)}
          onOpen={() => {
            void openDocument(contextMenu.document.path)
            setContextMenu(null)
          }}
          onRename={() => {
            setRenamingPath(contextMenu.document.path)
            setRenameValue(contextMenu.document.fileName.replace(/\.(md|markdown|mdown|txt)$/i, ''))
            setContextMenu(null)
          }}
          onReveal={() => {
            void invoke('reveal_in_finder', { path: contextMenu.document.path })
            setContextMenu(null)
          }}
          onFavorite={() => {
            const path = contextMenu.document.path
            updateSettings({
              favorites: favorites.includes(path)
                ? favorites.filter((item) => item !== path)
                : [...favorites, path],
            })
            setContextMenu(null)
          }}
          onDelete={() => {
            void deleteDocument(contextMenu.document.path)
            setContextMenu(null)
          }}
        />
      ) : null}
    </aside>
  )
}

interface ContextMenuProps {
  state: ContextMenuState
  isFavorite: boolean
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onReveal: () => void
  onFavorite: () => void
  onDelete: () => void
}

function ContextMenu({
  state,
  isFavorite,
  onClose,
  onOpen,
  onRename,
  onReveal,
  onFavorite,
  onDelete,
}: ContextMenuProps) {
  const t = useT()
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const items: { label: string; action: () => void; icon?: string; danger?: boolean }[] = [
    { label: t('sidebar.context.open'), action: onOpen, icon: 'ink-icon-file' },
    {
      label: t(isFavorite ? 'sidebar.context.removeFavorite' : 'sidebar.context.addFavorite'),
      action: onFavorite,
      icon: 'ink-icon-star',
    },
    { label: t('sidebar.context.rename'), action: onRename, icon: 'ink-icon-file' },
    { label: t('sidebar.context.reveal'), action: onReveal, icon: 'ink-icon-folder' },
    { label: t('sidebar.context.trash'), action: onDelete, danger: true },
  ]

  return (
    <div
      className="ink-popover ink-menu"
      style={{ left: state.x, top: state.y, position: 'fixed' }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className="ink-menu-item"
          data-danger={item.danger ? 'true' : undefined}
          onClick={item.action}
        >
          {item.icon ? <span className={`ink-icon ${item.icon}`} aria-hidden /> : null}
          {item.label}
        </button>
      ))}
    </div>
  )
}
