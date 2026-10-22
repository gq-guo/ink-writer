/**
 * Overlay 外壳（spec §4.3.2）：所有 overlay 共用定位、遮罩、Esc 关闭、焦点陷阱
 */
import { useEffect, useRef, type ReactNode } from 'react'

interface OverlayShellProps {
  onClose: () => void
  children: ReactNode
  /** 面板宽度（默认 --overlay-width） */
  width?: number
  /** 对话框样式（居中、不可滚动列表） */
  variant?: 'panel' | 'dialog'
  /** 无障碍标签 */
  label?: string
}

export function OverlayShell({
  onClose,
  children,
  width,
  variant = 'panel',
  label,
}: OverlayShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // 焦点陷阱
      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div
      className="ink-overlay-mask"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={containerRef}
        className={variant === 'dialog' ? 'ink-dialog' : 'ink-overlay'}
        style={width ? { width, maxWidth: 'calc(100vw - 48px)' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  )
}
