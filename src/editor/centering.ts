/**
 * 光标居中（Focus Mode / Typewriter Mode 共用）
 *
 * 打字时把光标所在行钉在视口的**垂直中心**，这样当前段落既被高亮，
 * 又始终停在视线焦点上（spec §9 + §10）。
 *
 * 规则：
 * - 精确居中（50%），死区 6px 只为避免逐像素抖动
 * - 打字时瞬时滚动，不做动画（连续输入会漂移）
 * - 切换模式的瞬间做一次平滑居中
 * - 手动滚动后 1.5s 冷却，不跟用户抢滚动条
 * - 拖拽选区时不跟随（避免选中过程中页面乱滚）
 *
 * 打字时的居中由 transactionExtender 直接附加到这次输入的事务上：
 * CM6 在同一帧的 measure 阶段用最新坐标完成滚动，新行不会先以「未居中」的位置画出来。
 * （早期版本在插件里等两帧再 dispatch，回车时会先往下画一行、再整体上滚 —— 看起来闪一下）
 */
import { EditorState, StateEffect, type Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

import { focusModeField } from './focusMode'
import { typewriterModeField } from './typewriter'

/** 触发一次居中（切换模式时用，走平滑动画） */
export const centerCursorEffect = StateEffect.define<null>()

/** 垂直中心比例：0.5 = 精确居中 */
export const CENTER_RATIO = 0.5
/** 死区：光标已在中心附近就不动滚动条 */
export const CENTER_DEAD_ZONE_PX = 6
/** 手动滚动冷却 */
export const MANUAL_SCROLL_COOLDOWN_MS = 1500

/** 该状态下是否需要保持光标居中 */
export function isCenteringEnabled(state: EditorState): boolean {
  return (
    state.field(typewriterModeField, false) === true ||
    state.field(focusModeField, false) === true
  )
}

/**
 * 最近一次手动滚动（滚轮 / 触控板）的时间。
 * 由插件在滚动事件里写、由事务扩展读；应用里只有一个编辑器，模块级状态即可。
 */
let lastManualScroll = 0

/** 会改变光标所在行、需要保持居中的用户输入 */
function isTypingTransaction(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    (tr.isUserEvent('input') ||
      tr.isUserEvent('delete') ||
      tr.isUserEvent('undo') ||
      tr.isUserEvent('redo'))
  )
}

/**
 * 打字时把「居中滚动」附加到同一个事务上（覆盖 CM6 默认的「滚到可见即可」）。
 *
 * 只在**真正打字**时居中。早期版本把 selectionSet 也算作触发条件，结果是：
 * - 点任意一行 → 视图立刻被拽回屏幕中央，看起来「点不中哪行」
 * - 按上下箭头 → 光标每移动一行，视图就重新居中一次，完全无法逐行浏览
 * 光标移动交给 CM6 / 浏览器自己的「滚动到可见区域」即可，不做干预。
 */
export const inkTypingCenteringExtender = EditorState.transactionExtender.of((tr) => {
  if (!isTypingTransaction(tr)) return null
  if (!isCenteringEnabled(tr.startState)) return null
  if (Date.now() - lastManualScroll < MANUAL_SCROLL_COOLDOWN_MS) return null
  return {
    effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center', yMargin: 0 }),
  }
})

/** 普通模式下光标与视口底边保持的距离（占可视高度的比例） */
export const BOTTOM_COMFORT_RATIO = 0.25
/** 底部舒适区的下限：至少高出底部状态栏（34px）一截 */
export const BOTTOM_COMFORT_MIN_PX = 96

/**
 * 普通模式的滚动边距：写到底部时光标停在底边以上约 1/4 视口处，而不是贴着底边
 * （CM6 默认只留 5px，全屏时文字会贴到屏幕底边、压到状态栏下面）。
 * Focus / Typewriter 模式本身就把光标钉在中线，这里不加边距，以免中线被挤偏。
 */
export const inkComfortScrollMargins = EditorView.scrollMargins.of((view) => {
  if (isCenteringEnabled(view.state)) return null
  const height = view.scrollDOM.clientHeight
  return { bottom: Math.max(BOTTOM_COMFORT_MIN_PX, Math.round(height * BOTTOM_COMFORT_RATIO)) }
})

export const inkCursorCenteringPlugin = ViewPlugin.fromClass(
  class {
    view: EditorView
    private frame: number | null = null

    private readonly markManualScroll = () => {
      lastManualScroll = Date.now()
    }

    constructor(view: EditorView) {
      this.view = view
      view.scrollDOM.addEventListener('wheel', this.markManualScroll, { passive: true })
      view.scrollDOM.addEventListener('touchmove', this.markManualScroll, { passive: true })
    }

    private destroyed = false

    destroy() {
      this.destroyed = true
      // 每次切换文档都会重建插件实例，不摘掉的话监听器会一直累积在同一个 scrollDOM 上
      this.view.scrollDOM.removeEventListener('wheel', this.markManualScroll)
      this.view.scrollDOM.removeEventListener('touchmove', this.markManualScroll)
      if (this.frame !== null) cancelAnimationFrame(this.frame)
    }

    update(update: ViewUpdate) {
      // 切换模式的瞬间：平滑居中一次（显式触发，不受模式开关影响）
      if (
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(centerCursorEffect)),
        )
      ) {
        this.scheduleCenter(update.view, true)
      }
      // 打字时的居中见 inkTypingCenteringExtender（与输入同一事务，不再推迟）
    }

    /**
     * 推迟到下一帧再滚动。
     *
     * 关键：插件的 update() 期间调用 `view.dispatch()` 会抛
     * "Calls to EditorView.update are not allowed while an update is in progress"，
     * CM6 捕获异常后会**停用该插件**，导致居中功能在第一次击键后就彻底失效。
     */
    private scheduleCenter(view: EditorView, smooth: boolean) {
      if (this.frame !== null) return
      /*
       * 用两帧：CM6 渲染新内容（measure）发生在插件 update 之后注册的 rAF 里，
       * 只等一帧拿到的还是**过期坐标**（光标还在旧位置），
       * 会按错误的偏移量滚动。两帧后 DOM 已是最新，坐标才准。
       */
      this.frame = requestAnimationFrame(() => {
        this.frame = requestAnimationFrame(() => {
          this.frame = null
          if (this.destroyed) return
          this.centerOnCursor(view, smooth)
        })
      })
    }

    /**
     * 把光标行移到视口垂直中心。
     *
     * 全部交给 CM6 的 scrollIntoView：它在 CM6 自己的 measure 阶段计算目标位置，
     * 那时 DOM 已是最新、位置也已渲染，所以不存在「坐标过期 / 位置未渲染」的问题。
     */
    private centerOnCursor(view: EditorView, smooth: boolean) {
      const head = view.state.selection.main.head

      if (smooth) {
        // 平滑滚动：用坐标直接设置 scrollTop（CM6 的 scrollIntoView 没有动画选项）
        const coords = view.coordsAtPos(head)
        const scroller = view.scrollDOM
        if (coords && typeof scroller.scrollTo === 'function') {
          const rect = scroller.getBoundingClientRect()
          const centerY = rect.top + rect.height * CENTER_RATIO
          const offset = (coords.top + coords.bottom) / 2 - centerY
          if (Math.abs(offset) > CENTER_DEAD_ZONE_PX) {
            scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: 'smooth' })
            return
          }
        }
      }

      view.dispatch({
        effects: EditorView.scrollIntoView(head, { y: 'center', yMargin: 0 }),
      })
    }
  },
)
