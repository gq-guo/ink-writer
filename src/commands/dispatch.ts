/**
 * 命令分发：快捷键与原生菜单共用的入口
 *
 * 菜单项带 accelerator（菜单里要显示快捷键），WKWebView 下同一次按键可能
 * 既被 GlobalShortcuts 的 keydown 处理、又触发菜单项。两条来源在短时间内
 * 对同一命令只执行一次；同一来源的连按（⌘= 连续放大）不受影响。
 */
import { useUiStore } from '@/stores/uiStore'

import { buildCommands } from './registry'

export type CommandSource = 'keyboard' | 'menu'

const DEDUPE_MS = 300

let lastRun: { id: string; source: CommandSource; at: number } | null = null

/** 执行命令；被去重或 when() 不满足时返回 false */
export function dispatchCommand(id: string, source: CommandSource): boolean {
  const now = performance.now()
  if (lastRun && lastRun.id === id && lastRun.source !== source && now - lastRun.at < DEDUPE_MS) {
    return false
  }
  const command = buildCommands().find((item) => item.id === id)
  if (!command) return false
  if (command.when && !command.when()) return false
  lastRun = { id, source, at: now }
  // 菜单可以在 overlay 打开时被点到（快捷键此时由 overlay 自己处理），先收起再执行
  if (source === 'menu') useUiStore.getState().closeOverlays()
  void command.run()
  return true
}

/** 测试用：清掉去重状态 */
export function resetDispatchForTesting(): void {
  lastRun = null
}
