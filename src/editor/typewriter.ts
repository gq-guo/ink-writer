/**
 * Typewriter Mode（spec §10）
 *
 * 「打字时当前行停在视口中心」的实现已抽到 `centering.ts`，由
 * Focus Mode 与 Typewriter Mode 共用；本文件只保留模式开关本身。
 */
import { StateEffect, StateField } from '@codemirror/state'

/** 打开 / 关闭 Typewriter Mode */
export const setTypewriterModeEffect = StateEffect.define<boolean>()

export const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTypewriterModeEffect)) return effect.value
    }
    return value
  },
})
