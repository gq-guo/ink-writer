import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

type DocumentStore = typeof import('@/stores/documentStore')['useDocumentStore']
type EditorStore = typeof import('@/stores/editorStore')['useEditorStore']

async function loadStores() {
  vi.resetModules()
  const documentModule = await import('@/stores/documentStore')
  const editorModule = await import('@/stores/editorStore')
  return {
    documentStore: documentModule.useDocumentStore as DocumentStore,
    editorStore: editorModule.useEditorStore as EditorStore,
  }
}

const DOC = {
  path: '/library/Note.md',
  fileName: 'Note.md',
  dirPrefix: '',
  mtime: 1000,
  size: 12,
  displayTitle: 'Note',
}

describe('rename 的元数据隔离', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  it('rename 只改元数据：openSeq 与 content 不变（编辑器不重建、光标不丢）', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'read_document':
          return { content: 'hello', encoding: 'utf-8', mtime: 1000, size: 5, lineEnding: 'lf' }
        case 'rename_document':
          return '/library/New Name.md'
        case 'list_documents':
          return []
        default:
          return undefined
      }
    })

    const { documentStore } = await loadStores()
    await documentStore.getState().openDocument('/library/Old.md')
    const before = documentStore.getState().activeDocument!

    await documentStore.getState().renameDocument('/library/Old.md', 'New Name.md')

    const after = documentStore.getState().activeDocument!
    expect(after.fileName).toBe('New Name.md')
    expect(after.path).toBe('/library/New Name.md')
    // 关键：openSeq 不变 → EditorHost 不会重建 EditorState → 光标与滚动位置保持
    expect(after.openSeq).toBe(before.openSeq)
    expect(after.content).toBe(before.content)
  })
})

describe('documentStore 自动保存状态机（spec §12.1 / §19.2）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  it('输入后 500ms 自动落盘，磁盘内容与编辑器一致', async () => {
    const { documentStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: 'hello', encoding: 'utf-8', mtime: 1000, size: 5, lineEnding: 'lf' }
      }
      if (command === 'write_document') return { mtime: 1001 }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    expect(documentStore.getState().saveState).toBe('idle')

    documentStore.getState().onEditorChange('hello world')
    expect(documentStore.getState().saveState).toBe('dirty')

    await vi.advanceTimersByTimeAsync(500)

    const writeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'write_document')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]![1]).toMatchObject({ path: DOC.path, content: 'hello world' })
    expect(documentStore.getState().saveState).toBe('saved')
  })

  it('连续输入只在防抖结束后写一次', async () => {
    const { documentStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: '', encoding: 'utf-8', mtime: 1000, size: 0, lineEnding: 'lf' }
      }
      if (command === 'write_document') return { mtime: 1001 }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    for (let i = 0; i < 10; i++) {
      documentStore.getState().onEditorChange('x'.repeat(i + 1))
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(500)

    const writeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'write_document')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]![1]).toMatchObject({ content: 'x'.repeat(10) })
  })

  it('写盘中继续输入 → 队列合并，不丢内容', async () => {
    const { documentStore } = await loadStores()
    let resolveWrite: ((value: { mtime: number }) => void) | null = null
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: '', encoding: 'utf-8', mtime: 1000, size: 0, lineEnding: 'lf' }
      }
      if (command === 'write_document') {
        return new Promise((resolve) => {
          resolveWrite = resolve
        })
      }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    documentStore.getState().onEditorChange('first')
    await vi.advanceTimersByTimeAsync(500)

    // 第一次写入进行中
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'write_document')).toHaveLength(1)

    // 写入期间继续输入
    documentStore.getState().onEditorChange('first second')
    resolveWrite!({ mtime: 1001 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)

    const writeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'write_document')
    expect(writeCalls.length).toBeGreaterThanOrEqual(2)
    const last = writeCalls[writeCalls.length - 1]![1] as { content: string }
    expect(last.content).toBe('first second')
  })

  it('⌘S 时正在 saving → 合并为一次最终写入', async () => {
    const { documentStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: '', encoding: 'utf-8', mtime: 1000, size: 0, lineEnding: 'lf' }
      }
      if (command === 'write_document') return { mtime: 1001 }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    documentStore.getState().onEditorChange('content')
    await vi.advanceTimersByTimeAsync(500)

    const before = invokeMock.mock.calls.filter((c) => c[0] === 'write_document').length
    await documentStore.getState().flushSave()
    const after = invokeMock.mock.calls.filter((c) => c[0] === 'write_document').length
    // 内容没有变化 → 不产生额外写入
    expect(after).toBe(before)
  })

  it('外部修改 + 有 pending 输入 → 弹出三选一冲突对话框', async () => {
    const { documentStore, editorStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: 'mine', encoding: 'utf-8', mtime: 1000, size: 4, lineEnding: 'lf' }
      }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    documentStore.getState().onEditorChange('mine changed')

    await documentStore
      .getState()
      .handleExternalEvent({ path: DOC.path, kind: 'modify' })

    expect(documentStore.getState().saveState).toBe('conflict')
    const conflict = editorStore.getState().conflict
    expect(conflict).not.toBeNull()
    expect(conflict!.path).toBe(DOC.path)
  })

  it('外部修改 + 无 pending 输入 → 静默刷新', async () => {
    const { documentStore, editorStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: 'disk version', encoding: 'utf-8', mtime: 2000, size: 11, lineEnding: 'lf' }
      }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    await documentStore
      .getState()
      .handleExternalEvent({ path: DOC.path, kind: 'modify' })

    expect(editorStore.getState().conflict).toBeNull()
    expect(documentStore.getState().saveState).toBe('idle')
    expect(documentStore.getState().activeDocument?.content).toBe('disk version')
  })

  it('冲突选择「加载磁盘版本」会丢弃内存内容', async () => {
    const { documentStore, editorStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: 'disk', encoding: 'utf-8', mtime: 2000, size: 4, lineEnding: 'lf' }
      }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    documentStore.getState().onEditorChange('mine')
    await documentStore.getState().handleExternalEvent({ path: DOC.path, kind: 'modify' })
    expect(editorStore.getState().conflict).not.toBeNull()

    await documentStore.getState().resolveConflict('load-disk')

    expect(editorStore.getState().conflict).toBeNull()
    expect(documentStore.getState().saveState).toBe('idle')
    expect(documentStore.getState().activeDocument?.content).toBe('disk')
  })

  it('冲突选择「保留我的版本」会强制写盘', async () => {
    const { documentStore, editorStore } = await loadStores()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_document') {
        return { content: 'disk', encoding: 'utf-8', mtime: 2000, size: 4, lineEnding: 'lf' }
      }
      if (command === 'write_document') return { mtime: 2001 }
      return undefined
    })

    await documentStore.getState().openDocument(DOC.path)
    documentStore.getState().onEditorChange('mine')
    await documentStore.getState().handleExternalEvent({ path: DOC.path, kind: 'modify' })

    await documentStore.getState().resolveConflict('keep-mine')
    await vi.advanceTimersByTimeAsync(0)

    const writeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'write_document')
    expect(writeCalls.length).toBeGreaterThanOrEqual(1)
    expect(editorStore.getState().conflict).toBeNull()
  })
})
