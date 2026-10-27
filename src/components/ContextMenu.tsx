/**
 * 页面内的右键菜单（浏览器 / 测试里用；App 里走 macOS 原生菜单）
 *
 * 文档条目和文件夹条目共用：条目定义见 lib/contextMenu，这里只负责摆位置和画出来。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { ContextMenuEntry } from '@/lib/contextMenu'

export interface ContextMenuState {
  x: number
  y: number
  entries: ContextMenuEntry[]
}

interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
}

/** 菜单离窗口边缘至少留这么多 */
const MENU_EDGE_GAP = 8

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: state.x, top: state.y })

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  // 量出菜单尺寸后收进窗口：靠右 / 靠下右键时往左 / 往上翻，不被裁掉
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(MENU_EDGE_GAP, Math.min(state.x, window.innerWidth - width - MENU_EDGE_GAP)),
      top: Math.max(MENU_EDGE_GAP, Math.min(state.y, window.innerHeight - height - MENU_EDGE_GAP)),
    })
  }, [state.x, state.y])

  return (
    <div
      ref={ref}
      className="ink-popover ink-menu ink-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {state.entries.map((entry, index) => (
        // 用序号做 key：「移到」里文件夹可能和别的条目同名
        <MenuEntry key={index} entry={entry} onClose={onClose} />
      ))}
    </div>
  )
}

/** 页面内菜单的一项；子菜单展开成一个小标题加一组缩进的条目 */
function MenuEntry({
  entry,
  onClose,
  indent = false,
}: {
  entry: ContextMenuEntry
  onClose: () => void
  indent?: boolean
}) {
  if (entry === 'separator') return <div className="ink-menu-sep" role="separator" />
  if ('children' in entry) {
    return (
      <div role="group" aria-label={entry.label}>
        <div className="ink-menu-label">{entry.label}</div>
        {entry.children.map((child, index) => (
          <MenuEntry key={index} entry={child} onClose={onClose} indent />
        ))}
      </div>
    )
  }
  return (
    <button
      className="ink-menu-item"
      role="menuitem"
      data-danger={entry.danger ? 'true' : undefined}
      data-indent={indent || undefined}
      onClick={() => {
        onClose()
        entry.action()
      }}
    >
      {entry.label}
    </button>
  )
}
