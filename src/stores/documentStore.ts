/**
 * 文档 store（spec §5.3 / §12）
 *
 * 职责：
 * - 扫描库目录、创建 / 打开 / 重命名 / 删除文档
 * - 自动保存状态机（idle → dirty → saving → saved → idle）
 * - 外部变更处理（静默刷新 / 三选一冲突对话框）
 *
 * 注意（spec §6.3）：activeDocument.content 只保存「打开时的初始文本」，
 * 正文权威在 CM6 的 EditorState；编辑中的文本保存在模块级的 pendingText 中，
 * 避免每次击键都触发 React 重渲染。
 */
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type {
  ConflictChoice,
  Document,
  DocumentMeta,
  ReadDocumentResult,
  SaveState,
  WriteResult,
} from '@/lib/types'
import { extractDisplayTitle, extractTitleInfo, titleComesFromH1 } from '@/lib/title'
import { ensureMarkdownExtension, sanitizeFileName } from '@/lib/naming'
import { editorBridge } from '@/editor/bridge'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'
import { t } from '@/lib/i18n'

/** 自动保存防抖（spec §12.1） */
const AUTOSAVE_DEBOUNCE_MS = 500
/** 写入失败重试间隔 */
const RETRY_INTERVAL_MS = 5000
/** 最大重试次数 */
const MAX_RETRIES = 3
/** saved 状态保持时长 */
const SAVED_LINGER_MS = 1500
/** 标题重算防抖 */
const TITLE_REFRESH_DEBOUNCE_MS = 1000

export interface FsEventPayload {
  path: string
  kind: string
}

interface DocumentState {
  documents: DocumentMeta[]
  activeDocument: Document | null
  saveState: SaveState
  libraryPath: string
  bootstrapped: boolean

  bootstrapLibrary: (libraryPath: string) => Promise<void>
  /** 更换文档库位置：复制现有文档到新目录（不删旧库），再切换过去 */
  changeLibrary: (newPath: string) => Promise<void>
  refreshDocuments: () => Promise<void>
  createDocument: () => Promise<void>
  openDocument: (path: string, revealRange?: [number, number]) => Promise<void>
  onEditorChange: (text: string) => void
  flushSave: () => Promise<void>
  renameDocument: (path: string, newName: string) => Promise<void>
  deleteDocument: (path: string) => Promise<void>
  resolveConflict: (choice: ConflictChoice) => Promise<void>
  handleExternalEvent: (event: FsEventPayload) => Promise<void>
}

/** 待写入磁盘的内容（null = 无待写内容） */
let pendingText: string | null = null
/** 文档打开序号：驱动编辑器重建的唯一信号（rename 只改元数据，不应重建） */
let openSeqCounter = 0
/** 自动保存暂停计数器（>0 时忽略一切变更；selftest 等临时操作使用） */
let autosavePauseCount = 0

/** 暂停/恢复自动保存；必须成对调用（try/finally） */
export function pauseAutosave(): void {
  autosavePauseCount += 1
}
export function resumeAutosave(): void {
  autosavePauseCount = Math.max(0, autosavePauseCount - 1)
}
/** 最近一次成功写入的内容 */
let lastWrittenText = ''
/**
 * 活动文档的最新全文（含未落盘部分）。
 * pendingText 在写入时会被置空、activeDocument.content 只是打开时的文本，
 * 标题重算 / 重命名都必须读这里，否则改了 H1 列表也不会更新。
 */
let latestText = ''
/** 写入队列，保证同一时间只有一个写入任务 */
let writeChain: Promise<void> = Promise.resolve()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let titleTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0

