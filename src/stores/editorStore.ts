/**
 * 编辑器 store：Focus Mode、统计、外部冲突（spec §5.3）
 */
import { create } from 'zustand'
import type { DocumentStatistics, ExternalConflict } from '@/lib/types'

export interface UpdateInfo {
  version: string
  body: string
}
import { EMPTY_STATISTICS } from '@/lib/statistics'

interface EditorState {
  focusMode: boolean
  statistics: DocumentStatistics
  conflict: ExternalConflict | null
  /** 发现的新版本（非 null 时弹出更新对话框） */
  updateInfo: UpdateInfo | null
  setUpdateInfo: (info: UpdateInfo) => void
  clearUpdateInfo: () => void
  /** 当前文档是否有内容（驱动「Start writing.」引导的显隐；正文权威在 CM6，
   *  activeDocument.content 只是打开时的快照，不能用它判断） */
  hasContent: boolean
  /** 正在连续打字：顶栏与状态栏淡出，鼠标一动就恢复（iA Writer 式降噪） */
  typing: boolean

  toggleFocusMode: () => void
  setFocusMode: (on: boolean) => void
  setStatistics: (statistics: DocumentStatistics) => void
  setConflict: (conflict: ExternalConflict) => void
  clearConflict: () => void
  setHasContent: (hasContent: boolean) => void
  setTyping: (typing: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  focusMode: false,
  statistics: EMPTY_STATISTICS,
  conflict: null,
  hasContent: false,
  typing: false,
  updateInfo: null,

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setFocusMode: (on) => set({ focusMode: on }),
  setStatistics: (statistics) => set({ statistics }),
  setConflict: (conflict) => set({ conflict }),
  clearConflict: () => set({ conflict: null }),
  setHasContent: (hasContent) => set({ hasContent }),
  // 只在值变化时 set，避免每次击键都通知订阅者
  setTyping: (typing) => set((s) => (s.typing === typing ? s : { typing })),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  clearUpdateInfo: () => set({ updateInfo: null }),
}))
