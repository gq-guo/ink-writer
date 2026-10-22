/**
 * 键盘事件 → 快捷键字符串（app 级快捷键分发用）
 */

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
