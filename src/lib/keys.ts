/**
 * 键盘事件 → 快捷键字符串（app 级快捷键分发用）
 */

/**
 * 按物理键位取字符（只处理快捷键会用到的键）。
 * macOS 上按住 ⌥ 时 event.key 是组合后的字符（⌥\ → «、⌥A → å），
 * 必须改用 event.code 才能匹配到 'alt+\\' 这类快捷键。
 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  switch (code) {
    case 'Backslash':
      return '\\'
    case 'Slash':
      return '/'
    case 'Equal':
      return '='
    case 'Minus':
      return '-'
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Period':
      return '.'
    case 'Comma':
      return ','
    case 'Semicolon':
      return ';'
    case 'Quote':
      return "'"
    case 'Backquote':
      return '`'
    default:
      return null
  }
}

export function shortcutOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')

  let key = event.key
  const physical = event.altKey ? keyFromCode(event.code) : null
  if (physical) key = physical
  else if (key === ' ') key = 'space'
  else if (key === '+') key = '='
  else key = key.toLowerCase()

  parts.push(key)
  return parts.join('+')
}
