/**
 * 应用外壳（spec §3.1 / §4.1）
 *
 * Layer 2（overlay）→ Layer 1（chrome）→ Layer 0（base）
 */
import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { CommandPalette } from '@/components/CommandPalette'
import { DocumentHeader } from '@/components/DocumentHeader'
import { ConflictDialog } from '@/components/ConflictDialog'
import { EditorHost } from '@/components/EditorHost'
import { GlobalShortcuts } from '@/components/GlobalShortcuts'
import { LibraryBootstrap } from '@/components/LibraryBootstrap'
import { QuickOpen } from '@/components/QuickOpen'
import { SaveIndicator } from '@/components/SaveIndicator'
import { Sidebar } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { Toast } from '@/components/Toast'
import { TopBar } from '@/components/TopBar'
import { UpdateDialog } from '@/components/UpdateDialog'
import { scheduleUpdateCheck } from '@/lib/updater'
import { WindowDragRegion } from '@/components/WindowDragRegion'
import { readPersisted, writePersisted } from '@/lib/persist'
import { useDocumentStore, type FsEventPayload } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

export default function App() {
  const hydrated = useSettingsStore((state) => state.hydrated)
  const libraryPath = useSettingsStore((state) => state.settings.libraryPath)
  const focusMode = useEditorStore((state) => state.focusMode)
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)
  const quickOpenVisible = useUiStore((state) => state.quickOpenVisible)
  const paletteVisible = useUiStore((state) => state.paletteVisible)
  const bootstrappedRef = useRef(false)

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
        const state = useDocumentStore.getState()
        if (state.documents.length === 0) {
          await state.createDocument()
        } else {
          await state.openDocument(state.documents[0]!.path)
        }
      } catch (error) {
        // 启动链不再无声失败（此前 HMR 重载异常会让 documents 永远为空）
        useUiStore
          .getState()
          .pushToast({ message: `启动失败：${String(error)}`, kind: 'error' })
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
        .pushToast({ message: `文件监听异常：${event.payload}`, kind: 'error' })
    }).then((fn) => {
      unlistenError = fn
    })

    return () => {
      unlisten?.()
      unlistenError?.()
    }
  }, [])

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

  // ── 持久化 UI 快照（防抖 500ms）──
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useUiStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void writePersisted('ui', useUiStore.getState().snapshot())
      }, 500)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!hydrated) return null

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
    <div className="ink-shell">
      {/* 窗口拖拽条：红绿灯内嵌时 webview 覆盖了原生标题栏 */}
      <WindowDragRegion className="ink-window-drag" />
      <Sidebar />
      <main className="relative h-full flex-1 overflow-hidden" data-sidebar={sidebarVisible}>
        <TopBar />
        <DocumentHeader />
        <EditorHost />
        {!focusMode ? <SaveIndicator /> : null}
        <StatusBar />
      </main>

      {quickOpenVisible ? <QuickOpen /> : null}
      {paletteVisible ? <CommandPalette /> : null}
      <ConflictDialog />
      <UpdateDialog />
      <Toast />
      <GlobalShortcuts />
    </div>
  )
}
