import { afterEach, describe, expect, it, vi } from 'vitest'

import { installSidebarWidthFreeze } from '@/lib/sidebarAnimation'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

function mountLayout(mainWidth: number, contentWidth: number) {
  document.body.innerHTML = '<div class="ink-shell"><main><div class="cm-content"></div></main></div>'
  const main = document.querySelector('main')!
  Object.defineProperty(main, 'clientWidth', { value: mainWidth })
  const content = document.querySelector<HTMLElement>('.cm-content')!
  content.getBoundingClientRect = () => ({ width: contentWidth }) as DOMRect
}

describe('侧栏动画期间锁定正文列宽', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('收起侧栏：锁在起点宽度（较小者），动画结束后解除', () => {
    vi.useFakeTimers()
    useUiStore.setState({ sidebarVisible: true, sidebarWidth: 240 })
    useEditorStore.setState({ focusMode: false })
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contentWidth: 680 } }))
    // 800 宽窗口：主区 560，正文列 544
    mountLayout(560, 544)
    const uninstall = installSidebarWidthFreeze()
    const root = document.documentElement

    useUiStore.setState({ sidebarVisible: false })
    expect(root.classList.contains('ink-sidebar-animating')).toBe(true)
    expect(root.style.getPropertyValue('--editor-frozen-width')).toBe('544px')

    vi.advanceTimersByTime(300)
    expect(root.classList.contains('ink-sidebar-animating')).toBe(false)
    uninstall()
  })

  it('展开侧栏：直接锁到终点宽度（较小者），不会先溢出再收缩', () => {
    useUiStore.setState({ sidebarVisible: false, sidebarWidth: 240 })
    useEditorStore.setState({ focusMode: false })
    mountLayout(800, 680)
    const uninstall = installSidebarWidthFreeze()

    useUiStore.setState({ sidebarVisible: true })
    // 终点：主区 560 - 两侧滚动条 16 = 544
    expect(document.documentElement.style.getPropertyValue('--editor-frozen-width')).toBe('544px')
    uninstall()
  })
})
