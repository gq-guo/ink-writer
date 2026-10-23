import { describe, expect, it } from 'vitest'

import { shortcutOf } from '@/lib/keys'

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('shortcutOf', () => {
  it('macOS ⌥\\：event.key 是 «，仍按物理键位识别为 alt+\\', () => {
    expect(shortcutOf(keydown({ key: '«', code: 'Backslash', altKey: true }))).toBe('alt+\\')
  })

  it('⌥ + 字母按物理键位识别（⌥A 的 event.key 是 å）', () => {
    expect(shortcutOf(keydown({ key: 'å', code: 'KeyA', altKey: true }))).toBe('alt+a')
  })

  it('不带 ⌥ 时保持按 event.key 识别', () => {
    expect(shortcutOf(keydown({ key: 'F', code: 'KeyF', metaKey: true, shiftKey: true }))).toBe(
      'mod+shift+f',
    )
    expect(shortcutOf(keydown({ key: '+', code: 'Equal', metaKey: true }))).toBe('mod+=')
  })
})
