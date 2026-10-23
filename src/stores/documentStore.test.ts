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

describe('删除活动文档', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  function mockLibrary(options: { writeFails?: boolean } = {}) {
    const calls: string[] = []
    const writes: string[] = []
    let documents = [
      { ...DOC, path: '/library/Note.md', fileName: 'Note.md' },
      { ...DOC, path: '/library/Other.md', fileName: 'Other.md', displayTitle: 'Other' },
    ]
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      calls.push(command)
      switch (command) {
        case 'read_document':
          return { content: 'original', encoding: 'utf-8', mtime: 1000, size: 8, lineEnding: 'lf' }
        case 'write_document':
          if (options.writeFails) throw { kind: 'message', data: 'disk full' }
          writes.push(String(args.content))
          return { mtime: 1001 }
        case 'delete_document':
          documents = documents.filter((doc) => doc.path !== args.path)
          return undefined
        case 'list_documents':
          return documents
        default:
          return undefined
      }
    })
    return { calls, writes }
  }

  it('先落盘未保存内容再移入废纸篓，然后切到下一篇', async () => {
    const { calls, writes } = mockLibrary()
    const { documentStore } = await loadStores()
    documentStore.setState({ libraryPath: '/library' })
    await documentStore.getState().openDocument('/library/Note.md')

    documentStore.getState().onEditorChange('modified content')
    await documentStore.getState().deleteDocument('/library/Note.md')

    // 未保存内容随文件一起进了废纸篓，可找回
    expect(writes).toEqual(['modified content'])
    expect(calls.indexOf('write_document')).toBeLessThan(calls.indexOf('delete_document'))
    // 不再停留在已删除的文档上（否则继续打字会把文件重建出来）
    expect(documentStore.getState().activeDocument!.path).toBe('/library/Other.md')
  })

  it('落盘失败时取消删除，内容不丢', async () => {
    const { calls } = mockLibrary({ writeFails: true })
    const { documentStore } = await loadStores()
    documentStore.setState({ libraryPath: '/library' })
    await documentStore.getState().openDocument('/library/Note.md')

    documentStore.getState().onEditorChange('modified content')
    await documentStore.getState().deleteDocument('/library/Note.md')

    expect(calls).not.toContain('delete_document')
    expect(documentStore.getState().activeDocument!.path).toBe('/library/Note.md')
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

describe('标题重算（spec §7.3：编辑 H1 后 1s 内更新）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  it('自动保存已落盘后，标题仍按最新 H1 刷新', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'read_document':
          return { content: '# Old\n', encoding: 'utf-8', mtime: 1000, size: 6, lineEnding: 'lf' }
        case 'write_document':
          return { mtime: 1001 }
        case 'list_documents':
          return []
        default:
          return undefined
      }
    })

    const { documentStore } = await loadStores()
    await documentStore.getState().openDocument('/library/Note.md')
    documentStore.getState().onEditorChange('# New Title\n')
    // 500ms 自动保存先落盘（pendingText 被清空），1s 后才重算标题
    await vi.advanceTimersByTimeAsync(1200)

    expect(documentStore.getState().activeDocument!.displayTitle).toBe('New Title')
  })

  it('重命名按最新正文计算标题，而不是打开时的文本', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'read_document':
          return { content: 'no heading', encoding: 'utf-8', mtime: 1000, size: 10, lineEnding: 'lf' }
        case 'write_document':
          return { mtime: 1001 }
        case 'rename_document':
          return '/library/Renamed.md'
        case 'list_documents':
          return []
        default:
          return undefined
      }
    })

    const { documentStore } = await loadStores()
    await documentStore.getState().openDocument('/library/Note.md')
    documentStore.getState().onEditorChange('# Fresh\n')
    await vi.advanceTimersByTimeAsync(600)
    await documentStore.getState().renameDocument('/library/Note.md', 'Renamed.md')

    const active = documentStore.getState().activeDocument!
    expect(active.displayTitle).toBe('Fresh')
    expect(active.titleFromH1).toBe(true)
  })
})

describe('冲突三选一：另存副本', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  it('副本走不覆盖的 write_new_text_file，再加载磁盘版本', async () => {
    const calls: { command: string; args: Record<string, unknown> }[] = []
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      switch (command) {
        case 'read_document':
          return { content: 'mine', encoding: 'utf-8', mtime: 1000, size: 4, lineEnding: 'lf' }
        case 'write_new_text_file':
          return '/library/Note (Conflicted Copy) 2.md'
        default:
          return undefined
      }
    })

    const { documentStore, editorStore } = await loadStores()
    await documentStore.getState().openDocument('/library/Note.md')
    documentStore.getState().onEditorChange('mine, edited')
    editorStore.getState().setConflict({
      path: '/library/Note.md',
      diskMtime: 2000,
      diskContent: 'disk',
    })

    await documentStore.getState().resolveConflict('save-copy')

    const copy = calls.find((call) => call.command === 'write_new_text_file')
    expect(copy?.args).toEqual({
      path: '/library/Note (Conflicted Copy).md',
      content: 'mine, edited',
    })
    expect(calls.some((call) => call.command === 'write_text_file')).toBe(false)
    expect(documentStore.getState().activeDocument!.content).toBe('disk')
  })
})

describe('重命名撞名（spec §7.2：重名自动加 -2）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.useFakeTimers()
  })

  it('以 Rust 返回的实际文件名为准，并提示改成了什么', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'read_document':
          return { content: 'body', encoding: 'utf-8', mtime: 1000, size: 4, lineEnding: 'lf' }
        case 'rename_document':
          return '/library/t1-2.md'
        case 'list_documents':
          return []
        default:
          return undefined
      }
    })

    const { documentStore } = await loadStores()
    const { useUiStore } = await import('@/stores/uiStore')
    await documentStore.getState().openDocument('/library/new.md')

    await documentStore.getState().renameDocument('/library/new.md', 't1')

    const active = documentStore.getState().activeDocument!
    expect(active.path).toBe('/library/t1-2.md')
    expect(active.fileName).toBe('t1-2.md')
    expect(active.displayTitle).toBe('t1-2')
    expect(useUiStore.getState().toasts.some((toast) => toast.message.includes('t1-2.md'))).toBe(
      true,
    )
  })
})