function clearSaveTimer() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function isConflictError(error: unknown): { diskMtime: number } | null {
  if (!error || typeof error !== 'object') return null
  const kind = (error as { kind?: unknown }).kind
  if (kind !== 'mtimeConflict') return null
  const data = (error as { data?: unknown }).data
  if (data && typeof data === 'object' && 'diskMtime' in data) {
    return { diskMtime: Number((data as { diskMtime: number }).diskMtime) }
  }
  return { diskMtime: 0 }
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data: unknown }).data
    if (typeof data === 'string') return data
  }
  return '未知错误'
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  activeDocument: null,
  saveState: 'idle',
  libraryPath: '',
  bootstrapped: false,

  /**
   * 扫描库目录 + 启动 watch（spec §5.3 / §12.3）
   */
  bootstrapLibrary: async (libraryPath: string) => {
    // 库目录被删 / 改名 → 提示并回到引导页（spec §22.2）
    const exists = await invoke<boolean>('path_exists', { path: libraryPath })
    if (!exists) {
      useUiStore
        .getState()
        .pushToast({ message: `${t('toast.libraryMissing')}: ${libraryPath}`, kind: 'error' })
      useSettingsStore.getState().setLibraryPath('')
      return
    }

    set({ libraryPath })
    try {
      await invoke('set_watch_path', { path: libraryPath })
    } catch (error) {
      // watch 失效时降级为「保存前 mtime 检查」（乐观锁兜底）
      useUiStore
        .getState()
        .pushToast({ message: `${t('toast.watchFailed')}: ${errorMessage(error)}`, kind: 'error' })
    }
    await get().refreshDocuments()
    set({ bootstrapped: true })
  },

  changeLibrary: async (newPath: string) => {
    const oldPath = get().libraryPath
    if (!newPath || newPath === oldPath) return
    await get().flushSave()
    try {
      await invoke('ensure_directory', { path: newPath })
      if (oldPath) {
        const stats = await invoke<{ copied: number; skipped: number }>('copy_library', {
          fromDir: oldPath,
          toDir: newPath,
        })
        if (stats.copied > 0 || stats.skipped > 0) {
          useUiStore
            .getState()
            .pushToast({ message: t('toast.libraryMoved', { count: stats.copied }), kind: 'info' })
        }
      }
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
      return
    }

    useSettingsStore.getState().update({ libraryPath: newPath })
    set({ libraryPath: newPath })
    try {
      await invoke('set_watch_path', { path: newPath })
    } catch {
      /* watch 失败不阻断，乐观锁兜底 */
    }
    await get().refreshDocuments()
    const state = get()
    if (state.documents.length === 0) {
      await state.createDocument()
    } else {
      await state.openDocument(state.documents[0]!.path)
    }
  },

  refreshDocuments: async () => {
    const { libraryPath } = get()
    if (!libraryPath) return
    try {
      const documents = await invoke<DocumentMeta[]>('list_documents', { root: libraryPath })
      set({ documents })
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  },

  /**
   * 新建文档：立即创建文件并打开（R10）
   */
  createDocument: async () => {
    const { libraryPath } = get()
    if (!libraryPath) return
    await get().flushSave()
    try {
      const meta = await invoke<DocumentMeta>('create_document', {
        dir: libraryPath,
        baseName: 'Untitled',
      })
      await get().refreshDocuments()
      await get().openDocument(meta.path)
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  },

  /**
   * 打开文档
   */
  openDocument: async (path: string, revealRange?: [number, number]) => {
    await get().flushSave()
    try {
      const result = await invoke<ReadDocumentResult>('read_document', { path })
      const fileName = path.split('/').pop() ?? path
      const document: Document = {
        path,
        fileName,
        dirPrefix: '',
        mtime: result.mtime,
        size: result.size,
        content: result.content,
        originalEncoding: (result.encoding as Document['originalEncoding']) ?? 'unknown',
        displayTitle: extractDisplayTitle(result.content, fileName),
        titleFromH1: titleComesFromH1(result.content),
        openSeq: ++openSeqCounter,
      }
      pendingText = null
      lastWrittenText = result.content
      latestText = result.content
      set({ activeDocument: document, saveState: 'idle' })
      useEditorStore.getState().setHasContent(result.content.trim().length > 0)
      clearRetryTimer()

      if (result.encoding === 'gbk') {
        useUiStore
          .getState()
          .pushToast({ message: '已按 GBK 解码，保存时将转为 UTF-8', kind: 'info' })
      }

      if (revealRange) {
        // 等编辑器装载完文档后再定位
        requestAnimationFrame(() => editorBridge.revealRange(revealRange))
      }
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  },

  /**
   * 编辑器内容变化：防抖入口（spec §5.3）
   */
  onEditorChange: (text: string) => {
    if (autosavePauseCount > 0) return
    useEditorStore.getState().setHasContent(text.trim().length > 0)
    pendingText = text
    latestText = text
    set({ saveState: 'dirty' })
    clearSaveTimer()
    clearRetryTimer()
    retryCount = 0
    saveTimer = setTimeout(() => {
      void get().flushSave()
    }, AUTOSAVE_DEBOUNCE_MS)

    // 标题重算（spec §7.3：编辑中防抖 1s 重算）
    if (titleTimer) clearTimeout(titleTimer)
    titleTimer = setTimeout(() => {
      titleTimer = null
      refreshActiveTitle()
    }, TITLE_REFRESH_DEBOUNCE_MS)
  },

  /**
   * 立即落盘（⌘S / 切换文档 / 失焦 / 退出）
   */
  flushSave: async () => {
    clearSaveTimer()
    writeChain = writeChain.then(doWrite, doWrite)
    return writeChain
  },

  renameDocument: async (path: string, newName: string) => {
    const safeName = ensureMarkdownExtension(sanitizeFileName(newName))
    if (!safeName) return
    try {
      const newPath = await invoke<string>('rename_document', { path, newName: safeName })
      await get().refreshDocuments()
      const active = get().activeDocument
      if (active && active.path === path) {
        set({
          activeDocument: {
            ...active,
            path: newPath,
            fileName: safeName,
            displayTitle: extractDisplayTitle(latestText, safeName),
            titleFromH1: titleComesFromH1(latestText),
          },
        })
      }
      // 收藏里存的是路径，rename 后同步，否则收藏会「丢失」
      const settings = useSettingsStore.getState().settings
      if (settings.favorites.includes(path)) {
        useSettingsStore.getState().update({
          favorites: settings.favorites.map((item) => (item === path ? newPath : item)),
        })
      }
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  },

  deleteDocument: async (path: string) => {
    try {
      await invoke('delete_document', { path })
      await get().refreshDocuments()
      const active = get().activeDocument
      if (active && active.path === path) {
        // 活动文档被删除：保留内存内容与 activeDocument —— 有未保存修改时
        // 下次 flush 会重建文件（Rust 侧对不存在的文件跳过 mtime 检查）。
        // 注意：绝不能在这里清空 activeDocument，否则待写内容永远丢失。
        useUiStore.getState().pushToast({ message: t('toast.trashed'), kind: 'info' })
      }
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  },

  /**
   * 冲突三选一（spec §12.3）
   */
  resolveConflict: async (choice: ConflictChoice) => {
    const conflict = useEditorStore.getState().conflict
    const active = get().activeDocument
    if (!conflict || !active) return

    useEditorStore.getState().clearConflict()

    if (choice === 'keep-mine') {
      // 以内存内容强制写盘（忽略乐观锁）
      pendingText = editorBridge.getContent() || pendingText
      set({ saveState: 'dirty' })
      clearSaveTimer()
      writeChain = writeChain.then(() => writeActiveDocument(null), () => writeActiveDocument(null))
      await writeChain
      return
    }

    if (choice === 'save-copy') {
      const directory = active.path.slice(0, active.path.lastIndexOf('/'))
      const stem = active.fileName.replace(/\.(md|markdown|mdown|txt)$/i, '')
      const copyPath = `${directory}/${stem} (Conflicted Copy).md`
      try {
        await invoke('write_text_file', {
          path: copyPath,
          content: editorBridge.getContent() || active.content,
        })
      } catch (error) {
        useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        return
      }
    }

    // load-disk / save-copy：丢弃内存未保存部分，加载磁盘版本
    pendingText = null
    lastWrittenText = conflict.diskContent
    latestText = conflict.diskContent
    editorBridge.setContent(conflict.diskContent, { preserveSelection: true })
    set((state) => ({
      activeDocument: state.activeDocument
        ? {
            ...state.activeDocument,
            content: conflict.diskContent,
            mtime: conflict.diskMtime,
            displayTitle: extractDisplayTitle(conflict.diskContent, state.activeDocument.fileName),
          }
        : null,
      saveState: 'idle',
    }))
  },

  /**
   * 处理库目录的外部变更事件（spec §12.3）
   */
  handleExternalEvent: async (event) => {
    const active = get().activeDocument

    if (active && event.path === active.path) {
      if (event.kind === 'remove') {
        useUiStore.getState().pushToast({ message: t('toast.externalDeleted'), kind: 'info' })
        void get().refreshDocuments()
        return
      }

      const hasPending =
        pendingText !== null ||
        get().saveState === 'dirty' ||
        get().saveState === 'saving' ||
        get().saveState === 'error'

      let disk: ReadDocumentResult
      try {
        disk = await invoke<ReadDocumentResult>('read_document', { path: event.path })
      } catch {
        return
      }

      if (hasPending) {
        // 有 pending 输入 → 冲突三选一
        useEditorStore.getState().setConflict({
          path: event.path,
          diskMtime: disk.mtime,
          diskContent: disk.content,
        })
        set({ saveState: 'conflict' })
        clearSaveTimer()
        return
      }

      // 无 pending 输入 → 静默刷新，保持光标与滚动位置
      // no-op 守卫：内容没变化只更新元数据，避免无谓的 setState（滚动/光标跳动）
      pendingText = null
      lastWrittenText = disk.content
      latestText = disk.content
      if (editorBridge.getContent() !== disk.content) {
        editorBridge.setContent(disk.content, { preserveSelection: true })
      }
      set((state) => ({
        activeDocument: state.activeDocument
          ? {
              ...state.activeDocument,
              content: disk.content,
              mtime: disk.mtime,
              size: disk.size,
              displayTitle: extractDisplayTitle(disk.content, state.activeDocument.fileName),
            }
          : null,
      }))
      return
    }

    // 非活动文档 → 刷新列表（防抖 500ms 批量）
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void get().refreshDocuments()
    }, 500)
  },
}))

