import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

import App from '@/App'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { syncLocale } from '@/lib/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

describe('App 启动流程（spec §3 / W1 / W7）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    window.localStorage.clear()
    syncLocale('zh-CN')
    useDocumentStore.setState({ documents: [], activeDocument: null, saveState: 'idle' })
  })

  it('首次启动没有库目录时显示引导页', async () => {
    window.localStorage.setItem('ink:settings', JSON.stringify({ locale: 'zh-CN' }))
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
        case 'take_open_requests':
          return []
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
        case 'take_open_requests':
          return []
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
        case 'take_open_requests':
          return []
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

  it('空文档显示 Start writing 引导，输入后消失', async () => {
    useEditorStore.getState().setHasContent(false)
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-empty-test', locale: 'zh-CN' }),
    )
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'take_open_requests':
          return []
        case 'list_documents':
          return []
        case 'read_document':
          return { content: '', encoding: 'utf-8', mtime: 1000, size: 0, lineEnding: 'lf' }
        default:
          return undefined
      }
    })

    const { container } = render(<App />)
    await waitFor(() => {
      expect(screen.getByText('开始写作')).toBeInTheDocument()
    })

    // 模拟输入：经 documentStore.onEditorChange（编辑器每次击键都走这里）
    await act(async () => {
      useDocumentStore.getState().onEditorChange('你好')
    })
    expect(container.querySelector('.ink-empty-guide')).toBeNull()
  })

  it('打字时外壳标记 data-typing，鼠标真正移动后恢复（微小抖动不算）', async () => {
    window.localStorage.setItem('ink:settings', JSON.stringify({ libraryPath: '/tmp/ink-typing' }))
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_documents') return []
      if (command === 'create_document') {
        return { path: '/tmp/ink-typing/Untitled.md', fileName: 'Untitled.md', dirPrefix: '', mtime: 1, size: 0, displayTitle: 'Untitled' }
      }
      if (command === 'read_document') {
        return { content: '', encoding: 'utf-8', mtime: 1, size: 0, lineEnding: 'lf' }
      }
      return undefined
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.ink-shell')).toBeInTheDocument())
    const shell = container.querySelector('.ink-shell') as HTMLElement

    act(() => useEditorStore.getState().setTyping(true))
    expect(shell.dataset.typing).toBe('true')

    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 102, clientY: 101 })
    expect(shell.dataset.typing).toBe('true')

    fireEvent.mouseMove(window, { clientX: 140, clientY: 120 })
    expect(shell.dataset.typing).toBe('false')
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
        case 'take_open_requests':
          return []
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

  it('从 Finder 双击 .md 启动时打开那个文件，而不是库里的第一篇', async () => {
    window.localStorage.setItem(
      'ink:settings',
      JSON.stringify({ libraryPath: '/tmp/ink-test-library' }),
    )

    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      switch (command) {
        case 'take_open_requests':
          return ['/Users/me/Desktop/Outside.md']
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
            content: args?.path === '/Users/me/Desktop/Outside.md' ? '# 库外文档' : '# 库里第一篇',
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
      expect(container.querySelector('.cm-content')?.textContent).toContain('库外文档')
    })
    const readPaths = invokeMock.mock.calls
      .filter(([command]) => command === 'read_document')
      .map(([, args]) => (args as { path: string }).path)
    expect(readPaths).toEqual(['/Users/me/Desktop/Outside.md'])
  })
})

describe('刷新 / 重启后回到上次打开的文档', () => {
  const library = '/tmp/ink-reopen-library'
  const docs = [
    { path: `${library}/get.md`, fileName: 'get.md', dirPrefix: '', mtime: 2000, size: 4, displayTitle: 'get' },
    { path: `${library}/中台测试.md`, fileName: '中台测试.md', dirPrefix: '', mtime: 1000, size: 4, displayTitle: '中台测试' },
  ]

  beforeEach(() => {
    invokeMock.mockReset()
    window.localStorage.clear()
    syncLocale('zh-CN')
    useDocumentStore.setState({ documents: [], activeDocument: null, saveState: 'idle' })
    useUiStore.setState({ lastDocumentPath: null })
    window.localStorage.setItem('ink:settings', JSON.stringify({ libraryPath: library }))
    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case 'take_open_requests':
          return []
        case 'list_documents':
          return docs
        case 'read_document':
          return { content: '正文\n', encoding: 'utf-8', mtime: 1000, size: 4, lineEnding: 'lf' }
        default:
          return undefined
      }
    })
  })

  it('上次停在「中台测试」：启动后打开它，而不是最新的 get.md', async () => {
    window.localStorage.setItem('ink:ui', JSON.stringify({ lastDocumentPath: `${library}/中台测试.md` }))
    render(<App />)
    await waitFor(() => expect(useDocumentStore.getState().activeDocument?.path).toBe(`${library}/中台测试.md`))
  })

  it('侧栏按存下的状态直接出现，不会先收起再动画展开', async () => {
    window.localStorage.setItem('ink:ui', JSON.stringify({ sidebarVisible: true }))
    useUiStore.setState({ hydrated: false, sidebarVisible: false })
    const seen: (string | null)[] = []
    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('.ink-sidebar')
      if (sidebar) seen.push(sidebar.getAttribute('data-hidden'))
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-hidden'] })
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ink-sidebar')).toBeTruthy())
    await waitFor(() => expect(useDocumentStore.getState().activeDocument).not.toBeNull())
    observer.disconnect()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain('true')
  })

  it('没有记录时仍打开第一篇，并把它记下来', async () => {
    render(<App />)
    await waitFor(() => expect(useDocumentStore.getState().activeDocument?.path).toBe(`${library}/get.md`))
    expect(useUiStore.getState().lastDocumentPath).toBe(`${library}/get.md`)
  })
})
