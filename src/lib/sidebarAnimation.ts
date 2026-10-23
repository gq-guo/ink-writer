/**
 * 侧栏展开 / 收起动画期间锁定正文列宽
 *
 * 侧栏用 width 过渡，主区每帧变宽 / 变窄；窄窗口下正文列也跟着每帧变，
 * 长段落会边动画边反复折行。动画期间把列宽锁在「起止两个宽度里较小的那个」：
 * 不溢出、不被裁切，整个过程只折行一次。（Focus Mode 也会收起侧栏，一并处理）
 */
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

/** 侧栏宽度过渡时长 + 余量（globals.css 的 .ink-sidebar transition 为 200ms） */
const SIDEBAR_TRANSITION_MS = 240
/** .cm-scroller 两侧对称预留的滚动条宽度（scrollbar-gutter: stable both-edges） */
const SCROLLBAR_GUTTERS = 16

/** 开始监听侧栏显隐；返回取消函数 */
export function installSidebarWidthFreeze(): () => void {
  const shownOf = () =>
    useUiStore.getState().sidebarVisible && !useEditorStore.getState().focusMode
  let shown = shownOf()
  let timer: ReturnType<typeof setTimeout> | null = null
  const root = document.documentElement

  const onChange = () => {
    const next = shownOf()
    if (next === shown) return
    shown = next
    const content = document.querySelector<HTMLElement>('.cm-content')
    const main = document.querySelector<HTMLElement>('.ink-shell main')
    if (!content || !main) return
    // 订阅回调在 React 重渲染之前同步执行，此刻量到的还是动画起点的布局
    const sidebarWidth = useUiStore.getState().sidebarWidth
    const finalMain = main.clientWidth + (next ? -sidebarWidth : sidebarWidth)
    const finalContent = Math.min(
      useSettingsStore.getState().settings.contentWidth,
      finalMain - SCROLLBAR_GUTTERS,
    )
    const frozen = Math.min(content.getBoundingClientRect().width, finalContent)
    root.style.setProperty('--editor-frozen-width', `${frozen}px`)
    root.classList.add('ink-sidebar-animating')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      root.classList.remove('ink-sidebar-animating')
    }, SIDEBAR_TRANSITION_MS)
  }

  const unsubscribeUi = useUiStore.subscribe(onChange)
  const unsubscribeEditor = useEditorStore.subscribe(onChange)
  return () => {
    unsubscribeUi()
    unsubscribeEditor()
    if (timer) clearTimeout(timer)
    root.classList.remove('ink-sidebar-animating')
  }
}
