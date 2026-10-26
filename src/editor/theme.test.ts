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

describe('朱砂光标与选区', () => {
  it('光标和选区用 --caret / --selection，两套主题都有定义', async () => {
    const { inkThemeSpec } = await import('@/editor/theme')
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    expect((inkThemeSpec['.cm-cursor'] as Record<string, string>).borderLeftColor).toBe('var(--caret)')
    expect((inkThemeSpec['.cm-content'] as Record<string, string>).caretColor).toBe('var(--caret)')
    const css = readFileSync(resolve(__dirname, '../styles/globals.css'), 'utf-8')
    expect(css.match(/^\s*--caret:\s*#[0-9a-f]{6};/gim)).toHaveLength(2)
  })
})
