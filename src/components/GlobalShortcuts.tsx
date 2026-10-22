/**
 * app 级快捷键分发（spec §11.1）
 *
 * - window.addEventListener('keydown', handler, { capture: true })
 * - IME 守卫：event.isComposing 时忽略一切无修饰键的处理
 * - 冲突裁决：overlay 打开时 → overlay 内部键位 > app 级 > editor 级
 */
import { useEffect } from 'react'

import { buildCommands } from '@/commands/registry'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

/** 快捷键 → 命令 id（spec §11.2） */
const SHORTCUT_COMMANDS: Record<string, string> = {
  'mod+n': 'doc.new',
  'mod+o': 'doc.open',
  'mod+s': 'doc.save',
  'mod+p': 'doc.quickOpen',
  'mod+k': 'app.palette',
  'mod+f': 'editor.find',
  'alt+\\': 'app.sidebar',
  'mod+shift+f': 'mode.focus',
  'mod+shift+t': 'mode.typewriter',
  'mod+shift+d': 'app.theme',
  'mod+=': 'font.larger',
  'mod+-': 'font.smaller',
  'mod+shift+e': 'export.html',
}

export function shortcutOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')

  let key = event.key
  if (key === ' ') key = 'space'
  else if (key === '+') key = '='
  else key = key.toLowerCase()

  parts.push(key)
  return parts.join('+')
}

export function GlobalShortcuts() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // IME 守卫：组合输入期间不触发任何命令
      if (event.isComposing) return

      const ui = useUiStore.getState()
      // overlay 打开时，键位由 overlay 自己处理
      if (ui.quickOpenVisible || ui.paletteVisible) return

      // Esc 退出 Focus Mode（R14）
      // 若搜索面板打开，Esc 优先交给编辑器关闭面板
      if (event.key === 'Escape') {
        if (document.querySelector('.cm-panels')) return
        if (useEditorStore.getState().focusMode) {
          event.preventDefault()
          useEditorStore.getState().setFocusMode(false)
        }
        return
      }

      const shortcut = shortcutOf(event)
      const commandId = SHORTCUT_COMMANDS[shortcut]
      if (!commandId) return

      const command = buildCommands().find((item) => item.id === commandId)
      if (!command) return
      if (command.when && !command.when()) return

      event.preventDefault()
      void command.run()
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])

  return null
}
