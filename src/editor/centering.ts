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
 */
import { StateEffect, type EditorState } from '@codemirror/state'
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

export const inkCursorCenteringPlugin = ViewPlugin.fromClass(
  class {
    view: EditorView
    private lastManualScroll = 0
    private frame: number | null = null

    constructor(view: EditorView) {
      this.view = view
      const mark = () => {
        this.lastManualScroll = Date.now()
      }
      view.scrollDOM.addEventListener('wheel', mark, { passive: true })
      view.scrollDOM.addEventListener('touchmove', mark, { passive: true })
    }

    private destroyed = false

    destroy() {
      this.destroyed = true
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
        return
      }

      if (!isCenteringEnabled(update.state)) return
      /*
       * 只在**真正打字**时居中。
       * 早期版本把 selectionSet 也算作触发条件，结果是：
       * - 点任意一行 → 视图立刻被拽回屏幕中央，看起来「点不��哪行」
       * - 按上下箭头 → 光标每移动一行，视图就重新居中一次，完全无法逐行浏览
       * 光标移动交给 CM6 / 浏览器自己的「滚动到可见区域」即可，不做干预。
       */
      if (!update.docChanged) return
      if (!update.view.hasFocus) return
      if (Date.now() - this.lastManualScroll < MANUAL_SCROLL_COOLDOWN_MS) return

      this.scheduleCenter(update.view, false)
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
