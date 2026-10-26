/**
 * 编辑器 store：Focus Mode、统计、外部冲突（spec §5.3）
 */
import { create } from 'zustand'
import type { DocumentStatistics, ExternalConflict, OutlineHeading } from '@/lib/types'

export interface UpdateInfo {
  version: string
  body: string
  /** idle：等用户确认；downloading / installing：进行中；failed：可重试 */
  status: 'idle' | 'downloading' | 'installing' | 'failed'
  /** 下载进度 0–1；服务器没给总长度时为 null */
  progress: number | null
}
import { EMPTY_STATISTICS } from '@/lib/statistics'

interface EditorState {
  focusMode: boolean
  statistics: DocumentStatistics
  conflict: ExternalConflict | null
  /** 发现的新版本（非 null 时弹出更新对话框） */
  updateInfo: UpdateInfo | null
  setUpdateInfo: (info: UpdateInfo) => void
  patchUpdateInfo: (patch: Partial<UpdateInfo>) => void
  clearUpdateInfo: () => void
  /** 当前文档是否有内容（驱动「Start writing.」引导的显隐；正文权威在 CM6，
   *  activeDocument.content 只是打开时的快照，不能用它判断） */
  hasContent: boolean
  /** 正在连续打字：顶栏与状态栏淡出，鼠标一动就恢复（iA Writer 式降噪） */
  typing: boolean
  /** 文档目录（标题列表）与当前阅读到的章节下标（-1 = 在第一个标题之前） */
  outline: OutlineHeading[]
  outlineActive: number

  toggleFocusMode: () => void
  setFocusMode: (on: boolean) => void
  setStatistics: (statistics: DocumentStatistics) => void
  setConflict: (conflict: ExternalConflict) => void
  clearConflict: () => void
  setHasContent: (hasContent: boolean) => void
  setTyping: (typing: boolean) => void
  setOutline: (outline: OutlineHeading[], active: number) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  focusMode: false,
  statistics: EMPTY_STATISTICS,
  conflict: null,
  hasContent: false,
  typing: false,
  outline: [],
  outlineActive: -1,
  updateInfo: null,

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setFocusMode: (on) => set({ focusMode: on }),
  setStatistics: (statistics) => set({ statistics }),
  setConflict: (conflict) => set({ conflict }),
  clearConflict: () => set({ conflict: null }),
  setHasContent: (hasContent) => set({ hasContent }),
  // 只在值变化时 set，避免每次击键都通知订阅者
  setTyping: (typing) => set((s) => (s.typing === typing ? s : { typing })),
  setOutline: (outline, outlineActive) => set({ outline, outlineActive }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  patchUpdateInfo: (patch) =>
    set((state) => (state.updateInfo ? { updateInfo: { ...state.updateInfo, ...patch } } : {})),
  clearUpdateInfo: () => set({ updateInfo: null }),
}))
