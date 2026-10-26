import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

import { TopBar } from '@/components/TopBar'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import { syncLocale } from '@/lib/i18n'

const DOC = {
  path: '/library/Untitled.md',
  fileName: 'Untitled.md',
  dirPrefix: '',
  mtime: 1000,
  size: 10,
  content: '',
  originalEncoding: 'utf-8' as const,
  // 首行 H1 与文件名不同，顶栏才显示文件名（同名属于重复信息，见下方用例）
  displayTitle: 'My Draft',
  titleFromH1: true,
  openSeq: 1,
}

describe('TopBar 文件名内联重命名', () => {
  beforeEach(() => {
    syncLocale('zh-CN')
    useDocumentStore.setState({ activeDocument: DOC, saveState: 'idle' })
    useUiStore.setState({ renameSignal: 0, sidebarVisible: true })
  })

  it('文件名与正文可见的标题同名时不显示', () => {
    useDocumentStore.setState({ activeDocument: { ...DOC, displayTitle: 'Untitled' } })
    render(<TopBar />)
    expect(screen.queryByText('Untitled.md')).not.toBeInTheDocument()
  })

  it('无 H1 且侧栏收起（文档头不显示）时，同名也保留文件名', () => {
    useDocumentStore.setState({ activeDocument: { ...DOC, displayTitle: 'Untitled', titleFromH1: false } })
    useUiStore.setState({ sidebarVisible: false })
    render(<TopBar />)
    expect(screen.getByText('Untitled.md')).toBeInTheDocument()
  })

  it('同名被隐藏时，命令触发的重命名仍能进入编辑态', async () => {
    useDocumentStore.setState({ activeDocument: { ...DOC, displayTitle: 'Untitled' } })
    render(<TopBar />)
    act(() => useUiStore.getState().requestRename())
    expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument()
  })

  it('点击文件名进入编辑态（不用 window.prompt）', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByText('Untitled.md'))
    const input = screen.getByDisplayValue('Untitled')
    expect(input).toBeInTheDocument()
  })

  it('回车提交重命名（自动补 .md 扩展名）', () => {
    const renameDocument = vi.fn()
    useDocumentStore.setState({ renameDocument } as never)
    render(<TopBar />)
    fireEvent.click(screen.getByText('Untitled.md'))
    const input = screen.getByDisplayValue('Untitled')
    fireEvent.change(input, { target: { value: 'My Notes' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameDocument).toHaveBeenCalledWith(DOC.path, 'My Notes.md')
  })

  it('Esc 取消，不提交', () => {
    const renameDocument = vi.fn()
    useDocumentStore.setState({ renameDocument } as never)
    render(<TopBar />)
    fireEvent.click(screen.getByText('Untitled.md'))
    const input = screen.getByDisplayValue('Untitled')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(renameDocument).not.toHaveBeenCalled()
  })

  it('requestRename 信号触发编辑态（命令/菜单入口）', async () => {
    render(<TopBar />)
    expect(screen.queryByDisplayValue('Untitled')).not.toBeInTheDocument()
    act(() => useUiStore.getState().requestRename())
    // 组件内用 setTimeout(0) 延迟进入编辑态；findBy* 在 act 里轮询等待
    expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument()
  })

  it('排版面板 Esc 关闭', async () => {
    const user = userEvent.setup()
    render(<TopBar />)
    await user.click(screen.getByTitle('排版'))
    expect(screen.getByText('写作字体')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('写作字体')).not.toBeInTheDocument()
  })

  it('Aa 按钮第二次点击收起排版面板', async () => {
    const user = userEvent.setup()
    render(<TopBar />)
    const aaButton = screen.getByTitle('排版')
    await user.click(aaButton)
    expect(screen.getByText('写作字体')).toBeInTheDocument()
    await user.click(aaButton)
    expect(screen.queryByText('写作字体')).not.toBeInTheDocument()
  })

  it('Enter 提交 + blur 不会触发两次 rename（防重入）', () => {
    const renameDocument = vi.fn()
    useDocumentStore.setState({ renameDocument } as never)
    render(<TopBar />)
    fireEvent.click(screen.getByText('Untitled.md'))
    const input = screen.getByDisplayValue('Untitled')
    fireEvent.change(input, { target: { value: 'Once' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(renameDocument).toHaveBeenCalledTimes(1)
    expect(renameDocument).toHaveBeenCalledWith(DOC.path, 'Once.md')
  })

  it('名称不变时不触发写入', () => {
    const renameDocument = vi.fn()
    useDocumentStore.setState({ renameDocument } as never)
    render(<TopBar />)
    fireEvent.click(screen.getByText('Untitled.md'))
    const input = screen.getByDisplayValue('Untitled')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameDocument).not.toHaveBeenCalled()
  })
})
