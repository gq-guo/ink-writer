import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  centerCursorEffect,
  inkCursorCenteringPlugin,
  isCenteringEnabled,
} from '@/editor/centering'
import { focusModeField, setFocusModeEffect } from '@/editor/focusMode'
import { setTypewriterModeEffect, typewriterModeField } from '@/editor/typewriter'

/** 滚动被推迟到下一帧执行，测试需要等帧 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function makeView() {
  const view = new EditorView({
    state: EditorState.create({
      doc: 'hello world',
      extensions: [focusModeField, typewriterModeField, inkCursorCenteringPlugin],
    }),
    parent: document.body,
  })
  // jsdom 没有真实布局：伪造焦点与坐标
  Object.defineProperty(view, 'hasFocus', { value: true, configurable: true })
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({
    top: 300,
    bottom: 330,
    left: 0,
    right: 0,
  })
  return view
}

describe('光标居中（Focus Mode / Typewriter Mode 共用）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('两个模式都关闭时不居中', () => {
    const view = makeView()
    expect(isCenteringEnabled(view.state)).toBe(false)
    view.destroy()
  })

  it('Typewriter Mode 开启后进入居中状态', () => {
    const view = makeView()
    view.dispatch({ effects: setTypewriterModeEffect.of(true) })
    expect(isCenteringEnabled(view.state)).toBe(true)
    view.destroy()
  })

  it('Focus Mode 开启后也进入居中状态', () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    expect(isCenteringEnabled(view.state)).toBe(true)
    view.destroy()
  })

  it('打字时会在下一帧派发滚动（把当前行拉到视口中心）', async () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const dispatch = vi.spyOn(view, 'dispatch')
    const before = dispatch.mock.calls.length
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    await nextFrame()

    // 除了测试自己那次，插件还额外派发了一次滚动
    expect(dispatch.mock.calls.length).toBeGreaterThan(before + 1)
    view.destroy()
  })

  it('插件不会因为在 update 里 dispatch 而崩溃停用', async () => {
    const errors: unknown[][] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })

    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const dispatch = vi.spyOn(view, 'dispatch')
    const base = dispatch.mock.calls.length

    // 连续打两次字：插件若在第一次被 CM6 停用，第二次就不会再滚动
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    await nextFrame()
    const afterFirst = dispatch.mock.calls.length - base

    view.dispatch({ changes: { from: 0, insert: 'y' } })
    await nextFrame()
    const afterSecond = dispatch.mock.calls.length - base - afterFirst

    expect(afterFirst).toBeGreaterThan(0)
    expect(afterSecond).toBeGreaterThan(0)

    // CM6 捕获插件异常后会打印 "CodeMirror plugin crashed" 并停用插件
    const crashes = errors.filter((args) => String(args[0]).includes('CodeMirror plugin crashed'))
    expect(crashes).toHaveLength(0)
    view.destroy()
  })

  it('模式关闭时打字不会派发滚动', async () => {
    const view = makeView()
    const dispatch = vi.spyOn(view, 'dispatch')
    const before = dispatch.mock.calls.length
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    await nextFrame()
    expect(dispatch.mock.calls.length).toBe(before + 1)
    view.destroy()
  })

  it('只移动光标（不打字）不触发居中', async () => {
    // 早期版本把 selectionSet 也当触发条件，导致：
    // - 点任意一行，视图立刻被拽回屏幕中央（看起来「点不了哪行」）
    // - 按上下箭头，光标每走一行视图就重新居中一次，完全无法逐行浏览
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const dispatch = vi.spyOn(view, 'dispatch')
    const before = dispatch.mock.calls.length
    view.dispatch({ selection: { anchor: 3 } })
    await nextFrame()
    expect(dispatch.mock.calls.length).toBe(before + 1)
    view.destroy()
  })

  it('拖拽选区时不触发居中', async () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const dispatch = vi.spyOn(view, 'dispatch')
    const before = dispatch.mock.calls.length
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    await nextFrame()
    expect(dispatch.mock.calls.length).toBe(before + 1)
    view.destroy()
  })

  it('centerCursorEffect 会立刻居中一次（切换模式时用，走平滑滚动）', async () => {
    const view = makeView()
    const scrollTo = vi.fn()
    Object.defineProperty(view.scrollDOM, 'scrollTo', { value: scrollTo, configurable: true })

    view.dispatch({ effects: centerCursorEffect.of(null) })
    await nextFrame()

    expect(scrollTo).toHaveBeenCalled()
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: 'smooth' })
    view.destroy()
  })
})
