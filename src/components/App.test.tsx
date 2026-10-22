import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn().mockResolvedValue(null) }))

import App from '@/App'
import { useDocumentStore } from '@/stores/documentStore'
import { useSettingsStore } from '@/stores/settingsStore'

describe('App 启动流程（spec §3 / W1 / W7）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    window.localStorage.clear()
    useDocumentStore.setState({ documents: [], activeDocument: null, saveState: 'idle' })
  })

  it('首次启动没有库目录时显示引导页', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Ink.')).toBeInTheDocument()
    })
    expect(screen.getByText('Your words stay on your Mac.')).toBeInTheDocument()
    expect(screen.getByText('选择文档库位置')).toBeInTheDocument()
  })

  it('编辑器按「样式化源码」渲染 markdown（spec §2）', async () => {
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-test-library' }),
    )

    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'path_exists':
          return true
        case 'list_documents':
          return [
            {
              path: '/tmp/ink-test-library/Sample.md',
              fileName: 'Sample.md',
              dirPrefix: '',
              mtime: 1000,
              size: 12,
              displayTitle: '示例',
            },
          ]
        case 'read_document':
          return {
            content: '# 标题\n\n正文 **加粗** 与 `代码`\n\n- 列表项',
            encoding: 'utf-8',
            mtime: 1000,
            size: 12,
            lineEnding: 'lf',
          }
        default:
          return undefined
      }
    })

    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    })

    await waitFor(() => {
      // 标题行使用 H1 样式
      expect(container.querySelector('.cm-md-h1')).toBeTruthy()
    })

    // 语法符号被弱化
    expect(container.querySelector('.cm-md-mark')).toBeTruthy()
    // 加粗内容真加粗
    expect(container.querySelector('.cm-md-bold')).toBeTruthy()
    // 行内代码有等宽样式
    expect(container.querySelector('.cm-md-code')).toBeTruthy()
    // 列表标记被弱化
    expect(container.querySelector('.cm-md-listmark, .cm-md-mark')).toBeTruthy()
  })

  it('切换到深色主题时，编辑器根节点带上 CM6 的 dark 变体 class', async () => {
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-theme-test', theme: 'light' }),
    )
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'path_exists':
          return true
        case 'list_documents':
          return []
        case 'read_document':
          return {
            content: '# 标题\n\n正文',
            encoding: 'utf-8',
            mtime: 1000,
            size: 12,
            lineEnding: 'lf',
          }
        default:
          return undefined
      }
    })

    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    })

    const editor = container.querySelector('.cm-editor')!
    const lightClasses = [...editor.classList]
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    await act(async () => {
      useSettingsStore.getState().setTheme('dark')
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // 深色模式下应多出 CM6 的 dark 变体 class（base theme 的 &dark 规则由此生效）
    const darkClasses = [...editor.classList]
    expect(darkClasses.some((name) => !lightClasses.includes(name))).toBe(true)
  })

  it('编辑器整体位于标题栏留白带下方，不与红绿灯区域重叠', async () => {
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-layout-test' }),
    )
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'path_exists':
          return true
        case 'list_documents':
          return []
        case 'read_document':
          return {
            content: '# 标题',
            encoding: 'utf-8',
            mtime: 1000,
            size: 8,
            lineEnding: 'lf',
          }
        default:
          return undefined
      }
    })

    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    })

    // 拖拽条存在，且关闭了 Tauri 内置拖拽（改走 Rust 侧运行时 API）
    const drag = container.querySelector('.ink-window-drag') as HTMLElement
    expect(drag).toBeTruthy()
    expect(drag.getAttribute('data-tauri-drag-region')).toBe('false')

    // 应用外壳预留了标题栏留白带（红绿灯区域），查找面板因此不会压住红绿灯
    const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')
    expect(css).toContain('--titlebar-height: 32px')
    expect(css).toMatch(/\.ink-shell\s*\{[^}]*padding-top:\s*var\(--titlebar-height\)/)
  })

  it('已有库目录时直接进入编辑器并打开最近文档', async () => {
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-test-library' }),
    )

    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'set_watch_path':
          return undefined
        case 'path_exists':
          return true
        case 'ensure_directory':
          return undefined
        case 'list_documents':
          return [
            {
              path: '/tmp/ink-test-library/Sample.md',
              fileName: 'Sample.md',
              dirPrefix: '',
              mtime: 1000,
              size: 12,
              displayTitle: '示例',
            },
          ]
        case 'read_document':
          return {
            content: '# 我的笔记\n\n正文',
            encoding: 'utf-8',
            mtime: 1000,
            size: 12,
            lineEnding: 'lf',
          }
        default:
          return undefined
      }
    })

    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('我的笔记')
    })
  })
})
