/**
 * 编辑器 store：Focus Mode、统计、外部冲突（spec §5.3）
 */
import { create } from 'zustand'
import type { DocumentStatistics, ExternalConflict } from '@/lib/types'
import { EMPTY_STATISTICS } from '@/lib/statistics'

interface EditorState {
  focusMode: boolean
  statistics: DocumentStatistics
  conflict: ExternalConflict | null

  toggleFocusMode: () => void
  setFocusMode: (on: boolean) => void
  setStatistics: (statistics: DocumentStatistics) => void
  setConflict: (conflict: ExternalConflict) => void
  clearConflict: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  focusMode: false,
  statistics: EMPTY_STATISTICS,
  conflict: null,

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setFocusMode: (on) => set({ focusMode: on }),
  setStatistics: (statistics) => set({ statistics }),
  setConflict: (conflict) => set({ conflict }),
  clearConflict: () => set({ conflict: null }),
}))
