import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { QuickOpen } from '@/components/QuickOpen'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'

const documents = [
  {
    path: '/library/hello.md',
    fileName: 'hello.md',
    dirPrefix: '',
    mtime: 1000,
    size: 10,
    displayTitle: 'Hello World',
  },
  {
    path: '/library/Project/README.md',
    fileName: 'README.md',
    dirPrefix: 'Project/',
    mtime: 900,
    size: 10,
    displayTitle: 'Readme',
  },
]

describe('Quick Open（spec W3）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
    useDocumentStore.setState({ documents, activeDocument: null, libraryPath: '/library' })
    useUiStore.setState({ quickOpenVisible: true, quickOpenQuery: '' })
  })

  it('打开时显示全部文档（按最近修改排序）', () => {
    render(<QuickOpen />)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText('Readme')).toBeInTheDocument()
  })

  it('输入过滤文档', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags')
    fireEvent.change(input, { target: { value: 'read' } })
    expect(screen.getByText('Readme')).toBeInTheDocument()
    expect(screen.queryByText('Hello World')).not.toBeInTheDocument()
  })

  it('无匹配时显示提示', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags')
    fireEvent.change(input, { target: { value: 'zzzzzz' } })
    expect(screen.getByText('No matching documents')).toBeInTheDocument()
  })

  it('回车打开选中的文档', () => {
    const openDocument = vi.fn()
    useDocumentStore.setState({ openDocument } as never)
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(openDocument).toHaveBeenCalledWith('/library/hello.md')
  })

  it('Esc 关闭', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useUiStore.getState().quickOpenVisible).toBe(false)
  })

  it('查询 ≥2 字符时触发正文搜索', async () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags')
    fireEvent.change(input, { target: { value: 'keyword' } })
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((call) => call[0] === 'search_content')
      expect(calls.length).toBeGreaterThan(0)
    })
  })

  it('# 开头进入标签模式：列出匹配的标签，不显示文件结果', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_tags') return [{ tag: 'work', count: 3 }, { tag: 'writing', count: 1 }, { tag: 'idea', count: 2 }]
      return []
    })
    render(<QuickOpen />)
    fireEvent.change(screen.getByPlaceholderText('Search documents, # for tags'), { target: { value: '#w' } })
    expect(await screen.findByText('#work')).toBeInTheDocument()
    expect(screen.getByText('#writing')).toBeInTheDocument()
    expect(screen.queryByText('#idea')).toBeNull()
    expect(screen.queryByText('Hello World')).toBeNull()
  })

  it('选中标签补全到输入框，并列出带这个标签的段落；回车打开到标签位置', async () => {
    const openDocument = vi.fn()
    useDocumentStore.setState({ openDocument })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_tags') return [{ tag: 'work', count: 1 }]
      if (command === 'search_tags') {
        return [
          { path: '/library/a.md', fileName: 'a.md', dirPrefix: '', line: 3, snippet: '开会 #work', start: 20, end: 25, tag: 'work' },
        ]
      }
      return []
    })
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents, # for tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: '#wo' } })
    fireEvent.click(await screen.findByText('#work'))
    expect(input.value).toBe('#work')
    expect(useUiStore.getState().quickOpenVisible).toBe(true)

    expect(await screen.findByText('开会 #work')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('search_tags', { root: '/library', query: 'work' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(openDocument).toHaveBeenCalledWith('/library/a.md', [20, 25])
  })

  it('带着搜索词打开（⌘Click 标签）：输入框换成这个词', async () => {
    useUiStore.setState({ quickOpenVisible: false })
    render(<QuickOpen />)
    act(() => useUiStore.getState().showQuickOpen('#plan'))
    const input = (await screen.findByPlaceholderText('Search documents, # for tags')) as HTMLInputElement
    expect(input.value).toBe('#plan')
  })

  it('重新打开时重新搜索标签段落（文档可能改过），不沿用上次的位置', async () => {
    const openDocument = vi.fn()
    useDocumentStore.setState({ openDocument })
    let start = 10
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'search_tags') {
        return [{ path: '/library/a.md', fileName: 'a.md', dirPrefix: '', line: 1, snippet: '#foo', start, end: start + 4, tag: 'foo' }]
      }
      return []
    })
    useUiStore.setState({ quickOpenVisible: false })
    render(<QuickOpen />)
    act(() => useUiStore.getState().showQuickOpen('#foo'))
    expect(await screen.findByText('#foo')).toBeInTheDocument()
    act(() => useUiStore.getState().hideQuickOpen())

    start = 50
    act(() => useUiStore.getState().showQuickOpen('#foo'))
    await waitFor(() => expect(invokeMock.mock.calls.filter((call) => call[0] === 'search_tags')).toHaveLength(2))
    const input = await screen.findByPlaceholderText('Search documents, # for tags')
    await waitFor(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(openDocument).toHaveBeenLastCalledWith('/library/a.md', [50, 54])
    })
  })
})
