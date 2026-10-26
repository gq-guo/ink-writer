import { describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

import { EditorHost } from '@/components/EditorHost'
import { GlobalShortcuts } from '@/components/GlobalShortcuts'
import { syncLocale } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { editorBridge } from '@/editor/bridge'

const DOC = {
  path: '/library/Note.md',
  fileName: 'Note.md',
  dirPrefix: '',
  mtime: 1000,
  size: 5,
  content: 'hello',
  originalEncoding: 'utf-8' as const,
  displayTitle: 'Note',
  titleFromH1: false,
  openSeq: 1,
}

describe('EditorHost 切换语言', () => {
  it('不重建编辑器：打开后的输入不会被回滚', async () => {
    syncLocale('zh-CN')
    useDocumentStore.setState({ activeDocument: DOC, saveState: 'idle' })
    const { container } = render(<EditorHost />)

    let view: EditorView | null = null
    await waitFor(() => {
      const dom = container.querySelector('.cm-editor') as HTMLElement | null
      view = dom ? EditorView.findFromDOM(dom) : null
      expect(view?.state.doc.toString()).toBe('hello')
    })

    act(() => {
      view!.dispatch({ changes: { from: 5, insert: ' world' } })
    })
    act(() => {
      syncLocale('en')
    })

    expect(view!.state.doc.toString()).toBe('hello world')
  })

  it('切换语言后再打开别的文档：占位提示仍是当前语言（切换文档会整体替换 EditorState）', async () => {
    syncLocale('zh-CN')
    useDocumentStore.setState({ activeDocument: { ...DOC, content: '', openSeq: 10 }, saveState: 'idle' })
    const { container } = render(<EditorHost />)
    await waitFor(() => expect(container.querySelector('.cm-placeholder')?.textContent).toBe('开始写作…'))

    act(() => syncLocale('en'))
    await waitFor(() => expect(container.querySelector('.cm-placeholder')?.textContent).toBe('Start writing…'))

    act(() => {
      useDocumentStore.setState({ activeDocument: { ...DOC, path: '/library/Other.md', content: '', openSeq: 11 } })
    })
    await waitFor(() => expect(container.querySelector('.cm-placeholder')?.textContent).toBe('Start writing…'))
    syncLocale('zh-CN')
  })
})

async function mountEditor(): Promise<{ view: EditorView; container: HTMLElement }> {
  useDocumentStore.setState({ activeDocument: DOC, saveState: 'idle' })
  const { container } = render(<EditorHost />)
  let view: EditorView | null = null
  await waitFor(() => {
    const dom = container.querySelector('.cm-editor') as HTMLElement | null
    view = dom ? EditorView.findFromDOM(dom) : null
    expect(view).not.toBeNull()
  })
  return { view: view!, container }
}

describe('EditorHost 打字降噪', () => {
  it('用户输入时标记 typing（顶栏 / 状态栏淡出），程序替换全文不算', async () => {
    useEditorStore.setState({ typing: false })
    const { view } = await mountEditor()

    act(() => editorBridge.setContent('replaced by program'))
    expect(useEditorStore.getState().typing).toBe(false)

    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    })
    expect(useEditorStore.getState().typing).toBe(true)
  })
})

describe('EditorHost 文档头', () => {
  it('侧栏展开时显示元信息，Focus Mode 下隐藏', async () => {
    useUiStore.setState({ sidebarVisible: true })
    useEditorStore.setState({ focusMode: false })
    const { container } = await mountEditor()
    await waitFor(() => expect(container.querySelector('.ink-doc-meta')).not.toBeNull())

    act(() => useEditorStore.setState({ focusMode: true }))
    await waitFor(() => expect(container.querySelector('.ink-doc-header')).toBeNull())
    act(() => useEditorStore.setState({ focusMode: false }))
  })
})

describe('EditorHost 切换任务', () => {
  it('⌘L 经命令与编辑器桥接切换光标所在行', async () => {
    render(<GlobalShortcuts />)
    const { view } = await mountEditor()
    act(() => view.dispatch({ selection: { anchor: 2 } }))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }))
    })
    expect(view.state.doc.toString()).toBe('- [ ] hello')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }))
    })
    expect(view.state.doc.toString()).toBe('- [x] hello')
  })

  it('焦点在别的输入框、Ctrl+L、按住连发：都不改正文', async () => {
    render(<GlobalShortcuts />)
    const { view } = await mountEditor()
    act(() => view.dispatch({ selection: { anchor: 2 } }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true }))
    })
    expect(view.state.doc.toString()).toBe('hello')
    expect(document.activeElement).toBe(input)
    input.remove()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, repeat: true }))
    })
    expect(view.state.doc.toString()).toBe('hello')
  })
})
