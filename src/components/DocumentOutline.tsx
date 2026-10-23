/**
 * 右侧悬浮目录
 *
 * 平时只是一列淡淡的短横线（每个标题一条，长短表示层级，当前章节稍亮）；
 * 鼠标移上去才展开成卡片，显示标题文字，点击跳转。
 *
 * 为了不打扰写作，以下情况不显示：
 * - 标题少于 3 个（短文不需要目录）
 * - Focus Mode
 * - 正文右侧空白不够放（窄窗口）——卡片展开时不能压到正文
 * - 连续打字时淡出（与顶栏 / 状态栏同一机制，见 globals.css 的 data-typing）
 */
import { useEffect, useRef, useState } from 'react'

import { editorBridge } from '@/editor/bridge'
import { useT } from '@/lib/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** 至少这么多个标题才显示目录 */
export const OUTLINE_MIN_HEADINGS = 3
/** 正文右侧至少要有这么宽的空白才显示 */
export const OUTLINE_MIN_MARGIN_PX = 200
/** 展开后的卡片最宽 */
const CARD_MAX_WIDTH_PX = 260
/** 卡片与正文之间至少留出的距离 */
const CARD_GAP_PX = 32
/** 悬停多久才展开（鼠标路过时不弹出） */
const OPEN_DELAY_MS = 120
/** 移开多久才收起 */
const CLOSE_DELAY_MS = 220
/** 与 .cm-scroller 两侧对称预留的滚动条宽度一致 */
const SCROLLBAR_GUTTERS = 16
/**
 * 标题很多时（大文档几千个）只渲染当前章节附近的一段：
 * 收起时短横线列放得下的条数；展开的卡片多给一些，可在卡片里滚动
 */
const COLLAPSED_WINDOW = 41
const OPEN_WINDOW = 201

/** 以 active 为中心、长度不超过 size 的区间 [start, end) */
export function outlineWindow(length: number, active: number, size: number): [number, number] {
  if (length <= size) return [0, length]
  const center = Math.max(0, active)
  const start = Math.min(Math.max(0, center - Math.floor(size / 2)), length - size)
  return [start, start + size]
}

export function DocumentOutline() {
  const t = useT()
  const outline = useEditorStore((state) => state.outline)
  const active = useEditorStore((state) => state.outlineActive)
  const focusMode = useEditorStore((state) => state.focusMode)
  const contentWidth = useSettingsStore((state) => state.settings.contentWidth)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const [mainWidth, setMainWidth] = useState(0)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 展开时把当前章节滚到卡片中间（列表比卡片高时，否则看不到当前章节）
  useEffect(() => {
    if (!open) return
    const item = navRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    item?.scrollIntoView({ block: 'center' })
  }, [open])

  // 跟踪主区宽度，算出正文右侧的空白
  useEffect(() => {
    const main = rootRef.current?.parentElement
    if (!main) return
    const measure = () => setMainWidth(main.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const column = Math.min(contentWidth, mainWidth - SCROLLBAR_GUTTERS)
  const margin = (mainWidth - column) / 2
  const visible =
    outline.length >= OUTLINE_MIN_HEADINGS && !focusMode && margin >= OUTLINE_MIN_MARGIN_PX
  const cardWidth = Math.min(CARD_MAX_WIDTH_PX, margin - CARD_GAP_PX)
  const [windowStart, windowEnd] = outlineWindow(
    outline.length,
    active,
    open ? OPEN_WINDOW : COLLAPSED_WINDOW,
  )

  const schedule = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS)
  }

  return (
    <div ref={rootRef} className="ink-outline-anchor">
      {visible ? (
        <nav
          ref={navRef}
          className="ink-outline"
          data-open={open}
          aria-label={t('outline.label')}
          style={{ ['--outline-card-width' as string]: `${cardWidth}px` }}
          onMouseEnter={() => schedule(true)}
          onMouseLeave={() => schedule(false)}
        >
          {outline.slice(windowStart, windowEnd).map((heading, offset) => {
            const index = windowStart + offset
            return (
              <button
                key={`${heading.pos}-${index}`}
                type="button"
                className="ink-outline-item"
                data-active={index === active}
                data-level={Math.min(heading.level, 3)}
                title={heading.text}
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  editorBridge.jumpTo(heading.pos)
                  setOpen(false)
                }}
              >
                <span className="ink-outline-dash" aria-hidden />
                <span className="ink-outline-text">{heading.text}</span>
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
