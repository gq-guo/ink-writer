/**
 * UI store：overlay 可见性这类纯 UI 态不污染 editorStore（spec §6.1）
 */
import { create } from 'zustand'
import type { Toast } from '@/lib/types'

let toastId = 0

export type SidebarView = 'all' | 'recent' | 'favorites'

interface UiState {
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarView: SidebarView
  quickOpenVisible: boolean
  paletteVisible: boolean
  conflictVisible: boolean
  recentCommands: string[]
  toasts: Toast[]
  statusExpanded: boolean

  toggleSidebar: () => void
  setSidebarVisible: (visible: boolean) => void
  setSidebarView: (view: SidebarView) => void
  setSidebarWidth: (width: number) => void
  showQuickOpen: () => void
  hideQuickOpen: () => void
  showPalette: () => void
  hidePalette: () => void
  closeOverlays: () => void
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  setStatusExpanded: (expanded: boolean) => void
  pushRecentCommand: (id: string) => void
  hydrate: (snapshot: Partial<UiSnapshot>) => void
  snapshot: () => UiSnapshot
}

export interface UiSnapshot {
  sidebarVisible: boolean
  sidebarWidth: number
  recentCommands: string[]
}

export const SIDEBAR_WIDTH_RANGE = { min: 200, max: 320 } as const
export const RECENT_COMMANDS_LIMIT = 5

export const useUiStore = create<UiState>((set, get) => ({
  sidebarVisible: false,
  sidebarWidth: 240,
  sidebarView: 'all',
  quickOpenVisible: false,
  paletteVisible: false,
  conflictVisible: false,
  recentCommands: [],
  toasts: [],
  statusExpanded: false,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setSidebarView: (view) => set({ sidebarView: view }),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, width)) }),

  showQuickOpen: () => set({ quickOpenVisible: true, paletteVisible: false }),
  hideQuickOpen: () => set({ quickOpenVisible: false }),
  showPalette: () => set({ paletteVisible: true, quickOpenVisible: false }),
  hidePalette: () => set({ paletteVisible: false }),
  closeOverlays: () => set({ quickOpenVisible: false, paletteVisible: false }),

  pushToast: (toast) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => {
      get().dismissToast(id)
    }, 3000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setStatusExpanded: (expanded) => set({ statusExpanded: expanded }),

  pushRecentCommand: (id) =>
    set((s) => ({
      recentCommands: [id, ...s.recentCommands.filter((c) => c !== id)].slice(0, RECENT_COMMANDS_LIMIT),
    })),

  hydrate: (snapshot) =>
    set({
      sidebarVisible: snapshot.sidebarVisible ?? get().sidebarVisible,
      sidebarWidth: Math.min(
        SIDEBAR_WIDTH_RANGE.max,
        Math.max(SIDEBAR_WIDTH_RANGE.min, snapshot.sidebarWidth ?? get().sidebarWidth),
      ),
      recentCommands: snapshot.recentCommands ?? get().recentCommands,
    }),

  snapshot: () => ({
    sidebarVisible: get().sidebarVisible,
    sidebarWidth: get().sidebarWidth,
    recentCommands: get().recentCommands,
  }),
}))
