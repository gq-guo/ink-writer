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
import { displayNameOf, followsFirstLine, nameFromFirstLine, sameName } from '@/lib/title'
import { ensureMarkdownExtension, markdownExtensionOf, sanitizeFileName } from '@/lib/naming'
import { editorBridge } from '@/editor/bridge'
import { useEditorStore } from './editorStore'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'
import { t } from '@/lib/i18n'
import { errorMessage } from '@/lib/errors'

/** 自动保存防抖（spec §12.1） */
const AUTOSAVE_DEBOUNCE_MS = 500
/** 写入失败重试间隔 */
const RETRY_INTERVAL_MS = 5000
/** 最大重试次数 */
const MAX_RETRIES = 3
/** saved 状态保持时长 */
const SAVED_LINGER_MS = 1500
/** 新文档按第一行自动命名：停笔这么久之后再改文件名 */
const AUTO_NAME_DEBOUNCE_MS = 1000
/** 离开前落盘最多等这么久（网络盘卡住时不能把切换 / 退出一起卡死） */
const LEAVE_FLUSH_TIMEOUT_MS = 5000
/** 写入失败被拦下后，这段时间内再操作一次视为放弃未保存的修改 */
const DISCARD_CONFIRM_MS = 10_000

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
  /** 更换文档库位置：Rust 弹出目录选择框，复制现有文档（不删旧库）后切换过去 */
  changeLibrary: () => Promise<void>
  refreshDocuments: () => Promise<void>
  createDocument: () => Promise<void>
  openDocument: (path: string, revealRange?: [number, number]) => Promise<void>
  onEditorChange: (text: string) => void
  flushSave: () => Promise<void>
  /**
   * 离开当前文档（切换 / 新建 / 换库 / 退出）前调用：先落盘，没存上就拦下并提示。
   * 返回 true 才能继续。
   */
  prepareToLeave: () => Promise<boolean>
  /** auto：自动命名（按第一行）发起的改名，不提示撞名、也不会停止自动命名 */
  renameDocument: (path: string, newName: string, options?: { auto?: boolean }) => Promise<void>
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
/** 刚由本应用移入废纸篓的路径：watch 回来的 remove 事件不再提示「外部删除」 */
let selfTrashedPath: string | null = null
/** 写入队列，保证同一时间只有一个写入任务 */
let writeChain: Promise<void> = Promise.resolve()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let autoNameTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 正在「跟着第一行自动命名」的文档路径（只看当前打开的那篇）：
 * 打开时按 followsFirstLine 判定，自动改名后跟到新路径，手动改名后清掉
 */
