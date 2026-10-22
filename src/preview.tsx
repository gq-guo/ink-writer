/**
 * 开发用自检页：在真实浏览器布局里验证「光标居中」是否真的发生。
 * 访问 /preview.html?selftest=1 ，结果会写进 #selftest-output。
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'

import { createInkExtensions } from './editor/extensions'
import { setFocusModeEffect } from './editor/focusMode'
import { setTypewriterModeEffect } from './editor/typewriter'
import './styles/globals.css'

const params = new URLSearchParams(location.search)
const dark = params.get('dark') === '1'
document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
if (params.get('selftest') === '1') document.title = 'Ink'

if (params.get('noanim') === '1') {
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.head.appendChild(style)
}

const parent = document.getElementById('app')
if (!parent) throw new Error('缺少 #app')

const LONG_DOC = Array.from(
  { length: 120 },
  (_, i) => `第 ${i + 1} 段：这是一段用于测试滚动行为的文字，长度足够让文档超出视口高度。`,
).join('\n\n')

const view = new EditorView({
  parent,
  state: EditorState.create({
    doc: LONG_DOC,
    extensions: createInkExtensions({
      dark,
      onDocChanged: () => {},
      onStatistics: () => {},
      getDocDir: () => '',
      onOpenUrl: () => {},
      onRevealPath: () => {},
      onError: () => {},
    }),
  }),
})

// 捕获插件异常（CM6 会 console.error 然后停用插件）
const capturedErrors: string[] = []
const originalError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  capturedErrors.push(args.map(String).join(' '))
  originalError(...args)
}

const output = document.createElement('pre')
output.id = 'selftest-output'
document.body.appendChild(output)

function measure(label: string): string {
  const head = view.state.selection.main.head
  const coords = view.coordsAtPos(head)
  const rect = view.scrollDOM.getBoundingClientRect()
  if (!coords) return `${label}: 无坐标`
  const cursorCenter = (coords.top + coords.bottom) / 2
  const viewportCenter = rect.top + rect.height / 2
  const offset = cursorCenter - viewportCenter
  return `${label}: offset=${offset.toFixed(1)}px scrollTop=${view.scrollDOM.scrollTop.toFixed(0)} focus=${view.hasFocus}`
}

async function frame() {
  // 用 setTimeout 而不是 rAF：headless + virtual time 下 rAF 可能不触发
  await new Promise((resolve) => setTimeout(resolve, 60))
}

/** 把 DOM 选区放到指定行末尾（模拟用户移动光标） */
function setCaretToLine(lineIndex: number) {
  const lines = view.contentDOM.querySelectorAll('.cm-line')
  const el = lines[Math.min(lineIndex, lines.length - 1)]
  if (!el) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return true
}

async function runSelfTest() {
  const lines: string[] = []
  const flush = () => {
    output.textContent = lines.join('\n')
  }
  try {
    view.focus()
    await frame()

    const lineCount = view.contentDOM.querySelectorAll('.cm-line').length

    // 1) 初始：光标在文档开头
    lines.push(measure('initial'))
    flush()

    // 2) 打开 Focus Mode
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    await frame()
    lines.push(measure('focus-on'))
    flush()

    // 3) 真实输入：把光标移到末尾，用 execCommand 插入（浏览器原生插入 + 原生滚动光标）
    setCaretToLine(lineCount - 1)
    await frame()
    document.execCommand('insertText', false, 'END')
    await frame()
    await frame()
    lines.push(measure('type-at-end'))
    flush()

    // 4) 再输入一次（连续打字）
    document.execCommand('insertText', false, 'MORE')
    await frame()
    await frame()
    lines.push(measure('type-again'))
    flush()

    // 5) 真实输入：把光标移到中间（CM6 像用户操作一样把它滚进视口）再输入
    const midPos = Math.floor(view.state.doc.length / 2)
    view.dispatch({ selection: { anchor: midPos }, scrollIntoView: true })
    await frame()
    view.dispatch({ changes: { from: midPos, insert: 'MID' } })
    await frame()
    await frame()
    lines.push(measure('type-at-mid'))
    flush()

    // 6) Typewriter Mode
    view.dispatch({ effects: setTypewriterModeEffect.of(true) })
    await frame()
    await frame()
    lines.push(measure('typewriter-on'))
    flush()

    lines.push(`console-errors: ${JSON.stringify(capturedErrors)}`)
    flush()
  } catch (error) {
    lines.push('ERROR: ' + String(error))
  }
  flush()
  document.title = 'Ink'
  // 清空 DOM，只留结果（便于 --dump-dom）
  document.body.innerHTML = ''
  document.body.appendChild(output)
}

