/**
 * 空文档的占位提示（CM6 的 placeholder）
 *
 * 就在光标所在的位置、打出第一个字就消失；之前另有一块居中的「开始写作 / 写下你的第一个想法」，
 * 两处说的是同一件事，只留这一处。放在 Compartment 里，切换语言时重配。
 */
import { Compartment } from '@codemirror/state'
import { placeholder } from '@codemirror/view'

import { type Locale } from '@/lib/i18n'

export function makePlaceholder(locale: Locale) {
  return placeholder(locale === 'zh-CN' ? '开始写作…' : 'Start writing…')
}

/** 语言切换时重配（EditorHost 负责 dispatch） */
export const placeholderCompartment = new Compartment()
