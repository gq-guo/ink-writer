import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { invokeMock, menuNewMock, popupMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  menuNewMock: vi.fn(),
  popupMock: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNewMock },
}))

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

  it('右键弹出 收藏 / Rename / Reveal in Finder / Move to Trash，没有多余的「打开」（单击就打开了）', async () => {
    render(<Sidebar />)
    fireEvent.contextMenu(screen.getByText('今天的文档'))
    expect(await screen.findByText('加入收藏')).toBeInTheDocument()
    expect(screen.queryByText('打开')).toBeNull()
    expect(screen.getByText('重命名…')).toBeInTheDocument()
    expect(screen.getByText('在访达中显示')).toBeInTheDocument()
    expect(screen.getByText('移到废纸篓')).toBeInTheDocument()
  })

  it('页面内菜单：不带图标，危险操作用分隔线隔开，被右键的条目带框', async () => {
    const { container } = render(<Sidebar />)
    fireEvent.contextMenu(screen.getByText('今天的文档'))
    const menu = (await screen.findByRole('menu')) as HTMLElement
    expect(menu.querySelectorAll('.ink-icon')).toHaveLength(0)
    expect([...menu.children].map((child) => child.getAttribute('role') ?? '')).toEqual([
      'menuitem',
      'menuitem',
      'menuitem',
      'separator',
      'menuitem',
    ])
    expect(container.querySelector('.ink-doc-item[data-context="true"]')?.textContent).toContain('今天的文档')
    fireEvent.click(screen.getByText('在访达中显示'))
    expect(invokeMock).toHaveBeenCalledWith('reveal_in_finder', { path: '/library/a.md' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(container.querySelector('.ink-doc-item[data-context="true"]')).toBeNull()
  })

  it('App 里用 macOS 原生菜单：同样的条目与分隔线，不再画页面内菜单', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    popupMock.mockResolvedValue(undefined)
    menuNewMock.mockResolvedValue({ popup: popupMock, close: vi.fn().mockResolvedValue(undefined) })
    try {
      render(<Sidebar />)
      fireEvent.contextMenu(screen.getByText('今天的文档'))
      await vi.waitFor(() => expect(popupMock).toHaveBeenCalled())
      const items = menuNewMock.mock.calls[0]![0].items as ({ text: string; action: () => void } | { item: string })[]
      expect(items.map((item) => ('text' in item ? item.text : item.item))).toEqual([
        '加入收藏',
        '重命名…',
        '在访达中显示',
        'Separator',
        '移到废纸篓',
      ])
      expect(screen.queryByRole('menu')).toBeNull()
      ;(items[2] as { action: () => void }).action()
      expect(invokeMock).toHaveBeenCalledWith('reveal_in_finder', { path: '/library/a.md' })
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
      menuNewMock.mockReset()
      popupMock.mockReset()
    }
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

  it('有子文件夹时列出「文件夹」：点一个只看它里面的文档，回到全部恢复', () => {
    useUiStore.setState({ sidebarView: 'all', sidebarFolder: '' })
    render(<Sidebar />)
    const sub = screen.getByTitle('sub/')
    expect(sub.querySelector('.ink-nav-count')?.textContent).toBe('1')

    fireEvent.click(sub)
    expect(sub).toHaveAttribute('data-active', 'true')
    expect(screen.getByText('更早的文档')).toBeInTheDocument()
    expect(screen.queryByText('今天的文档')).toBeNull()

    fireEvent.click(screen.getByText('全部'))
    expect(screen.getByText('今天的文档')).toBeInTheDocument()
  })

  it('文件夹视图下新建文档建在这个文件夹里', async () => {
    useUiStore.setState({ sidebarView: 'folder', sidebarFolder: 'sub/' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'create_document') {
        return { path: '/library/sub/Untitled.md', fileName: 'Untitled.md', dirPrefix: 'sub/', mtime: now, size: 0, displayTitle: 'Untitled' }
      }
      if (command === 'list_documents') return documents
      if (command === 'read_document') return { content: '', encoding: 'utf-8', mtime: now, size: 0, lineEnding: 'lf' }
      return undefined
    })
    render(<Sidebar />)
    fireEvent.click(screen.getByText('新建文档'))
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('create_document', { dir: '/library/sub', baseName: 'Untitled' }),
    )
  })

  it('看着的文件夹没了：回到全部', () => {
    useUiStore.setState({ sidebarView: 'folder', sidebarFolder: 'gone/' })
    render(<Sidebar />)
    expect(useUiStore.getState().sidebarView).toBe('all')
  })

  it('没有子文件夹时不显示「文件夹」', () => {
    useDocumentStore.setState({ documents: documents.filter((document) => document.dirPrefix === '') })
    render(<Sidebar />)
    expect(screen.queryByText('文件夹')).toBeNull()
  })

  it('Sidebar 隐藏时不占空间', () => {
    useUiStore.setState({ sidebarVisible: false })
    const { container } = render(<Sidebar />)
    const aside = container.querySelector('aside')!
    expect(aside.getAttribute('data-hidden')).toBe('true')
  })
})
