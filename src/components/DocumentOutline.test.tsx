import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { DocumentOutline, outlineWindow } from '@/components/DocumentOutline'
import { editorBridge } from '@/editor/bridge'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'

const HEADINGS = [
  { level: 1, text: '开头', pos: 0 },
  { level: 2, text: '第一节', pos: 20 },
  { level: 2, text: '第二节', pos: 40 },
]

/** 渲染在宽度为 mainWidth 的主区里（jsdom 没有布局，手动给 clientWidth） */
function renderIn(mainWidth: number) {
  const main = document.createElement('main')
  Object.defineProperty(main, 'clientWidth', { value: mainWidth, configurable: true })
  document.body.appendChild(main)
  return render(<DocumentOutline />, { container: main })
}

describe('右侧悬浮目录', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contentWidth: 680 } }))
    useEditorStore.setState({ outline: HEADINGS, outlineActive: 1, focusMode: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('宽窗口、3 个以上标题时显示短横线，当前章节高亮', () => {
    const { container } = renderIn(1200)
    const items = container.querySelectorAll('.ink-outline-item')
    expect(items).toHaveLength(3)
    expect((items[1] as HTMLElement).dataset.active).toBe('true')
  })

  it('标题少于 3 个时不显示', () => {
    useEditorStore.setState({ outline: HEADINGS.slice(0, 2) })
    const { container } = renderIn(1200)
    expect(container.querySelector('.ink-outline')).toBeNull()
  })

  it('Focus Mode 下不显示', () => {
    useEditorStore.setState({ focusMode: true })
    const { container } = renderIn(1200)
    expect(container.querySelector('.ink-outline')).toBeNull()
  })

  it('正文右侧空白不够（窄窗口）时不显示，展开后不会压到正文', () => {
    // 900 宽：(900 - 680) / 2 = 110 < 200
    const { container } = renderIn(900)
    expect(container.querySelector('.ink-outline')).toBeNull()
  })

  it('悬停一小会儿才展开，移开后收起', () => {
    vi.useFakeTimers()
    const { container } = renderIn(1200)
    const nav = container.querySelector('.ink-outline') as HTMLElement
    fireEvent.mouseEnter(nav)
    expect(nav.dataset.open).toBe('false')
    act(() => vi.advanceTimersByTime(200))
    expect(nav.dataset.open).toBe('true')
    fireEvent.mouseLeave(nav)
    act(() => vi.advanceTimersByTime(300))
    expect(nav.dataset.open).toBe('false')
  })

  it('标题很多时只渲染当前章节附近的一段，当前章节在其中', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ level: 2, text: `节 ${i}`, pos: i * 100 }))
    useEditorStore.setState({ outline: many, outlineActive: 4200 })
    const { container } = renderIn(1200)
    const items = container.querySelectorAll<HTMLElement>('.ink-outline-item')
    expect(items.length).toBeLessThan(100)
    const active = container.querySelector<HTMLElement>('[data-active="true"]')
    expect(active?.title).toBe('节 4200')
  })

  it('点击标题跳转到对应位置', () => {
    const jumpTo = vi.spyOn(editorBridge, 'jumpTo').mockImplementation(() => {})
    const { getByText } = renderIn(1200)
    fireEvent.click(getByText('第二节'))
    expect(jumpTo).toHaveBeenCalledWith(40)
  })
})

describe('outlineWindow', () => {
  it('标题不多时全部渲染', () => {
    expect(outlineWindow(10, 3, 41)).toEqual([0, 10])
  })

  it('以当前章节为中心，贴边时不越界', () => {
    expect(outlineWindow(1000, 500, 41)).toEqual([480, 521])
    expect(outlineWindow(1000, 2, 41)).toEqual([0, 41])
    expect(outlineWindow(1000, 999, 41)).toEqual([959, 1000])
    expect(outlineWindow(1000, -1, 41)).toEqual([0, 41])
  })
})
