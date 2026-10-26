/**
 * Sidebar（spec W2）
 *
 * 所有内容共用一条左边缘；当前项是一块很淡的圆角底色，不用彩色选中块：
 * - 顶部：只有一个安静的 Ink 字标，不配图标（折叠用正文左下角的按钮或 ⌥\）
 * - 导航：Documents 之下的 All / Recent / Favorites，右侧是数量（点 Documents 折叠）
 * - 文件夹：标题右侧 + 新建；按层级缩进，点一个只看它（含子文件夹）里的文档，新建文档也放进去
 * - 标签：库里有 #标签 时出现；点一个只看用到它的文档（见 SidebarSections）
 * - 分组：Today / Yesterday / Last 7 days / Earlier，小号淡色，不做全大写
 * - 条目：单行，标题 + 收藏星标 + 右对齐的短时间；不加文档图标
 * - 底部：+ New Document
 * - 右键：App 里是 macOS 原生菜单；浏览器 / 测试里退回页面内菜单。菜单开着时被右键的条目带一圈细框（同 Finder）。
 *   「移到」子菜单把文档移到别的文件夹
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { invoke } from '@tauri-apps/api/core'

import { FolderSection, TagSection } from './SidebarSections'
import { showNativeContextMenu, type ContextMenuEntry } from '@/lib/contextMenu'
import { isInFolder, listFolders } from '@/lib/folders'
import { GROUP_ORDER, groupFor, listTime, type DateGroup } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ensureMarkdownExtension, markdownExtensionOf, sanitizeFileName } from '@/lib/naming'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { newDocumentFolder, useUiStore } from '@/stores/uiStore'
import type { DocumentMeta, TagCount } from '@/lib/types'

/** 超过该数量启用虚拟化（spec §4.3.3） */
const VIRTUALIZE_THRESHOLD = 500
/** Recent 视图显示的条数 */
const RECENT_LIMIT = 10
/** 文档变化 / 保存后等这么久再重新统计标签（外部修改会连着触发好几次刷新）；短一点，移动后标签视图少闪 */
const TAGS_REFRESH_DEBOUNCE_MS = 250

type ListItem =
  | { kind: 'group'; group: DateGroup }
  | { kind: 'document'; document: DocumentMeta }

interface ContextMenuState {
  x: number
  y: number
  entries: ContextMenuEntry[]
}



