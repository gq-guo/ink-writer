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
    // 每个用例自己定语言，不依赖上一个用例切过的 locale
    syncLocale('zh-CN')
    useUiStore.setState({ sidebarVisible: true, sidebarWidth: 240 })
    useDocumentStore.setState({ documents, activeDocument: null })
  })

  it('按 今天 / 昨天 / 更早 分组渲染（英文界面为 Today / Yesterday / Earlier）', () => {
    const { unmount } = render(<Sidebar />)
    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('更早')).toBeInTheDocument()
    unmount()
    syncLocale('en')
    render(<Sidebar />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Earlier')).toBeInTheDocument()
  })

  it('条目单行显示 displayTitle 与右侧短时间（分组视图下今天显示时刻）', () => {
    render(<Sidebar />)
    const item = screen.getByText('今天的文档').closest('.ink-doc-item')!
    expect(item.querySelector('.ink-doc-time')?.textContent).toMatch(/^\d{2}:\d{2}$/)
  })

  it('Recent 视图里昨天的文档按界面语言显示「昨天 / yesterday」', () => {
    useUiStore.setState({ sidebarView: 'recent' })
    syncLocale('en')
    const { unmount } = render(<Sidebar />)
    expect(screen.getByText('yesterday')).toBeInTheDocument()
    unmount()
    syncLocale('zh-CN')
    render(<Sidebar />)
    expect(screen.getByText('昨天')).toBeInTheDocument()
    useUiStore.setState({ sidebarView: 'all' })
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
    expect(screen.getByText('打开')).toBeInTheDocument()
    expect(screen.getByText('加入收藏')).toBeInTheDocument()
    expect(screen.getByText('重命名…')).toBeInTheDocument()
    expect(screen.getByText('在访达中显示')).toBeInTheDocument()
    expect(screen.getByText('移到废纸篓')).toBeInTheDocument()
  })

  it('Documents 下是 All / Recent / Favorites 与数量，底部有 New Document', () => {
    render(<Sidebar />)
    const all = screen.getByText('全部').closest('button')!
    expect(all).toHaveAttribute('data-active', 'true')
    expect(all.querySelector('.ink-nav-count')?.textContent).toBe(
      String(useDocumentStore.getState().documents.length),
    )
    expect(screen.getByText('最近')).toBeInTheDocument()
    expect(screen.getByText('收藏')).toBeInTheDocument()
    expect(screen.getByText('新建文档')).toBeInTheDocument()
  })

  it('点 Documents 折叠 / 展开导航', () => {
    render(<Sidebar />)
    const section = screen.getByText('文档').closest('button')!
    fireEvent.click(section)
    expect(section).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('最近')).toBeNull()
    fireEvent.click(section)
    expect(screen.getByText('最近')).toBeInTheDocument()
  })

  it('Sidebar 隐藏时不占空间', () => {
    useUiStore.setState({ sidebarVisible: false })
    const { container } = render(<Sidebar />)
    const aside = container.querySelector('aside')!
    expect(aside.getAttribute('data-hidden')).toBe('true')
  })
})
