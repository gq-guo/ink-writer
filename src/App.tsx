/**
 * 应用外壳（spec §3.1 / §4.1）
 *
 * Layer 2（overlay）→ Layer 1（chrome）→ Layer 0（base）
 */
import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { CommandPalette } from '@/components/CommandPalette'
import { ConflictDialog } from '@/components/ConflictDialog'
import { DocumentOutline } from '@/components/DocumentOutline'
import { EditorHost } from '@/components/EditorHost'
import { GlobalShortcuts } from '@/components/GlobalShortcuts'
import { LibraryBootstrap } from '@/components/LibraryBootstrap'
import { QuickOpen } from '@/components/QuickOpen'
import { SaveIndicator } from '@/components/SaveIndicator'
import { SettingsPanel } from '@/components/SettingsPanel'
import { Sidebar } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { Toast } from '@/components/Toast'
import { TopBar } from '@/components/TopBar'
import { UpdateDialog } from '@/components/UpdateDialog'
import { scheduleUpdateCheck } from '@/lib/updater'
import { WindowDragRegion } from '@/components/WindowDragRegion'
import { installSidebarWidthFreeze } from '@/lib/sidebarAnimation'
import { installAppMenu } from '@/lib/appMenu'
import { openRequestedFiles } from '@/lib/openRequests'
import { readPersisted, writePersisted } from '@/lib/persist'
import { pickStartupDocument } from '@/lib/startupDocument'
import { errorMessage } from '@/lib/errors'
import { t } from '@/lib/i18n'
import { useDocumentStore, type FsEventPayload } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore, type UiSnapshot } from '@/stores/uiStore'

