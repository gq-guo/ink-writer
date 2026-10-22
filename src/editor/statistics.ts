/**
 * 统计插件（spec §16.2）
 *
 * - 防抖 300ms
 * - 1MB 内主线程全量
 * - >2MB：requestIdleCallback 按 512KB 分片，空闲期间挂起
 */
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  countChunk,
  mergeChunks,
  splitIntoChunks,
  toDocumentStatistics,
  type ChunkStatistics,
} from '@/lib/statistics'
import type { DocumentStatistics } from '@/lib/types'

/** 防抖 */
const DEBOUNCE_MS = 300
/** 超过该大小走 idle 分片 */
const IDLE_THRESHOLD_BYTES = 2 * 1024 * 1024
/** 分片大小 */
const CHUNK_SIZE = 512 * 1024

type IdleHandle = number

interface IdleWindow {
  requestIdleCallback?: (callback: (deadline: { timeRemaining: () => number }) => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

function idleWindow(): IdleWindow {
  return window as unknown as IdleWindow
}

function requestIdle(callback: (deadline: { timeRemaining: () => number }) => void): IdleHandle {
  const win = idleWindow()
  if (typeof win.requestIdleCallback === 'function') {
    return win.requestIdleCallback(callback, { timeout: 500 })
  }
  return window.setTimeout(() => callback({ timeRemaining: () => 8 }), 16)
}

function cancelIdle(handle: IdleHandle) {
  const win = idleWindow()
  if (typeof win.cancelIdleCallback === 'function') {
    win.cancelIdleCallback(handle)
  } else {
    window.clearTimeout(handle)
  }
}

export function inkStatisticsPlugin(onStatistics: (statistics: DocumentStatistics) => void) {
  return ViewPlugin.fromClass(
    class {
      view: EditorView
      private timer: ReturnType<typeof setTimeout> | null = null
      private idleHandle: IdleHandle | null = null
      private generation = 0

      constructor(view: EditorView) {
        this.view = view
        this.schedule()
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.schedule()
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer)
        if (this.idleHandle !== null) cancelIdle(this.idleHandle)
      }

      private schedule() {
        if (this.timer) clearTimeout(this.timer)
        this.generation += 1
        const generation = this.generation
        this.timer = setTimeout(() => {
          this.timer = null
          this.compute(generation)
        }, DEBOUNCE_MS)
      }

      private compute(generation: number) {
        const text = this.view.state.doc.toString()

        if (text.length <= IDLE_THRESHOLD_BYTES) {
          onStatistics(toDocumentStatistics(countChunk(text)))
          return
        }

        // 大文件：分片 + idle
        if (this.idleHandle !== null) {
          cancelIdle(this.idleHandle)
          this.idleHandle = null
        }
        const chunks = splitIntoChunks(text, CHUNK_SIZE)
        let index = 0
        let total: ChunkStatistics = {
          cjkChars: 0,
          latinWords: 0,
          characters: 0,
          paragraphs: 0,
          sentences: 0,
        }

        const step = () => {
          if (generation !== this.generation) return // 有新的输入，放弃本次计算
          const start = performance.now()
          while (index < chunks.length && performance.now() - start < 8) {
            total = mergeChunks([total, countChunk(chunks[index]!)])
            index += 1
          }
          if (index < chunks.length) {
            this.idleHandle = requestIdle(step)
          } else {
            this.idleHandle = null
            onStatistics(toDocumentStatistics(total))
          }
        }
        this.idleHandle = requestIdle(step)
      }
    },
  )
}
