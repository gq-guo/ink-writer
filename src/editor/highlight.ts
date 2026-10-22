/**
 * 代码高亮样式（spec §2.1「代码块内部按语言语法高亮」）
 *
 * 颜色一律引用 CSS variables。
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const inkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--code-punctuation)' },
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '700' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--secondary)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--code-font)' },
  { tag: tags.quote, color: 'var(--secondary)' },
])

export const inkSyntaxHighlighting = syntaxHighlighting(inkHighlightStyle)