/**
 * 重算活动文档的显示标题（首个 H1 变化时更新列表）
 */
function refreshActiveTitle() {
  const state = useDocumentStore.getState()
  const active = state.activeDocument
  if (!active) return
  const info = extractTitleInfo(latestText, active.fileName)
  if (info.title === active.displayTitle && info.fromH1 === active.titleFromH1) return

  useDocumentStore.setState((s) => ({
    activeDocument: s.activeDocument
      ? { ...s.activeDocument, displayTitle: info.title, titleFromH1: info.fromH1 }
      : s.activeDocument,
    documents: s.documents.map((doc) =>
      doc.path === active.path
        ? { ...doc, displayTitle: info.title, titleFromH1: info.fromH1 }
        : doc,
    ),
  }))
}

/**
 * 实际执行一次写入
 */
async function doWrite(): Promise<void> {
  const state = useDocumentStore.getState()
  const active = state.activeDocument
  if (!active) return
  if (state.saveState === 'conflict') return // 冲突未解决前冻结写入队列
  if (pendingText === null) return
  if (pendingText === lastWrittenText) {
    pendingText = null
    if (useDocumentStore.getState().saveState === 'dirty') {
      useDocumentStore.setState({ saveState: 'idle' })
    }
    return
  }

  const content = pendingText
  pendingText = null
  await writeActiveDocument(active.mtime, content)
}