export function Sidebar() {
  const visible = useUiStore((state) => state.sidebarVisible)
  const width = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const view = useUiStore((state) => state.sidebarView)
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const folder = useUiStore((state) => state.sidebarFolder)
  const openFolder = useUiStore((state) => state.openFolder)
  const sidebarTag = useUiStore((state) => state.sidebarTag)
  const openTag = useUiStore((state) => state.openTag)
  const documents = useDocumentStore((state) => state.documents)
  const folderPrefixes = useDocumentStore((state) => state.folders)
  const libraryPath = useDocumentStore((state) => state.libraryPath)
  /** 当前文档刚保存完：自己写进去的 #标签 也要统计（保存不会刷新文档列表） */
  const justSaved = useDocumentStore((state) => state.saveState === 'saved')
  const createFolder = useDocumentStore((state) => state.createFolder)
  const moveDocument = useDocumentStore((state) => state.moveDocument)
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const openDocument = useDocumentStore((state) => state.openDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const deleteDocument = useDocumentStore((state) => state.deleteDocument)
  const createDocument = useDocumentStore((state) => state.createDocument)
  const favorites = useSettingsStore((state) => state.settings.favorites)
  const updateSettings = useSettingsStore((state) => state.update)
  const focusMode = useEditorStore((state) => state.focusMode)

  const t = useT()
  const [navOpen, setNavOpen] = useState(true)
  /** 全库标签，连同它属于哪个文档库：换库后旧库的标签不算数 */
  const [tagsState, setTagsState] = useState<{ root: string; tags: TagCount[] } | null>(null)
  /** null = 当前库的标签还没读到（这时不判断「看着的标签没了」） */
  const tags = tagsState?.root === libraryPath ? tagsState.tags : null
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  /** 右键菜单开着时针对的条目（画一圈细框，看得出菜单作用在哪一篇上） */
  const [contextPath, setContextPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const counts = useMemo(
    () => ({
      all: documents.length,
      recent: Math.min(RECENT_LIMIT, documents.length),
      favorites: documents.filter((document) => favorites.includes(document.path)).length,
    }),
    [documents, favorites],
  )

  const folders = useMemo(() => listFolders(documents, folderPrefixes), [documents, folderPrefixes])

  // 标签要读全文：文档列表变了（新建、移动、外部修改）或当前文档刚保存完之后，防抖再统计一次，在后台线程扫
  useEffect(() => {
    if (!libraryPath) return
    let cancelled = false
    const timer = setTimeout(() => {
      const done = (list: TagCount[]) => {
        if (!cancelled) setTagsState({ root: libraryPath, tags: list })
      }
      void invoke<TagCount[]>('list_tags', { root: libraryPath })
        .then((list) => done(list ?? []))
        .catch(() => done([]))
    }, TAGS_REFRESH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [documents, libraryPath, justSaved])

  const activeTag = useMemo(
    () => tags?.find((tag) => tag.tag.toLowerCase() === sidebarTag.toLowerCase()) ?? null,
    [sidebarTag, tags],
  )

  // 看着的文件夹 / 标签没了（文档都删了、移走了、标签改掉了）：回到全部
  useEffect(() => {
    if (view === 'folder' && !folders.some((entry) => entry.prefix === folder)) setSidebarView('all')
    if (view === 'tag' && tags !== null && !activeTag) setSidebarView('all')
  }, [activeTag, folder, folders, setSidebarView, tags, view])

  /** 按日期分组显示（全部、某个文件夹、某个标签）；Recent / Favorites 是平铺列表 */
  const byDate = view === 'all' || view === 'folder' || view === 'tag'

  const visibleDocuments = useMemo(() => {
    if (view === 'folder') {
      return documents.filter((document) => isInFolder(document, folder))
    }
    if (view === 'tag') {
      const paths = new Set(activeTag?.paths ?? [])
      return documents.filter((document) => paths.has(document.path))
    }
    if (view === 'favorites') {
      return documents.filter((document) => favorites.includes(document.path))
    }
    if (view === 'recent') {
      return documents.slice(0, RECENT_LIMIT)
    }
    return documents
  }, [activeTag, documents, favorites, folder, view])

  const items = useMemo<ListItem[]>(() => {
    if (!byDate) {
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
  }, [byDate, visibleDocuments])

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
      const name = ensureMarkdownExtension(
        sanitizeFileName(renameValue),
        markdownExtensionOf(document.fileName),
      )
      setRenamingPath(null)
      if (!name) return
      void renameDocument(document.path, name)
    },
    [renameDocument, renameValue],
  )

  /** 「移到」子菜单：库根目录 + 各文件夹（不含文档现在所在的）；没有别处可去时不显示 */
  const moveEntries = useCallback(
    (document: DocumentMeta): ContextMenuEntry[] => {
      const targets = [
        { prefix: '', label: t('sidebar.libraryRoot') },
        ...folders.map((entry) => ({ prefix: entry.prefix, label: entry.prefix.replace(/\/$/, '') })),
      ].filter((target) => target.prefix !== document.dirPrefix)
      if (targets.length === 0) return []
      return [
        {
          label: t('sidebar.context.moveTo'),
          children: targets.map((target) => ({
            label: target.label,
            action: () => void moveDocument(document.path, target.prefix),
          })),
        },
      ]
    },
    [folders, moveDocument, t],
  )

  const contextEntries = useCallback(
    (document: DocumentMeta): ContextMenuEntry[] => {
      const isFavorite = favorites.includes(document.path)
      // 没有「打开」：单击条目就已经打开了（Finder 需要它是因为单击只是选中）
      return [
        {
          label: t(isFavorite ? 'sidebar.context.removeFavorite' : 'sidebar.context.addFavorite'),
          action: () =>
            updateSettings({
              favorites: isFavorite
                ? favorites.filter((item) => item !== document.path)
                : [...favorites, document.path],
            }),
        },
        {
          label: t('sidebar.context.rename'),
          action: () => {
            setRenamingPath(document.path)
            setRenameValue(document.fileName.replace(/\.(md|markdown|mdown|txt)$/i, ''))
          },
        },
        ...moveEntries(document),
        {
          label: t('sidebar.context.reveal'),
          action: () => void invoke('reveal_in_finder', { path: document.path }),
        },
        'separator',
        { label: t('sidebar.context.trash'), action: () => void deleteDocument(document.path), danger: true },
      ]
    },
    [deleteDocument, favorites, moveEntries, t, updateSettings],
  )

  const openContextMenu = useCallback(
    (event: React.MouseEvent, document: DocumentMeta) => {
      event.preventDefault()
      const entries = contextEntries(document)
      const { clientX: x, clientY: y } = event
      setContextPath(document.path)
      void showNativeContextMenu(entries).then((shown) => {
        if (shown) setContextPath(null)
        else setContextMenu({ x, y, entries })
      })
    },
    [contextEntries],
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
          data-context={contextPath === document.path || undefined}
          title={`${document.dirPrefix}${document.fileName}`}
          onClick={() => {
            if (!isRenaming) void openDocument(document.path)
          }}
          onDoubleClick={() => {
            setRenamingPath(document.path)
            setRenameValue(document.fileName.replace(/\.(md|markdown|mdown|txt)$/i, ''))
          }}
          onContextMenu={(event) => openContextMenu(event, document)}
        >
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
            <span className="ink-doc-title">{document.displayTitle || document.fileName}</span>
          )}
          {isFavorite ? <span className="ink-icon ink-icon-star ink-fav" aria-hidden /> : null}
          <span className="ink-doc-time">{listTime(document.mtime, byDate)}</span>
        </div>
      )
    },
    [
      activeDocument?.path,
      commitRename,
      contextPath,
      favorites,
      openContextMenu,
      openDocument,
      renameValue,
      renamingPath,
      t,
      byDate,
    ],
  )

  const hidden = !visible || focusMode

  return (
    <aside className="ink-sidebar relative" data-hidden={hidden} aria-hidden={hidden}>
      <div className="ink-sidebar-head">
        <span className="ink-brand-name">Ink</span>
      </div>

      <nav className="ink-sidebar-nav">
        <button
          className="ink-nav-section"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          {t('sidebar.documents')}
          <span className="ink-icon ink-icon-chevron" data-open={navOpen} aria-hidden />
        </button>
        {navOpen
          ? (
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
                <span className="ink-nav-count">{counts[itemView]}</span>
              </button>
            ))
          : null}
        <FolderSection
          folders={folders}
          activeFolder={view === 'folder' ? folder : null}
          onOpen={openFolder}
          onCreate={createFolder}
        />
        <TagSection
          tags={tags ?? []}
          activeTag={view === 'tag' && activeTag ? activeTag.tag.toLowerCase() : null}
          onOpen={openTag}
        />
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
        <button className="ink-new-doc" onClick={() => void createDocument(newDocumentFolder())}>
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
          onClose={() => {
            setContextMenu(null)
            setContextPath(null)
          }}
        />
      ) : null}
    </aside>
  )
}

interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
}

/** 菜单离窗口边缘至少留这么多 */
const MENU_EDGE_GAP = 8

/** 页面内右键菜单（浏览器 / 测试里用；App 里走原生菜单） */
function ContextMenu({ state, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: state.x, top: state.y })

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  // 量出菜单尺寸后收进窗口：靠右 / 靠下右键时往左 / 往上翻，不被裁掉
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(MENU_EDGE_GAP, Math.min(state.x, window.innerWidth - width - MENU_EDGE_GAP)),
      top: Math.max(MENU_EDGE_GAP, Math.min(state.y, window.innerHeight - height - MENU_EDGE_GAP)),
    })
  }, [state.x, state.y])

  return (
    <div
      ref={ref}
      className="ink-popover ink-menu ink-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {state.entries.map((entry, index) => (
        // 用序号做 key：「移到」里文件夹可能和别的条目同名
        <MenuEntry key={index} entry={entry} onClose={onClose} />
      ))}
    </div>
  )
}

/** 页面内菜单的一项；子菜单展开成一个小标题加一组缩进的条目 */
function MenuEntry({ entry, onClose, indent = false }: { entry: ContextMenuEntry; onClose: () => void; indent?: boolean }) {
  if (entry === 'separator') return <div className="ink-menu-sep" role="separator" />
  if ('children' in entry) {
    return (
      <div role="group" aria-label={entry.label}>
        <div className="ink-menu-label">{entry.label}</div>
        {entry.children.map((child, index) => (
          <MenuEntry key={index} entry={child} onClose={onClose} indent />
        ))}
      </div>
    )
  }
  return (
    <button
      className="ink-menu-item"
      role="menuitem"
      data-danger={entry.danger ? 'true' : undefined}
      data-indent={indent || undefined}
      onClick={() => {
        onClose()
        entry.action()
      }}
    >
      {entry.label}
    </button>
  )
}
