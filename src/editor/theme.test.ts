import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { inkDarkExtension } from '@/editor/theme'

describe('CM6 深浅主题（spec §8.3 / 深色模式修复）', () => {
  it('dark=true 时 darkTheme facet 为 true', () => {
    const state = EditorState.create({ extensions: [inkDarkExtension(true)] })
    expect(state.facet(EditorView.darkTheme)).toBe(true)
  })

  it('dark=false 时 darkTheme facet 为 false', () => {
    const state = EditorState.create({ extensions: [inkDarkExtension(false)] })
    expect(state.facet(EditorView.darkTheme)).toBe(false)
  })

  it('不提供 facet 时默认为浅色', () => {
    const state = EditorState.create({ extensions: [] })
    expect(state.facet(EditorView.darkTheme)).toBe(false)
  })
})
