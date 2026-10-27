import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { Decoration } from '@codemirror/view'

import { buildDecorations, concealMarkupFacet, imageFileName } from '@/editor/styledSource'

/** 隐藏标记模式下这一行看到的文字（光标在 cursor 处） */
function shown(doc: string, cursor: number): string {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(true)],
  })
  ensureSyntaxTree(state, state.doc.length)
  const hidden: [number, number][] = []
  const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
  while (iter.value) {
    const spec = (iter.value as Decoration & { spec?: { class?: string; widget?: unknown } }).spec
    if (iter.from < iter.to && !spec?.class && !spec?.widget) hidden.push([iter.from, iter.to])
    iter.next()
  }
  const line = state.doc.line(1)
  let out = ''
  for (let pos = line.from; pos < line.to; pos++) {
    if (!hidden.some(([from, to]) => pos >= from && pos < to)) out += doc[pos]
  }
  return out
}

describe('图片地址里的文件名', () => {
  const name = (url: string) => {
    const range = imageFileName(url)
    return range ? url.slice(range.from, range.to) : null
  }

  it('取最后一段，去掉 ?query / #fragment 与尖括号', () => {
    expect(name('assets/new_icon-2.png')).toBe('new_icon-2.png')
    expect(name('photo.png')).toBe('photo.png')
    expect(name('assets/a.png?v=1#top')).toBe('a.png')
    expect(name('<assets/有 空格.png>')).toBe('有 空格.png')
    expect(name('https://example.com/img/logo.svg')).toBe('logo.svg')
  })

  it('以 / 结尾（没有文件名）返回 null', () => {
    expect(name('assets/')).toBeNull()
  })
})

describe('图片行在光标外只显示文件名', () => {
  const doc = '![new_icon](assets/new_icon-2.png)\n\n正文'

  it('光标不在这一行：只剩文件名', () => {
    expect(shown(doc, doc.length)).toBe('new_icon-2.png')
  })

  it('光标在这一行：显示完整源码，方便编辑', () => {
    expect(shown(doc, 3)).toBe('![new_icon](assets/new_icon-2.png)')
  })

  it('带标题的图片也只剩文件名', () => {
    const titled = '![图](assets/a.png "标题")\n\n正文'
    expect(shown(titled, titled.length)).toBe('a.png')
  })
})
