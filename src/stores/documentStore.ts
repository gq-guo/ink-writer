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
import { extractDisplayTitle } from '@/lib/title'
import { ensureMarkdownExtension, sanitizeFileName } from '@/lib/naming'
import { editorBridge } from '@/editor/bridge'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'

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
/** 最近一次成功写入的内容 */
let lastWrittenText = ''
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
        .pushToast({ message: `找不到文档库：${libraryPath}`, kind: 'error' })
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
        .pushToast({ message: `无法监听文档库：${errorMessage(error)}`, kind: 'error' })
    }
    await get().refreshDocuments()
    set({ bootstrapped: true })
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
      }
      pendingText = null
      lastWrittenText = result.content
      set({ activeDocument: document, saveState: 'idle' })
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
    pendingText = text
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
            displayTitle: extractDisplayTitle(active.content, safeName),
          },
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
        // 活动文档被删除：保留内存内容，下次 flush 时重建
        set({ activeDocument: null })
        useUiStore.getState().pushToast({ message: '文档已移入废纸篓', kind: 'info' })
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
        useUiStore.getState().pushToast({ message: '文件已在外部删除', kind: 'info' })
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
      pendingText = null
      lastWrittenText = disk.content
      editorBridge.setContent(disk.content, { preserveSelection: true })
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
  const text = pendingText ?? active.content
  const title = extractDisplayTitle(text, active.fileName)
  if (title === active.displayTitle) return

  useDocumentStore.setState((s) => ({
    activeDocument: s.activeDocument
      ? { ...s.activeDocument, displayTitle: title }
      : s.activeDocument,
    documents: s.documents.map((doc) =>
      doc.path === active.path ? { ...doc, displayTitle: title } : doc,
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
