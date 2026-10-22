/**
 * 大文件降级策略（spec §18.2）
 *
 * | 文档大小 | 降级动作 |
 * |---|---|
 * | >2MB | 统计走 idle 分片；正文搜索跳过（Rust 侧已限制 5MB） |
 * | >5MB | Focus Mode decoration 范围收窄为可见区间 ±50 行 |
 * | >10MB | 性能模式：关闭语法高亮、禁用 Focus Mode 入口 |
 */
import { Compartment } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'

/** >10MB 进入性能模式 */
export const PERFORMANCE_MODE_BYTES = 10 * 1024 * 1024

/** 语法高亮 compartment：性能模式下换成空样式 */
export const highlightCompartment = new Compartment()

/** 空高亮样式（性能模式） */
export const noHighlightStyle = syntaxHighlighting(HighlightStyle.define([]))

export function isPerformanceMode(byteLength: number): boolean {
  return byteLength > PERFORMANCE_MODE_BYTES
}