let autoNamedPath: string | null = null
let retryCount = 0
/** 写入失败时拦下离开操作的时间：DISCARD_CONFIRM_MS 内再来一次就放行 */
let discardArmedAt = 0

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
    // 库目录是否还在由 settingsStore.hydrate（Rust get_library）判断
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

  changeLibrary: async () => {
    if (!(await get().prepareToLeave())) return
    let result: { path: string; copied: number; skipped: number } | null
    try {
      result = await invoke<{ path: string; copied: number; skipped: number } | null>(
        'change_library',
      )
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
      return
    }
    if (!result || result.path === get().libraryPath) return
    if (result.copied > 0 || result.skipped > 0) {
      useUiStore
        .getState()
        .pushToast({ message: t('toast.libraryMoved', { count: result.copied }), kind: 'info' })
    }

    const newPath = result.path
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
    if (!(await get().prepareToLeave())) return
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
    // 已经是当前文档：不重新加载（会丢光标、滚动和撤销历史），只定位
    if (get().activeDocument?.path === path) {
      if (revealRange) editorBridge.revealRange(revealRange)
      return
    }
    if (!(await get().prepareToLeave())) return
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
        displayTitle: displayNameOf(fileName),
        openSeq: ++openSeqCounter,
      }
      autoNamedPath = followsFirstLine(fileName, result.content) ? path : null
      pendingText = null
      lastWrittenText = result.content
      latestText = result.content
      set({ activeDocument: document, saveState: 'idle' })
      useEditorStore.getState().setHasContent(result.content.trim().length > 0)
      clearRetryTimer()

      if (result.encoding === 'gbk') {
        useUiStore
          .getState()
          .pushToast({ message: t('toast.gbkNotice'), kind: 'info' })
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

    // 新文档的文件名跟着第一行走（停笔 1s 后改名）
    if (autoNameTimer) clearTimeout(autoNameTimer)
    autoNameTimer = setTimeout(() => {
      autoNameTimer = null
      void autoNameActive()
    }, AUTO_NAME_DEBOUNCE_MS)
  },

  /**
   * 立即落盘（⌘S / 切换文档 / 失焦 / 退出）
   */
  flushSave: async () => {
    clearSaveTimer()
    writeChain = writeChain.then(doWrite, doWrite)
    return writeChain
  },

  prepareToLeave: async () => {
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      get().flushSave(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LEAVE_FLUSH_TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)

    const state = get().saveState
    if (state === 'conflict') {
      // 冲突对话框还开着：必须先选，切走后对话框会作用到别的文档上
      useUiStore.getState().pushToast({ message: t('toast.leaveConflict'), kind: 'error' })
      return false
    }
    if (pendingText === null && state !== 'error' && state !== 'saving' && state !== 'dirty') {
      discardArmedAt = 0
      return true
    }
    // 写入失败（目录被移走、磁盘满……）：先拦下；短时间内再来一次才放弃，免得卡死在这篇上
    if (discardArmedAt > 0 && Date.now() - discardArmedAt < DISCARD_CONFIRM_MS) {
      discardArmedAt = 0
      pendingText = null
      clearRetryTimer()
      set({ saveState: 'idle' })
      return true
    }
    discardArmedAt = Date.now()
    useUiStore.getState().pushToast({ message: t('toast.leaveUnsaved'), kind: 'error' })
    return false
  },

  renameDocument: async (path: string, newName: string, options?: { auto?: boolean }) => {
    const safeName = ensureMarkdownExtension(
      sanitizeFileName(newName),
      markdownExtensionOf(path.split('/').pop() ?? path),
    )
    if (!safeName) return
    // 手动改名：这篇不再跟着第一行自动命名
    if (!options?.auto && autoNamedPath === path) autoNamedPath = null
    try {
      const newPath = await invoke<string>('rename_document', { path, newName: safeName })
      if (options?.auto && autoNamedPath === path) autoNamedPath = newPath
      // 重名时 Rust 会自动加 -2（spec §7.2），实际文件名以返回路径为准
      const fileName = newPath.split('/').pop() ?? safeName
      if (fileName !== safeName && !options?.auto) {
        useUiStore.getState().pushToast({
          message: t('toast.renamedDeduped', { requested: safeName, name: fileName }),
          kind: 'info',
        })
      }
      await get().refreshDocuments()
      const active = get().activeDocument
      if (active && active.path === path) {
        set({
          activeDocument: {
            ...active,
            path: newPath,
            fileName,
            displayTitle: displayNameOf(fileName),
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
    const isActive = get().activeDocument?.path === path
    if (isActive) {
      // 先把未保存内容落盘，再整份移入废纸篓（可从废纸篓找回）。
      // 落盘失败 / 冲突未决时取消删除：切走后这部分内容就再也找不回了。
      await get().flushSave()
      const state = get().saveState
      if (pendingText !== null || state === 'error' || state === 'conflict') {
        useUiStore.getState().pushToast({ message: t('toast.deleteUnsaved'), kind: 'error' })
        return
      }
    }

    try {
      selfTrashedPath = path
      await invoke('delete_document', { path })
    } catch (error) {
      selfTrashedPath = null
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
      return
    }

    await get().refreshDocuments()
    useUiStore.getState().pushToast({ message: t('toast.trashed'), kind: 'info' })
    if (!isActive) return

    // 切到下一篇（列表按 mtime 倒序）；库空了就新建，避免继续打字把文件重建出来
    const next = get().documents.find((doc) => doc.path !== path)
    if (next) await get().openDocument(next.path)
    else await get().createDocument()
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
        // 不能用 write_text_file：第二次冲突会把第一份副本覆盖掉
        const savedPath = await invoke<string>('write_new_text_file', {
          path: copyPath,
          content: editorBridge.getContent() || latestText,
        })
        useUiStore.getState().pushToast({
          message: t('toast.savedCopy', { name: savedPath.split('/').pop() ?? savedPath }),
          kind: 'info',
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
        if (event.path === selfTrashedPath) return
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
 * 自动命名：当前文档还在跟着第一行走时，把文件名改成第一行生成的名字。
 * 先把正在等的保存写掉，再改名，避免保存写回旧路径。
 */
async function autoNameActive() {
  const state = useDocumentStore.getState()
  const active = state.activeDocument
  if (!active || autoNamedPath !== active.path) return
  const name = nameFromFirstLine(latestText)
  if (!name || sameName(displayNameOf(active.fileName), name)) return
  await state.flushSave()
  // 写盘期间可能已经切换了文档 / 手动改了名
  if (useDocumentStore.getState().activeDocument?.path !== active.path || autoNamedPath !== active.path) return
  await state.renameDocument(active.path, name, { auto: true })
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
    // 写盘期间又打了字：还没全部落盘，别显示「已保存」
    const newerPending = pendingText !== null && pendingText !== content
    useDocumentStore.setState((s) => ({
      saveState: newerPending ? 'dirty' : 'saved',
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
      // 保留内存内容，等待用户选择（写盘期间又打的字更新，不能被这次的旧内容盖掉）
      pendingText ??= content
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

    pendingText ??= content
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
