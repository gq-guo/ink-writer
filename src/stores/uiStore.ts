/**
 * UI store：overlay 可见性这类纯 UI 态不污染 editorStore（spec §6.1）
 */
import { create } from 'zustand'
import type { Toast } from '@/lib/types'

let toastId = 0

export type SidebarView = 'all' | 'recent' | 'favorites' | 'folder' | 'tag'

interface UiState {
  /** 存下的 UI 快照已读回（侧栏显隐等）：读回之前不渲染主界面，否则侧栏会从默认的收起状态动画展开 */
  hydrated: boolean
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarView: SidebarView
  /** sidebarView 为 'folder' 时看的文件夹（dirPrefix 格式，如 "Project/"） */
  sidebarFolder: string
  /** sidebarView 为 'tag' 时看的标签（不含 #，大小写不敏感） */
  sidebarTag: string
  quickOpenVisible: boolean
  /** Quick Open 打开时预填的搜索词；空 = 保留上次的输入 */
  quickOpenQuery: string
  paletteVisible: boolean
  settingsVisible: boolean
  conflictVisible: boolean
  recentCommands: string[]
  toasts: Toast[]
  statusExpanded: boolean
  /** 顶栏文件名进入内联编辑的信号（命令/菜单触发） */
  renameSignal: number
  /** 当前打开的文档：刷新 / 重启后回到这一篇，而不是库里最新的一篇 */
  lastDocumentPath: string | null

  toggleSidebar: () => void
  setSidebarVisible: (visible: boolean) => void
  setSidebarView: (view: SidebarView) => void
  /** 侧栏切到某个文件夹 */
  openFolder: (prefix: string) => void
  /** 侧栏切到某个标签 */
  openTag: (tag: string) => void
  setSidebarWidth: (width: number) => void
  /** query：打开时预填的搜索词（⌘Click 标签时为 "#tag"） */
  showQuickOpen: (query?: string) => void
  hideQuickOpen: () => void
  showPalette: () => void
  hidePalette: () => void
  showSettings: () => void
  hideSettings: () => void
  closeOverlays: () => void
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  setStatusExpanded: (expanded: boolean) => void
  /** 请求顶栏进入文件名编辑态（window.prompt 在 WKWebView 不可用） */
  requestRename: () => void
  pushRecentCommand: (id: string) => void
  setLastDocumentPath: (path: string | null) => void
  hydrate: (snapshot: Partial<UiSnapshot>) => void
  snapshot: () => UiSnapshot
}

export interface UiSnapshot {
  sidebarVisible: boolean
  sidebarWidth: number
  recentCommands: string[]
  lastDocumentPath: string | null
}

export const SIDEBAR_WIDTH_RANGE = { min: 200, max: 320 } as const
export const RECENT_COMMANDS_LIMIT = 5

export const useUiStore = create<UiState>((set, get) => ({
  hydrated: false,
  sidebarVisible: false,
  sidebarWidth: 240,
  sidebarView: 'all',
  sidebarFolder: '',
  sidebarTag: '',
  quickOpenVisible: false,
  quickOpenQuery: '',
  paletteVisible: false,
  settingsVisible: false,
  conflictVisible: false,
  recentCommands: [],
  toasts: [],
  statusExpanded: false,
  renameSignal: 0,
  lastDocumentPath: null,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setSidebarView: (view) => set({ sidebarView: view }),
  openFolder: (prefix) => set({ sidebarView: 'folder', sidebarFolder: prefix }),
  openTag: (tag) => set({ sidebarView: 'tag', sidebarTag: tag }),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, width)) }),

  showQuickOpen: (query = '') =>
    set({ quickOpenVisible: true, quickOpenQuery: query, paletteVisible: false, settingsVisible: false }),
  hideQuickOpen: () => set({ quickOpenVisible: false }),
  showPalette: () => set({ paletteVisible: true, quickOpenVisible: false, settingsVisible: false }),
  hidePalette: () => set({ paletteVisible: false }),
  showSettings: () => set({ settingsVisible: true, quickOpenVisible: false, paletteVisible: false }),
  hideSettings: () => set({ settingsVisible: false }),
  closeOverlays: () => set({ quickOpenVisible: false, paletteVisible: false, settingsVisible: false }),

  pushToast: (toast) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => {
      get().dismissToast(id)
    }, 3000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setStatusExpanded: (expanded) => set({ statusExpanded: expanded }),

  requestRename: () => set((state) => ({ renameSignal: state.renameSignal + 1 })),

  pushRecentCommand: (id) =>
    set((s) => ({
      recentCommands: [id, ...s.recentCommands.filter((c) => c !== id)].slice(0, RECENT_COMMANDS_LIMIT),
    })),

  setLastDocumentPath: (path) => set({ lastDocumentPath: path }),

  hydrate: (snapshot) =>
    set({
      hydrated: true,
      sidebarVisible: snapshot.sidebarVisible ?? get().sidebarVisible,
      sidebarWidth: Math.min(
        SIDEBAR_WIDTH_RANGE.max,
        Math.max(SIDEBAR_WIDTH_RANGE.min, snapshot.sidebarWidth ?? get().sidebarWidth),
      ),
      recentCommands: snapshot.recentCommands ?? get().recentCommands,
      // 读回之前用户已经打开了别的文档：以当前为准，不让旧值覆盖
      lastDocumentPath: get().lastDocumentPath ?? snapshot.lastDocumentPath ?? null,
    }),

  snapshot: () => ({
    sidebarVisible: get().sidebarVisible,
    sidebarWidth: get().sidebarWidth,
    recentCommands: get().recentCommands,
    lastDocumentPath: get().lastDocumentPath,
  }),
}))

/** 新建文档放在哪个文件夹：侧栏正看着某个文件夹时放进去，否则放在库根目录（返回 dirPrefix，根目录为 ""） */
export function newDocumentFolder(): string {
  const { sidebarView, sidebarFolder } = useUiStore.getState()
  return sidebarView === 'folder' ? sidebarFolder : ''
}
