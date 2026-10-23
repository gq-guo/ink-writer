import { EditorState, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  centerCursorEffect,
  inkComfortScrollMargins,
  inkCursorCenteringPlugin,
  inkTypingCenteringExtender,
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

/** 事务里是否带了「把光标滚到垂直中心」的效果（EditorView.scrollIntoView(…, { y: 'center' })） */
function centersCursor(tr: Transaction): boolean {
  return tr.effects.some((effect) => (effect.value as { y?: unknown } | null)?.y === 'center')
}

function makeView() {
  const view = new EditorView({
    state: EditorState.create({
      doc: 'hello world',
      extensions: [
        focusModeField,
        typewriterModeField,
        inkCursorCenteringPlugin,
        inkTypingCenteringExtender,
      ],
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

  it('打字时居中滚动随这次输入的事务一起生效（不推迟到后面的帧，回车不会先闪一下）', () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const tr = view.state.update({ changes: { from: 0, insert: '\n' }, userEvent: 'input' })
    expect(centersCursor(tr)).toBe(true)
    view.destroy()
  })

  it('连续打字每次都会居中，且插件不会崩溃停用', () => {
    const errors: unknown[][] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const first = view.state.update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    expect(centersCursor(first)).toBe(true)
    view.dispatch(first)
    const second = view.state.update({ changes: { from: 0, insert: 'y' }, userEvent: 'input.type' })
    expect(centersCursor(second)).toBe(true)
    view.dispatch(second)

    const crashes = errors.filter((args) => String(args[0]).includes('CodeMirror plugin crashed'))
    expect(crashes).toHaveLength(0)
    view.destroy()
  })

  it('模式关闭时打字不居中', () => {
    const view = makeView()
    const tr = view.state.update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    expect(centersCursor(tr)).toBe(false)
    view.destroy()
  })

  it('程序改文档（非用户输入）不居中', () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    const tr = view.state.update({ changes: { from: 0, insert: 'x' } })
    expect(centersCursor(tr)).toBe(false)
    view.destroy()
  })

  it('只移动光标（不打字）不触发居中', async () => {
    // 早期版本把 selectionSet 也当触发条件，导致：
    // - 点任意一行，视图立刻被拽回屏幕中央（看起来「点不了哪行」）
    // - 按上下箭头，光标每走一行视图就重新居中一次，完全无法逐行浏览
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })

    const tr = view.state.update({ selection: { anchor: 3 }, userEvent: 'select' })
    expect(centersCursor(tr)).toBe(false)

    const dispatch = vi.spyOn(view, 'dispatch')
    const before = dispatch.mock.calls.length
    view.dispatch(tr)
    await nextFrame()
    expect(dispatch.mock.calls.length).toBe(before + 1)
    view.destroy()
  })

  it('拖拽选区时不触发居中', () => {
    const view = makeView()
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    const tr = view.state.update({ selection: { anchor: 0, head: 5 }, userEvent: 'select.pointer' })
    expect(centersCursor(tr)).toBe(false)
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

describe('普通模式底部舒适区', () => {
  function marginsOf(view: EditorView) {
    return view.state
      .facet(EditorView.scrollMargins)
      .map((fn) => fn(view))
      .filter((margins) => margins !== null)
  }

  function viewWithHeight(height: number) {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello',
        extensions: [focusModeField, typewriterModeField, inkComfortScrollMargins],
      }),
      parent: document.body,
    })
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: height, configurable: true })
    return view
  }

  it('写到底部时光标与底边保持约 1/4 视口（不贴底、不压到状态栏）', () => {
    const view = viewWithHeight(800)
    expect(marginsOf(view)).toEqual([{ bottom: 200 }])
    view.destroy()
  })

  it('矮窗口也至少留出一截，高出底部状态栏', () => {
    const view = viewWithHeight(300)
    expect(marginsOf(view)).toEqual([{ bottom: 96 }])
    view.destroy()
  })

  it('Focus / Typewriter 模式不加边距（光标钉在中线，边距会把中线挤偏）', () => {
    const view = viewWithHeight(800)
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    expect(marginsOf(view)).toEqual([])
    view.dispatch({ effects: [setFocusModeEffect.of(false), setTypewriterModeEffect.of(true)] })
    expect(marginsOf(view)).toEqual([])
    view.destroy()
  })
})