/* ══════════════════════════════════════════════════════════════════
   整壳预览（?shell=1）：预置 store 数据，渲染完整界面做视觉回归
   ══════════════════════════════════════════════════════════════════ */

async function renderShell(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const MOCK_DOCS = [
    {
      path: '/library/Hello World.md',
      fileName: 'Hello World.md',
      dirPrefix: '',
      mtime: now - 3600,
      size: 420,
      displayTitle: 'Hello World',
    },
    {
      path: '/library/Blog Post.md',
      fileName: 'Blog Post.md',
      dirPrefix: '',
      mtime: now - 7200,
      size: 900,
      displayTitle: 'Blog Post',
    },
    {
      path: '/library/Project Notes.md',
      fileName: 'Project Notes.md',
      dirPrefix: 'Project/',
      mtime: now - 86400,
      size: 640,
      displayTitle: 'Project Notes',
    },
    {
      path: '/library/Ideas.md',
      fileName: 'Ideas.md',
      dirPrefix: '',
      mtime: now - 86400 * 3,
      size: 120,
      displayTitle: 'Ideas',
    },
    {
      path: '/library/2024.md',
      fileName: '2024.md',
      dirPrefix: 'Archive/',
      mtime: now - 86400 * 200,
      size: 80,
      displayTitle: '2024',
    },
  ]

  const CONTENT = [
    '# Hello World',
    '',
    'This is my first document in Ink.',
    '',
    'Writing is a way to think. A good writing tool helps you focus on what matters.',
    '',
    '## Why Markdown?',
    '',
    '- Simple',
    '- Portable',
    '- Future proof',
  ].join('\n')

  const [{ useDocumentStore }, { useUiStore }, { useEditorStore }, { useSettingsStore }, React, {
    createRoot,
  }] = await Promise.all([
    import('./stores/documentStore'),
    import('./stores/uiStore'),
    import('./stores/editorStore'),
    import('./stores/settingsStore'),
    import('react'),
    import('react-dom/client'),
  ])

  useSettingsStore.setState({
    hydrated: true,
    settings: {
      theme: dark ? 'dark' : 'light',
      accentColor: '#007AFF',
      fontFamily: 'serif',
      fontSize: 18,
      lineHeight: 1.7,
      contentWidth: 680,
      libraryPath: '/library',
      typewriterMode: false,
      favorites: ['/library/Blog Post.md'],
      locale: 'system',
    },
  })
  useUiStore.setState({ sidebarVisible: true, sidebarWidth: 240, sidebarView: 'all' })
  useDocumentStore.setState({
    documents: MOCK_DOCS,
    activeDocument: {
      ...MOCK_DOCS[0]!,
      content: CONTENT,
      originalEncoding: 'utf-8',
      displayTitle: 'Hello World',
    },
    saveState: 'idle',
    libraryPath: '/library',
  })
  useEditorStore.setState({
    focusMode: params.get('focus') === '1',
    statistics: {
      words: 1248,
      cjkChars: 0,
      latinWords: 1248,
      characters: 7832,
      paragraphs: 42,
      sentences: 68,
      readingMinutes: 8,
    },
  })

  const [{ Sidebar }, { TopBar }, { DocumentHeader }, { EditorHost }, { StatusBar }] =
    await Promise.all([
      import('./components/Sidebar'),
      import('./components/TopBar'),
      import('./components/DocumentHeader'),
      import('./components/EditorHost'),
      import('./components/StatusBar'),
    ])

  const container = document.createElement('div')
  container.style.height = '100%'
  const host = document.getElementById('app')
  if (!host) return
  host.innerHTML = ''
  host.appendChild(container)

  createRoot(container).render(
    React.createElement(
      'div',
      { className: 'ink-shell' },
      React.createElement(Sidebar),
      React.createElement(
        'main',
        { className: 'relative h-full flex-1 overflow-hidden' },
        React.createElement(TopBar),
        React.createElement(DocumentHeader),
        React.createElement(EditorHost),
        React.createElement(StatusBar),
      ),
    ),
  )
}

if (params.get('shell') === '1') {
  void renderShell()
} else if (params.get('selftest') === '1') {
  void runSelfTest()
} else {
  setTimeout(() => {
    openSearchPanel(view)
    view.dispatch({ selection: { anchor: 60 } })
  }, 1200)
}
