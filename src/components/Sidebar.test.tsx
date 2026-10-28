import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'

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
    useDocumentStore.setState({ documents, folders: [], activeDocument: null })
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
      'group',
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
      type NativeItem = { text: string; action?: () => void; items?: NativeItem[] } | { item: string }
      const items = menuNewMock.mock.calls[0]![0].items as NativeItem[]
      expect(items.map((item) => ('text' in item ? item.text : item.item))).toEqual([
        '加入收藏',
        '重命名…',
        '移到',
        '在访达中显示',
        'Separator',
        '移到废纸篓',
      ])
      // 「移到」是二级菜单：列出别的文件夹（文档已经在库根目录，不再列出根目录）
      const moveTo = items[2] as { items: { text: string }[] }
      expect(moveTo.items.map((item) => item.text)).toEqual(['sub'])
      expect(screen.queryByRole('menu')).toBeNull()
      ;(items[3] as { action: () => void }).action()
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

  it('没有子文件夹时也有「文件夹」标题和新建按钮，可以建第一个', () => {
    useDocumentStore.setState({ documents: documents.filter((document) => document.dirPrefix === ''), folders: [] })
    render(<Sidebar />)
    expect(screen.getByText('文件夹')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeInTheDocument()
  })

  it('点 + 新建文件夹：输入名字回车后建在库根目录，不自动切进去', async () => {
    useUiStore.setState({ sidebarView: 'all', sidebarFolder: '' })
    useDocumentStore.setState({ libraryPath: '/library', folders: [] })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_documents') return documents
      if (command === 'list_folders') return ['Drafts/', 'sub/']
      return undefined
    })
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const input = screen.getByPlaceholderText('文件夹名称')
    fireEvent.change(input, { target: { value: 'Drafts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('create_folder', { parent: '/library', name: 'Drafts' }),
    )
    expect(invokeMock.mock.calls.filter((call) => call[0] === 'create_folder')).toHaveLength(1)
    // 建完留在原处，新建文档不会被动跟着进这个文件夹
    expect(useUiStore.getState().sidebarView).toBe('all')
    expect(useUiStore.getState().sidebarFolder).toBe('')
    // 空文件夹也列出来（来自 list_folders），数量 0
    expect((await screen.findByTitle('Drafts/')).querySelector('.ink-nav-count')?.textContent).toBe('0')
  })

  it('正看着某个文件夹时点 +：仍然建在库根目录，可以建多个并列的父文件夹', async () => {
    useUiStore.setState({ sidebarView: 'folder', sidebarFolder: 'sub/' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockResolvedValue([])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const input = screen.getByPlaceholderText('文件夹名称')
    fireEvent.change(input, { target: { value: '草稿' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('create_folder', { parent: '/library', name: '草稿' }),
    )
  })

  it('右键文件夹「新建子文件夹」：建在它里面', async () => {
    useUiStore.setState({ sidebarView: 'all', sidebarFolder: '' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockResolvedValue([])
    render(<Sidebar />)
    fireEvent.contextMenu(screen.getByTitle('sub/'))
    fireEvent.click(await screen.findByText('新建子文件夹…'))
    const input = screen.getByPlaceholderText('文件夹名称')
    fireEvent.change(input, { target: { value: '草稿' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('create_folder', { parent: '/library/sub', name: '草稿' }),
    )
  })

  it('右键文件夹「重命名…」：原地改名，正在看的文件夹也跟着换路径', async () => {
    useUiStore.setState({ sidebarView: 'folder', sidebarFolder: 'sub/' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'rename_folder') return '/library/drafts'
      if (command === 'list_documents') return [{ ...documents[2], path: '/library/drafts/c.md', dirPrefix: 'drafts/' }]
      if (command === 'list_folders') return ['drafts/']
      return undefined
    })
    render(<Sidebar />)
    fireEvent.contextMenu(screen.getByTitle('sub/'))
    fireEvent.click(await screen.findByText('重命名…'))
    const input = screen.getByRole('textbox', { name: 'sub' })
    fireEvent.change(input, { target: { value: 'drafts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('rename_folder', { path: '/library/sub', newName: 'drafts' }),
    )
    await vi.waitFor(() => expect(screen.getByTitle('drafts/')).toBeInTheDocument())
    expect(useUiStore.getState().sidebarFolder).toBe('drafts/')
  })

  it('双击文件夹也能改名', async () => {
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockResolvedValue([])
    render(<Sidebar />)
    fireEvent.doubleClick(screen.getByTitle('sub/'))
    expect(screen.getByRole('textbox', { name: 'sub' })).toHaveValue('sub')
  })

  it('右键「移到」把文档移到别的文件夹', async () => {
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'move_document') return '/library/sub/a.md'
      if (command === 'list_documents') return documents
      if (command === 'list_folders') return ['sub/']
      return undefined
    })
    render(<Sidebar />)
    fireEvent.contextMenu(screen.getByText('今天的文档'))
    const group = await screen.findByRole('group', { name: '移到' })
    fireEvent.click(group.querySelector('[role="menuitem"]')!)
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('move_document', { path: '/library/a.md', targetDir: '/library/sub' }),
    )
  })

  it('有标签时显示「标签」：数量是文档数，点一个只看用到它的文档', async () => {
    useUiStore.setState({ sidebarView: 'all', sidebarTag: '' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_tags') return [{ tag: '野餐', count: 3, paths: ['/library/b.md'] }]
      return []
    })
    render(<Sidebar />)
    const tag = await screen.findByTitle('#野餐', {}, { timeout: 2000 })
    expect(tag.querySelector('.ink-nav-count')?.textContent).toBe('1')
    fireEvent.click(tag)
    expect(useUiStore.getState().sidebarView).toBe('tag')
    expect(screen.getByText('昨天的文档')).toBeInTheDocument()
    expect(screen.queryByText('今天的文档')).toBeNull()
  })

  it('当前文档保存完后重新统计标签（保存不会刷新文档列表）', async () => {
    useDocumentStore.setState({ libraryPath: '/library', saveState: 'idle' })
    invokeMock.mockImplementation(async (command: string) => (command === 'list_tags' ? [] : undefined))
    render(<Sidebar />)
    const calls = () => invokeMock.mock.calls.filter((call) => call[0] === 'list_tags').length
    await vi.waitFor(() => expect(calls()).toBe(1), { timeout: 2000 })
    act(() => useDocumentStore.setState({ saveState: 'saved' }))
    await vi.waitFor(() => expect(calls()).toBe(2), { timeout: 2000 })
  })

  it('换了文档库：旧库的标签不再显示', async () => {
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string, args?: { root?: string }) =>
      command === 'list_tags' && args?.root === '/library' ? [{ tag: '旧库', count: 1, paths: ['/library/a.md'] }] : [],
    )
    render(<Sidebar />)
    expect(await screen.findByTitle('#旧库', {}, { timeout: 2000 })).toBeInTheDocument()
    act(() => useDocumentStore.setState({ libraryPath: '/other' }))
    expect(screen.queryByTitle('#旧库')).toBeNull()
  })

  it('看着的标签没了：回到全部', async () => {
    useUiStore.setState({ sidebarView: 'tag', sidebarTag: 'gone' })
    useDocumentStore.setState({ libraryPath: '/library' })
    invokeMock.mockImplementation(async (command: string) => (command === 'list_tags' ? [] : undefined))
    render(<Sidebar />)
    await vi.waitFor(() => expect(useUiStore.getState().sidebarView).toBe('all'), { timeout: 2000 })
  })

  it('Sidebar 隐藏时不占空间', () => {
    useUiStore.setState({ sidebarVisible: false })
    const { container } = render(<Sidebar />)
    const aside = container.querySelector('aside')!
    expect(aside.getAttribute('data-hidden')).toBe('true')
  })
})
