import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'

import { inlineImages, inlineImagesField, resolveImagePath } from './inlineImages'

function widgetPaths(state: EditorState): string[] {
  const paths: string[] = []
  state.field(inlineImagesField).between(0, state.doc.length, (_from, _to, decoration) => {
    paths.push((decoration.spec.widget as { path: string }).path)
  })
  return paths
}

function create(doc: string) {
  const load = vi.fn(() => new Promise<string>(() => {}))
  const state = EditorState.create({
    doc,
    extensions: [markdown(), inlineImages({ getDocDir: () => '/lib/notes', load })],
  })
  return state
}

describe('resolveImagePath', () => {
  it('resolves relative, angle-bracket, encoded and absolute paths', () => {
    expect(resolveImagePath('assets/a.png', '/lib')).toBe('/lib/assets/a.png')
    expect(resolveImagePath('./assets/a.png', '/lib')).toBe('/lib/assets/a.png')
    expect(resolveImagePath('<assets/my shot.png>', '/lib')).toBe('/lib/assets/my shot.png')
    expect(resolveImagePath('assets/my%20shot.png', '/lib')).toBe('/lib/assets/my shot.png')
    expect(resolveImagePath('/Users/me/a.png', '/lib')).toBe('/Users/me/a.png')
  })

  it('skips remote and data images', () => {
    expect(resolveImagePath('https://example.com/a.png', '/lib')).toBeNull()
    expect(resolveImagePath('data:image/png;base64,AAAA', '/lib')).toBeNull()
  })
})

describe('inlineImagesField', () => {
  it('adds one block widget per local image', () => {
    const state = create('# T\n\n![a](assets/a.png)\n\ntext ![b](b.png "title")\n\n![c](https://x.com/c.png)')
    expect(widgetPaths(state)).toEqual(['/lib/notes/assets/a.png', '/lib/notes/b.png'])
  })

  it('ignores image syntax inside fenced code', () => {
    const state = create('```\n![a](assets/a.png)\n```\n')
    expect(widgetPaths(state)).toEqual([])
  })

  it('rescans only edited lines and keeps the rest', () => {
    let state = create('![a](a.png)\n\nplain line\n\n![b](b.png)')
    const plain = state.doc.line(3)
    state = state.update({ changes: { from: plain.from, to: plain.to, insert: '![c](c.png)' } }).state
    expect(widgetPaths(state)).toEqual(['/lib/notes/a.png', '/lib/notes/c.png', '/lib/notes/b.png'])

    const first = state.doc.line(1)
    state = state.update({ changes: { from: first.from, to: first.to, insert: 'no image' } }).state
    expect(widgetPaths(state)).toEqual(['/lib/notes/c.png', '/lib/notes/b.png'])
  })
})
