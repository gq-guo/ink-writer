/**
 * 侧栏导航下面的两块：文件夹、标签
 *
 * - 文件夹：始终显示标题（右侧 + 在库根目录新建），按层级缩进，数量含子文件夹
 * - 新建：+ 永远建在库根目录，方便建多个并列的父文件夹；在某个文件夹上右键「新建子文件夹」
 *   才建到它里面，输入框跟着插在该文件夹下面
 * - 重命名：双击文件夹，或右键「重命名…」；输入框原地替换名字，回车 / 失焦提交，Esc 取消
 * - 标签：库里有标签时才出现，数量是用到它的文档数；点一个只看这些文档
 * 两块列表各自最多占一段高度、超出自己滚动，不把下面的文档列表挤出去
 */
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { showNativeContextMenu, type ContextMenuEntry } from '@/lib/contextMenu'
import type { FolderEntry } from '@/lib/folders'
import { useT } from '@/lib/i18n'
import type { TagCount } from '@/lib/types'

interface FolderSectionProps {
  folders: FolderEntry[]
  /** 当前选中的文件夹（dirPrefix）；不在文件夹视图时为 null */
  activeFolder: string | null
  /** 库根目录（「在访达中显示」拼绝对路径） */
  libraryPath: string
  onOpen: (prefix: string) => void
  /** 新建：parentPrefix 为 "" 表示库根目录；返回新文件夹的 dirPrefix（失败为 null） */
  onCreate: (name: string, parentPrefix: string) => Promise<string | null>
  /** 重命名：返回新文件夹的 dirPrefix（失败为 null） */
  onRename: (prefix: string, newName: string) => Promise<string | null>
}

export function FolderSection({
  folders,
  activeFolder,
  libraryPath,
  onOpen,
  onCreate,
  onRename,
}: FolderSectionProps) {
  const t = useT()
  const [open, setOpen] = useState(true)
  /** 正在输入新文件夹名：值是父文件夹（"" = 库根目录） */
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [name, setName] = useState('')
  /** 正在重命名的文件夹（dirPrefix） */
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  /** 右键菜单开着时针对的文件夹（画一圈细框） */
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  /** 回车提交后输入框卸载还会触发一次 blur：同一次输入只提交一次 */
  const createCommittedRef = useRef(false)
  const renameCommittedRef = useRef(false)

  useEffect(() => {
    if (creatingIn !== null) createInputRef.current?.focus()
  }, [creatingIn])

  useEffect(() => {
    if (renamingFolder !== null) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renamingFolder])

  const startCreate = (parentPrefix: string) => {
    setOpen(true)
    setName('')
    createCommittedRef.current = false
    setCreatingIn(parentPrefix)
  }

  const commitCreate = async () => {
    const parent = creatingIn
    const trimmed = name.trim()
    if (createCommittedRef.current) return
    createCommittedRef.current = true
    setCreatingIn(null)
    if (parent === null || !trimmed) return
    await onCreate(trimmed, parent)
  }

  const startRename = (entry: FolderEntry) => {
    setRenamingFolder(entry.prefix)
    setRenameValue(entry.name)
    renameCommittedRef.current = false
  }

  const commitRename = async (prefix: string, previousName: string) => {
    const trimmed = renameValue.trim()
    if (renameCommittedRef.current) return
    renameCommittedRef.current = true
    setRenamingFolder(null)
    if (!trimmed || trimmed === previousName) return
    await onRename(prefix, trimmed)
  }

  const folderPath = (prefix: string) =>
    `${libraryPath.replace(/\/+$/, '')}/${prefix.replace(/\/+$/, '')}`

  const openFolderMenu = async (event: React.MouseEvent, entry: FolderEntry) => {
    event.preventDefault()
    event.stopPropagation()
    const entries: ContextMenuEntry[] = [
      { label: t('sidebar.context.rename'), action: () => startRename(entry) },
      { label: t('sidebar.context.newSubfolder'), action: () => startCreate(entry.prefix) },
      'separator',
      {
        label: t('sidebar.context.reveal'),
        action: () => void invoke('reveal_in_finder', { path: folderPath(entry.prefix) }),
      },
    ]
    const { clientX: x, clientY: y } = event
    setContextPrefix(entry.prefix)
    void showNativeContextMenu(entries).then((shown) => {
      if (shown) setContextPrefix(null)
      else setContextMenu({ x, y, entries })
    })
  }

  const parentDepth = creatingIn ? folders.find((entry) => entry.prefix === creatingIn)?.depth ?? -1 : -1
  /** 新文件夹输入框插在父文件夹下面（根目录时在最上面） */
  const insertAfter = creatingIn ? folders.findIndex((entry) => entry.prefix === creatingIn) : -1

  const input =
    creatingIn !== null ? (
      <div className="ink-nav-item" style={{ paddingLeft: `calc(12px + ${parentDepth + 1} * 14px)` }}>
        <span className="ink-icon ink-icon-folder" aria-hidden />
        <input
          ref={createInputRef}
          className="w-full bg-transparent"
          aria-label={t('sidebar.newFolder')}
          placeholder={t('sidebar.newFolderPlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void commitCreate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commitCreate()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              createCommittedRef.current = true
              setCreatingIn(null)
            }
          }}
        />
      </div>
    ) : null

  return (
    <>
      <div className="ink-nav-section-row ink-nav-section-sub">
        <button className="ink-nav-section" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {t('sidebar.folders')}
          <span className="ink-icon ink-icon-chevron" data-open={open} aria-hidden />
        </button>
        <button
          className="ink-nav-add"
          title={t('sidebar.newFolder')}
          aria-label={t('sidebar.newFolder')}
          onClick={() => startCreate('')}
        >
          <span className="ink-icon ink-icon-plus" aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="ink-nav-scroll">
          {insertAfter === -1 ? input : null}
          {folders.map((entry, index) => (
            <FolderRow
              key={entry.prefix}
              entry={entry}
              active={activeFolder === entry.prefix}
              context={contextPrefix === entry.prefix}
              renameInput={
                renamingFolder === entry.prefix ? (
                  <div
                    className="ink-nav-item"
                    data-context={contextPrefix === entry.prefix || undefined}
                    style={{ paddingLeft: `calc(12px + ${entry.depth} * 14px)` }}
                  >
                    <span className="ink-icon ink-icon-folder" aria-hidden />
                    <input
                      ref={renameInputRef}
                      className="w-full bg-transparent"
                      aria-label={entry.name}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => void commitRename(entry.prefix, entry.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void commitRename(entry.prefix, entry.name)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          renameCommittedRef.current = true
                          setRenamingFolder(null)
                        }
                      }}
                    />
                  </div>
                ) : null
              }
              onOpen={onOpen}
              onStartRename={() => startRename(entry)}
              onContextMenu={(event) => void openFolderMenu(event, entry)}
              after={index === insertAfter ? input : null}
            />
          ))}
        </div>
      ) : null}
      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          onClose={() => {
            setContextMenu(null)
            setContextPrefix(null)
          }}
        />
      ) : null}
    </>
  )
}