export default function App() {
  const hydrated = useSettingsStore((state) => state.hydrated)
  const uiHydrated = useUiStore((state) => state.hydrated)
  const libraryPath = useSettingsStore((state) => state.settings.libraryPath)
  const focusMode = useEditorStore((state) => state.focusMode)
  const typing = useEditorStore((state) => state.typing)
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)
  const quickOpenVisible = useUiStore((state) => state.quickOpenVisible)
  const paletteVisible = useUiStore((state) => state.paletteVisible)
  const settingsVisible = useUiStore((state) => state.settingsVisible)
  const bootstrappedRef = useRef(false)
  /** 库扫描完成后才处理 Finder 打开请求（之前到达的留在 Rust 队列里） */
  const openRequestsReadyRef = useRef(false)

  // ── 原生菜单栏（语言切换时自动重建）──
  useEffect(() => installAppMenu(), [])

  // ── Finder 打开文档（App 已在运行时）──
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let disposed = false
    void listen('ink://open-requested', () => {
      if (!openRequestsReadyRef.current) return
      void openRequestedFiles().catch((error: unknown) => {
        useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
      })
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  // ── 启动：读取设置 ──
  useEffect(() => {
    void (async () => {
      await useSettingsStore.getState().hydrate()
      const ui = await readPersisted('ui', {
        sidebarVisible: false,
        sidebarWidth: 240,
        recentCommands: [] as string[],
      })
      useUiStore.getState().hydrate(ui)
    })()
  }, [])

  // ── 启动后检查更新（静默）──
  useEffect(() => {
    scheduleUpdateCheck()
  }, [])

  // ── 启动：扫描库目录 + 监听 ──
  useEffect(() => {
    if (!hydrated || !libraryPath || bootstrappedRef.current) return
    bootstrappedRef.current = true
    void (async () => {
      try {
        const store = useDocumentStore.getState()
        await store.bootstrapLibrary(libraryPath)
        openRequestsReadyRef.current = true
        // 从 Finder 双击 .md 启动：打开那个文件，而不是库里的第一篇
        const openedRequested = await openRequestedFiles()
        const state = useDocumentStore.getState()
        if (openedRequested || state.activeDocument) return
        // 直接读存下的 UI 快照：uiStore 的 hydrate 排在设置之后，这时可能还没读回来
        const ui = await readPersisted<Partial<UiSnapshot>>('ui', {})
        const startupPath = pickStartupDocument(state.documents, ui.lastDocumentPath)
        if (startupPath) {
          await state.openDocument(startupPath)
        } else {
          await state.createDocument()
        }
      } catch (error) {
        // 启动链不再无声失败（此前 HMR 重载异常会让 documents 永远为空）
        useUiStore
          .getState()
          .pushToast({ message: t('toast.startupFailed', { error: errorMessage(error) }), kind: 'error' })
      }
    })()
  }, [hydrated, libraryPath])

  // ── 库目录外部变更 ──
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let unlistenError: UnlistenFn | undefined

    void listen<FsEventPayload>('ink://fs-event', (event) => {
      void useDocumentStore.getState().handleExternalEvent(event.payload)
    }).then((fn) => {
      unlisten = fn
    })

    void listen<string>('ink://fs-error', (event) => {
      useUiStore
        .getState()
        .pushToast({ message: t('toast.watchError', { error: event.payload }), kind: 'error' })
    }).then((fn) => {
      unlistenError = fn
    })

    return () => {
      unlisten?.()
      unlistenError?.()
    }
  }, [])

  // ── 打字时顶栏 / 状态栏淡出；鼠标真正移动（> 4px，过滤触控板抖动）后恢复 ──
  useEffect(() => {
    let last: { x: number; y: number } | null = null
    const onMove = (event: MouseEvent) => {
      if (!useEditorStore.getState().typing) {
        last = null
        return
      }
      if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) > 4) {
        useEditorStore.getState().setTyping(false)
        last = null
        return
      }
      last ??= { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // ── 侧栏展开 / 收起动画期间锁定正文列宽 ──
  useEffect(() => installSidebarWidthFreeze(), [])

  // ── 失焦 / 退出前落盘 ──
  useEffect(() => {
    const flush = () => void useDocumentStore.getState().flushSave()
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  // ── 记下当前打开的文档（打开 / 新建 / 改名都会换路径），刷新、重启后回到这一篇 ──
  useEffect(
    () =>
      useDocumentStore.subscribe((state, prev) => {
        const path = state.activeDocument?.path ?? null
        if (path && path !== (prev.activeDocument?.path ?? null)) {
          useUiStore.getState().setLastDocumentPath(path)
        }
      }),
    [],
  )

  // ── 持久化 UI 快照（防抖 500ms；刷新 / 关闭前把还没写的立刻写掉）──
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const write = () => void writePersisted('ui', useUiStore.getState().snapshot())
    const unsubscribe = useUiStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        write()
      }, 500)
    })
    const flushPending = () => {
      if (!timer) return
      clearTimeout(timer)
      timer = null
      write()
    }
    window.addEventListener('beforeunload', flushPending)
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', flushPending)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // UI 快照也要读回再渲染：侧栏显隐是存下来的，先按默认（收起）渲染再展开，刷新时就会看到侧栏动画展开一下
  if (!hydrated || !uiHydrated) return null

  if (!libraryPath) {
    return (
      <>
        <WindowDragRegion className="ink-window-drag" />
        <LibraryBootstrap />
        <Toast />
        <GlobalShortcuts />
      </>
    )
  }

  return (
    <div className="ink-shell" data-typing={typing}>
      {/* 窗口拖拽条：红绿灯内嵌时 webview 覆盖了原生标题栏 */}
      <WindowDragRegion className="ink-window-drag" />
      <Sidebar />
      <main className="relative h-full flex-1 overflow-hidden" data-sidebar={sidebarVisible}>
        <TopBar />
        <EditorHost />
        <DocumentOutline />
        {!focusMode ? <SaveIndicator /> : null}
        <StatusBar />
      </main>

      {quickOpenVisible ? <QuickOpen /> : null}
      {paletteVisible ? <CommandPalette /> : null}
      {settingsVisible ? <SettingsPanel /> : null}
      <ConflictDialog />
      <UpdateDialog />
      <Toast />
      <GlobalShortcuts />
    </div>
  )
}
