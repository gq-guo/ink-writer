import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { Sidebar } from '@/components/Sidebar'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import { syncLocale } from '@/lib/i18n'

const now = Date.now() / 1000

const documents = [
  {
    path: '/library/a.md',
    fileName: 'a.md',
    dirPrefix: '',
    mtime: now - 10,
    size: 10,
    displayTitle: '今天的文档',
  },
  {
    path: '/library/b.md',
    fileName: 'b.md',
    dirPrefix: '',
    mtime: now - 86400,
    size: 10,
    displayTitle: '昨天的文档',
  },
  {
    path: '/library/sub/c.md',
    fileName: 'c.md',
    dirPrefix: 'sub/',
    mtime: now - 86400 * 30,
    size: 10,
    displayTitle: '更早的文档',
  },
]

describe('Sidebar（spec W2）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useUiStore.setState({ sidebarVisible: true, sidebarWidth: 240 })
    useDocumentStore.setState({ documents, activeDocument: null })
  })

  it('按 Today / Yesterday / Earlier 分组渲染', () => {
    render(<Sidebar />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('Earlier')).toBeInTheDocument()
  })

  it('相对时间跟随界面语言（英文界面不显示「分钟前」）', () => {
    syncLocale('en')
    render(<Sidebar />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('条目显示 displayTitle 与相对时间', () => {
    syncLocale('zh-CN')
    render(<Sidebar />)
    expect(screen.getByText('今天的文档')).toBeInTheDocument()
    expect(screen.getByText('刚刚')).toBeInTheDocument()
  })

  it('点击条目打开文档', () => {
    const openDocument = vi.fn()
    useDocumentStore.setState({ openDocument } as never)
    render(<Sidebar />)
    fireEvent.click(screen.getByText('今天的文档'))
    expect(openDocument).toHaveBeenCalledWith('/library/a.md')
  })

  it('右键弹出 Open / 收藏 / Rename / Reveal in Finder / Move to Trash', () => {
    render(<Sidebar />)
    fireEvent.contextMenu(screen.getByText('今天的文档'))
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Add to Favorites')).toBeInTheDocument()
    expect(screen.getByText('Rename…')).toBeInTheDocument()
    expect(screen.getByText('Reveal in Finder')).toBeInTheDocument()
    expect(screen.getByText('Move to Trash')).toBeInTheDocument()
  })

  it('顶部有 All Documents / Recent / Favorites 导航与 New Document 按钮', () => {
    render(<Sidebar />)
    expect(screen.getByText('All Documents')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('New Document')).toBeInTheDocument()
  })

  it('Sidebar 隐藏时不占空间', () => {
    useUiStore.setState({ sidebarVisible: false })
    const { container } = render(<Sidebar />)
    const aside = container.querySelector('aside')!
    expect(aside.getAttribute('data-hidden')).toBe('true')
  })
})
