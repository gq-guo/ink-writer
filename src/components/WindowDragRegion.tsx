/**
 * 窗口拖拽条（macOS 红绿灯内嵌时的顶部拖拽区）
 *
 * 为什么需要它：`titleBarStyle: "Overlay"` 下 webview 覆盖了原生标题栏，
 * 按住窗口顶部不会有任何反应。
 *
 * 为什么不用 Tauri 内置的 `data-tauri-drag-region`：
 * 它走 `plugin:window|start_dragging` IPC，而该命令**不在 `core:window:default`
 * 权限集内**，会被 ACL 静默拒绝。这里直接调用 Rust 侧运行时 API（见
 * `start_window_dragging` 命令），不依赖任何 IPC 权限。
 */
import { invoke } from '@tauri-apps/api/core'
import type { MouseEvent as ReactMouseEvent } from 'react'

export function WindowDragRegion({ className = '' }: { className?: string }) {
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // 阻止文本选择等默认行为
    event.preventDefault()

    // 双击 → 最大化 / 还原（与 macOS 标题栏行为一致）
    if (event.detail >= 2) {
      void invoke('toggle_window_maximize').catch(() => {})
      return
    }

    void invoke('start_window_dragging').catch(() => {})
  }

  return (
    <div
      className={className}
      // 关闭 Tauri 内置拖拽区，避免与上面的实现重复触发
      data-tauri-drag-region="false"
      onMouseDown={onMouseDown}
      onDoubleClick={(event) => {
        event.preventDefault()
      }}
    />
  )
}
