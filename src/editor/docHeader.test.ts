import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { inkDocHeader, setDocHeaderEffect, type DocHeaderInfo } from '@/editor/docHeader'

const INFO: DocHeaderInfo = { meta: ['Today, 10:00'] }

function mount(doc: string, info: DocHeaderInfo | null = INFO) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [inkDocHeader] }),
  })
  view.dispatch({ effects: setDocHeaderEffect.of(info) })
  return view
}

describe('文档头 widget 的位置', () => {
  it('首个非空行是 H1：元信息放在 H1 下方，不显示文件名大标题', () => {
    const view = mount('\n# Title\n\nbody')
    const header = view.dom.querySelector('.ink-doc-header') as HTMLElement
    expect(header.dataset.afterH1).toBe('true')
    expect(header.querySelector('.ink-doc-heading')).toBeNull()
    // widget 紧跟在 H1 行之后
    expect(header.previousElementSibling?.textContent).toBe('# Title')
    view.destroy()
  })

  it('没有前导 H1：放在正文最上方，不画文件名大标题（文件名就是文档名，显示在侧栏和顶栏）', () => {
    const view = mount('body first\n\n# Later')
    const header = view.dom.querySelector('.ink-doc-header') as HTMLElement
    expect(header.dataset.afterH1).toBe('false')
    expect(header.querySelector('.ink-doc-heading')).toBeNull()
    expect(header.textContent).toBe('Today, 10:00')
    expect(view.dom.querySelector('.cm-content')?.firstElementChild).toBe(header)
    view.destroy()
  })

  it('编辑首行把它改成 H1 后，文档头移到 H1 下方', () => {
    const view = mount('Title\n\nbody')
    view.dispatch({ changes: { from: 0, insert: '# ' } })
    const header = view.dom.querySelector('.ink-doc-header') as HTMLElement
    expect(header.dataset.afterH1).toBe('true')
    view.destroy()
  })

  it('推送 null（侧栏收起 / Focus Mode）时不显示', () => {
    const view = mount('# Title', null)
    expect(view.dom.querySelector('.ink-doc-header')).toBeNull()
    view.destroy()
  })
})
