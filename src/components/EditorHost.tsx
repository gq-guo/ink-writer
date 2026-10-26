/**
 * EditorHost —— 唯一与 CodeMirror 6 直接交互的组件（spec §4.2 / §4.3.1）
 */
import { useCallback, useEffect, useRef } from 'react'
import { EditorState, type Extension, type StateEffect } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { invoke } from '@tauri-apps/api/core'

import { createInkExtensions } from '@/editor/extensions'
import { setFocusModeEffect } from '@/editor/focusMode'
import { darkCompartment, inkDarkExtension } from '@/editor/theme'
import { runCenteringSelfTest } from '@/editor/selftest'
import { makeSearchPhrases, searchPhrasesCompartment } from '@/editor/searchPhrases'
import { makePlaceholder, placeholderCompartment } from '@/editor/placeholder'
import { inkSpellcheck, spellcheckCompartment } from '@/editor/spellcheck'
import { concealCompartment, concealMarkupFacet } from '@/editor/styledSource'
import { useLocaleStore } from '@/lib/i18n'
import { useT } from '@/lib/i18n'
import { highlightCompartment, isPerformanceMode, noHighlightStyle } from '@/editor/performance'
import { inkSyntaxHighlighting } from '@/editor/highlight'
import { setTypewriterModeEffect } from '@/editor/typewriter'
import { centerCursorEffect } from '@/editor/centering'
import { setDocHeaderEffect, type DocHeaderInfo } from '@/editor/docHeader'
import { formatMetaTime } from '@/lib/format'
import { registerEditorBridge } from '@/editor/bridge'
import { errorMessage } from '@/lib/errors'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { resolveTheme, useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

/** 超过该长度时增量维护文本缓存，避免每次击键都序列化整篇文档 */
const LARGE_DOC_THRESHOLD = 1024 * 1024

export function EditorHost() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const extensionsRef = useRef<Extension[] | null>(null)
  const textRef = useRef('')
  const contentRef = useRef('')

  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const openSeq = activeDocument?.openSeq
  const t = useT()
  const performanceMode = activeDocument ? isPerformanceMode(activeDocument.size) : false
  const performanceNotifiedRef = useRef(false)
  const prevFocusRef = useRef(false)
  const prevTypewriterRef = useRef(false)
  const focusMode = useEditorStore((state) => state.focusMode)
  const typewriterMode = useSettingsStore((state) => state.settings.typewriterMode)

  /** 让 CM6 的 &dark / &light 变体跟随应用主题（否则深色模式下搜索面板会变白） */
  const syncDarkFlag = useCallback((view: EditorView | null) => {
    if (!view) return
    const theme = useSettingsStore.getState().settings.theme
    const dark = resolveTheme(theme) === 'dark'
    view.dispatch({ effects: darkCompartment.reconfigure(inkDarkExtension(dark)) })
  }, [])

  const currentFocusMode = useCallback(
    () => (performanceMode ? false : useEditorStore.getState().focusMode),
    [performanceMode],
  )

  const currentTypewriterMode = useCallback(
    () => useSettingsStore.getState().settings.typewriterMode,
    [],
  )

  const handleDocChanged = useCallback((update: ViewUpdate) => {
    const doc = update.state.doc
    if (doc.length <= LARGE_DOC_THRESHOLD) {
      textRef.current = doc.toString()
    } else {
      const changes: { from: number; to: number; insert: string }[] = []
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() })
      })
      let text = textRef.current
      for (let i = changes.length - 1; i >= 0; i--) {
        const change = changes[i]!
        text = text.slice(0, change.from) + change.insert + text.slice(change.to)
      }
      textRef.current = text
    }
    useDocumentStore.getState().onEditorChange(textRef.current)
    // 用户输入（而不是程序替换全文）时，顶栏 / 状态栏淡出
    if (update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
      useEditorStore.getState().setTyping(true)
    }
  }, [])

  // ── 文档切换：整体替换 EditorState（同时重置撤销历史）──
  useEffect(() => {
    contentRef.current = activeDocument?.content ?? ''
  }, [activeDocument?.content])

  // ── 创建 EditorView ──
  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const extensions = createInkExtensions({
      dark: resolveTheme(useSettingsStore.getState().settings.theme) === 'dark',
      spellcheck: useSettingsStore.getState().settings.spellcheck,
      showMarkup: useSettingsStore.getState().settings.showMarkup,
      onDocChanged: handleDocChanged,
      onStatistics: (statistics) => useEditorStore.getState().setStatistics(statistics),
      onOutline: (outline, active) => useEditorStore.getState().setOutline(outline, active),
      getDocDir: () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return ''
        return active.path.slice(0, active.path.lastIndexOf('/'))
      },
      onOpenUrl: (url) => {
        void invoke('open_url', { url }).catch((error) => {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        })
      },
      onRevealPath: (path) => {
        void invoke('reveal_in_finder', { path }).catch((error) => {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        })
      },
      onError: (message) => {
        useUiStore.getState().pushToast({ message, kind: 'error' })
      },
    })
    extensionsRef.current = extensions

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions }),
    })
    viewRef.current = view
    syncDarkFlag(view)

    // 开发期自检：在真实应用里验证光标居中
    // 触发方式：dev 模式下打开 http://localhost:1420/?selftest=1
    // 结果写入 /tmp/ink-selftest.txt
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('selftest') === '1') {
      window.setTimeout(() => {
        void runCenteringSelfTest(view)
      }, 1500)
    }

    const unregister = registerEditorBridge({
      setContent: (text, options) => {
        const preserve = options?.preserveSelection ?? false
        const head = view.state.selection.main.head
        const line = view.state.doc.lineAt(head)
        const lineNumber = line.number
        const column = head - line.from

        const next = EditorState.create({ doc: text, extensions })
        view.setState(next)
        textRef.current = text

        if (preserve) {
          const targetLine = next.doc.line(Math.min(lineNumber, next.doc.lines))
          const position = Math.min(targetLine.to, targetLine.from + column)
          view.dispatch({ selection: { anchor: position } })
        }
      },
      revealRange: ([from, to]) => {
        const length = view.state.doc.length
        const start = Math.min(Math.max(from, 0), length)
        const end = Math.min(Math.max(to, start), length)
        view.dispatch({
          selection: { anchor: start, head: end },
          effects: EditorView.scrollIntoView(start, { y: 'center' }),
        })
        view.focus()
      },
      getContent: () => textRef.current,
      focus: () => view.focus(),
      openFind: () => openSearchPanel(view),
      jumpTo: (pos) => {
        const line = view.state.doc.lineAt(Math.min(Math.max(pos, 0), view.state.doc.length))
        view.dispatch({
          selection: { anchor: line.to },
          // 标题停在视口上部（留出顶栏的位置），下面就是这一节的正文
          effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 72 }),
        })
        view.focus()
      },
    })

    return () => {
      unregister()
      view.destroy()
      viewRef.current = null
    }
  }, [handleDocChanged, syncDarkFlag])

  // ── 文档切换：整体替换 EditorState（同时重置撤销历史）──
  useEffect(() => {
    const view = viewRef.current
    const extensions = extensionsRef.current
    if (!view || !extensions) return
    const text = contentRef.current
    textRef.current = text
    view.setState(EditorState.create({ doc: text, extensions }))
    syncDarkFlag(view)

    // 新建 EditorState 会把模式字段重置为 false，这里静默恢复（不触发居中）
    view.dispatch({
      effects: [
        setFocusModeEffect.of(currentFocusMode()),
        setTypewriterModeEffect.of(currentTypewriterMode()),
      ],
    })
  // 依赖里不能放 t：切换语言会让 t 换身份，重跑这里会把正文回滚到打开时的版本
  }, [openSeq, currentFocusMode, currentTypewriterMode, syncDarkFlag])

  // ── 大文件性能模式（spec §18.2）──
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: highlightCompartment.reconfigure(
        performanceMode ? noHighlightStyle : inkSyntaxHighlighting,
      ),
    })
    if (performanceMode) {
      if (!performanceNotifiedRef.current) {
        performanceNotifiedRef.current = true
        useUiStore.getState().pushToast({ message: t('toast.perfMode'), kind: 'info' })
      }
    }
  }, [performanceMode, t])

  // ── 语言切换：同步查找面板与空文档占位的文案 ──
  const locale = useLocaleStore((state) => state.locale)

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        searchPhrasesCompartment.reconfigure(makeSearchPhrases(locale)),
        placeholderCompartment.reconfigure(makePlaceholder(locale)),
      ],
    })
    // openSeq：切换文档会整体替换 EditorState，compartment 回到创建时的值，需要重新推送
  }, [locale, openSeq])

  // ── 拼写检查开关 ──
  const spellcheck = useSettingsStore((state) => state.settings.spellcheck)

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: spellcheckCompartment.reconfigure(inkSpellcheck(spellcheck)),
    })
  }, [spellcheck])

  // ── 显示 / 隐藏 Markdown 标记 ──
  const showMarkup = useSettingsStore((state) => state.settings.showMarkup)

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: concealCompartment.reconfigure(concealMarkupFacet.of(!showMarkup)),
    })
  }, [showMarkup])

  // ── 主题切换：同步 CM6 的深浅变体 ──
  const theme = useSettingsStore((state) => state.settings.theme)

  useEffect(() => {
    syncDarkFlag(viewRef.current)
  }, [theme, syncDarkFlag])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (useSettingsStore.getState().settings.theme === 'system') {
        syncDarkFlag(viewRef.current)
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [syncDarkFlag])

  // ── Focus Mode / Typewriter Mode ──
  // 两者都会让「打字时当前行停在视口中心」，切换时平滑居中一次
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const focusOn = performanceMode ? false : focusMode
    const effects: StateEffect<unknown>[] = []

    if (focusOn !== prevFocusRef.current) {
      effects.push(setFocusModeEffect.of(focusOn))
      if (focusOn) effects.push(centerCursorEffect.of(null))
    }
    if (typewriterMode !== prevTypewriterRef.current) {
      effects.push(setTypewriterModeEffect.of(typewriterMode))
      if (typewriterMode) effects.push(centerCursorEffect.of(null))
    }

    prevFocusRef.current = focusOn
    prevTypewriterRef.current = typewriterMode

    if (effects.length > 0) view.dispatch({ effects })
  }, [focusMode, typewriterMode, performanceMode])

  // ── 文档头（元信息行 / 文件名大标题），以块级 widget 放进编辑器 ──
  const sidebarVisible = useUiStore((state) => state.sidebarVisible)
  // Focus Mode 下不显示元信息（效果图 1 只保留模式胶囊）。
  // 字数与阅读时长只放右下状态栏，这里不再重复
  const headerInfo: DocHeaderInfo | null =
    activeDocument && sidebarVisible && !focusMode
      ? {
          title: activeDocument.titleFromH1
            ? null
            : activeDocument.displayTitle || activeDocument.fileName,
          meta: [formatMetaTime(activeDocument.mtime)],
        }
      : null
  const headerKey = headerInfo ? JSON.stringify(headerInfo) : ''

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDocHeaderEffect.of(headerKey ? JSON.parse(headerKey) : null) })
    // openSeq：切换文档会整体替换 EditorState，需要重新推送
  }, [headerKey, openSeq])

  return <div ref={containerRef} className="relative h-full w-full overflow-hidden" />
}
