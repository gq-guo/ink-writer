import { describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

import { EditorHost } from '@/components/EditorHost'
import { syncLocale } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'

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
})
