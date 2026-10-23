/**
 * 拼写检查开关（设置面板）
 *
 * CM6 默认给 contentDOM 设 spellcheck=false、autocorrect=off；
 * 这里只按设置打开拼写检查（系统红色波浪线），自动更正保持关闭，
 * 避免 macOS 把 Markdown 语法或代码「纠正」掉。
 */
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const spellcheckCompartment = new Compartment()

export function inkSpellcheck(enabled: boolean) {
  return EditorView.contentAttributes.of({ spellcheck: enabled ? 'true' : 'false' })
}
