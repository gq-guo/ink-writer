import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
    useUiStore.setState({ quickOpenVisible: true })
  })

  it('打开时显示全部文档（按最近修改排序）', () => {
    render(<QuickOpen />)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText('Readme')).toBeInTheDocument()
  })

  it('输入过滤文档', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents')
    fireEvent.change(input, { target: { value: 'read' } })
    expect(screen.getByText('Readme')).toBeInTheDocument()
    expect(screen.queryByText('Hello World')).not.toBeInTheDocument()
  })

  it('无匹配时显示提示', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents')
    fireEvent.change(input, { target: { value: 'zzzzzz' } })
    expect(screen.getByText('No matching documents')).toBeInTheDocument()
  })

  it('回车打开选中的文档', () => {
    const openDocument = vi.fn()
    useDocumentStore.setState({ openDocument } as never)
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(openDocument).toHaveBeenCalledWith('/library/hello.md')
  })

  it('Esc 关闭', () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useUiStore.getState().quickOpenVisible).toBe(false)
  })

  it('查询 ≥2 字符时触发正文搜索', async () => {
    render(<QuickOpen />)
    const input = screen.getByPlaceholderText('Search documents')
    fireEvent.change(input, { target: { value: 'keyword' } })
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((call) => call[0] === 'search_content')
      expect(calls.length).toBeGreaterThan(0)
    })
  })
})