function FolderRow({
  entry,
  active,
  context,
  renameInput,
  onOpen,
  onStartRename,
  onContextMenu,
  after,
}: {
  entry: FolderEntry
  active: boolean
  context: boolean
  renameInput: React.ReactNode
  onOpen: (prefix: string) => void
  onStartRename: () => void
  onContextMenu: (event: React.MouseEvent) => void
  after: React.ReactNode
}) {
  return (
    <>
      {renameInput ?? (
        <button
          className="ink-nav-item"
          data-active={active}
          data-context={context || undefined}
          title={entry.prefix}
          style={{ paddingLeft: `calc(12px + ${entry.depth} * 14px)` }}
          onClick={() => onOpen(entry.prefix)}
          onDoubleClick={onStartRename}
          onContextMenu={onContextMenu}
        >
          <span className="ink-icon ink-icon-folder" aria-hidden />
          <span className="truncate">{entry.name}</span>
          <span className="ink-nav-count">{entry.count}</span>
        </button>
      )}
      {after}
    </>
  )
}

interface TagSectionProps {
  tags: TagCount[]
  /** 当前选中的标签（小写）；不在标签视图时为 null */
  activeTag: string | null
  onOpen: (tag: string) => void
}

export function TagSection({ tags, activeTag, onOpen }: TagSectionProps) {
  const t = useT()
  const [open, setOpen] = useState(true)
  if (tags.length === 0) return null
  return (
    <>
      <button
        className="ink-nav-section ink-nav-section-sub"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('sidebar.tags')}
        <span className="ink-icon ink-icon-chevron" data-open={open} aria-hidden />
      </button>
      {open ? (
        <div className="ink-nav-scroll">
          {tags.map((tag) => (
            <button
              key={tag.tag.toLowerCase()}
              className="ink-nav-item"
              data-active={activeTag === tag.tag.toLowerCase()}
              title={`#${tag.tag}`}
              onClick={() => onOpen(tag.tag)}
            >
              <span className="ink-nav-hash" aria-hidden>
                #
              </span>
              <span className="truncate">{tag.tag}</span>
              <span className="ink-nav-count">{tag.paths.length}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