/**
 * 把内容写到当前活动文档
 */
async function writeActiveDocument(
  expectedMtime: number | null,
  forcedContent?: string,
): Promise<void> {
  const state = useDocumentStore.getState()
  const active = state.activeDocument
  if (!active) return

  const content = forcedContent ?? pendingText
  if (content === null || content === undefined) return
  if (forcedContent === undefined) pendingText = null

  useDocumentStore.setState({ saveState: 'saving' })

  try {
    const result = await invoke<WriteResult>('write_document', {
      path: active.path,
      content,
      expectedMtime,
    })
    lastWrittenText = content
    retryCount = 0
    clearRetryTimer()
    useDocumentStore.setState((s) => ({
      saveState: 'saved',
      activeDocument:
        s.activeDocument && s.activeDocument.path === active.path
          ? { ...s.activeDocument, mtime: result.mtime }
          : s.activeDocument,
    }))
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      savedTimer = null
      useDocumentStore.setState((s) => (s.saveState === 'saved' ? { saveState: 'idle' } : s))
    }, SAVED_LINGER_MS)
  } catch (error) {
    const conflict = isConflictError(error)
    if (conflict) {
      // 保留内存内容，等待用户选择
      pendingText = content
      let diskContent = ''
      let diskMtime = conflict.diskMtime
      try {
        const disk = await invoke<ReadDocumentResult>('read_document', { path: active.path })
        diskContent = disk.content
        diskMtime = disk.mtime
      } catch {
        /* 读不到就留空 */
      }
      useEditorStore.getState().setConflict({
        path: active.path,
        diskMtime,
        diskContent,
      })
      useDocumentStore.setState({ saveState: 'conflict' })
      return
    }

    pendingText = content
    useDocumentStore.setState({ saveState: 'error' })
    useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })

    // 每 5s 重试，最多 3 次
    if (retryCount < MAX_RETRIES) {
      retryCount += 1
      clearRetryTimer()
      retryTimer = setTimeout(() => {
        retryTimer = null
        void useDocumentStore.getState().flushSave()
      }, RETRY_INTERVAL_MS)
    }
  }
}
