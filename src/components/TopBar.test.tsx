import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
  displayTitle: 'Untitled',
  titleFromH1: false,
  openSeq: 1,
}

describe('TopBar 文件名内联重命名', () => {
  beforeEach(() => {
    syncLocale('zh-CN')
    useDocumentStore.setState({ activeDocument: DOC, saveState: 'idle' })
    useUiStore.setState({ renameSignal: 0 })
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

  it('requestRename 信号触发编辑态（命令/菜单入口）', () => {
    render(<TopBar />)
    expect(screen.queryByDisplayValue('Untitled')).not.toBeInTheDocument()
    useUiStore.getState().requestRename()
    // setTimeout(0) 延迟执行
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(screen.getByDisplayValue('Untitled')).toBeInTheDocument()
        resolve()
      }, 10),
    )
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
