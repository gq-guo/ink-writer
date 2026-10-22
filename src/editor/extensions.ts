/**
 * CodeMirror 6 扩展装配（spec §8.1）
 *
 * 自上而下即优先级；只有本目录的模块会 import @codemirror/*，
 * 且只被 EditorHost 组件引用（spec §4.3.1）。
 */
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  placeholder,
  rectangularSelection,
  type KeyBinding,
} from '@codemirror/view'
import { history, historyKeymap } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import type { DocumentStatistics } from '@/lib/types'

import { inkSyntaxHighlighting } from './highlight'
import { highlightCompartment } from './performance'
import { inkStyledSourcePlugin } from './styledSource'
import { focusModeField, inkFocusModePlugin } from './focusMode'
import { typewriterModeField } from './typewriter'
import { inkCursorCenteringPlugin } from './centering'
import { inkStatisticsPlugin } from './statistics'
import { makeSearchPhrases, searchPhrasesCompartment } from './searchPhrases'
import { inkSearchPanelPlugin } from './searchPanel'
import { inkImageHandler } from './imageHandler'
import { inkLinkHandler } from './links'
import { darkCompartment, inkDarkExtension, inkThemeExtension, themeCompartment } from './theme'

export interface InkExtensionOptions {
  /** 初始是否为深色主题 */
  dark: boolean
  /** 正文变化（每次击键都会调用） */
  onDocChanged: (update: ViewUpdate) => void
  /** 统计结果 */
  onStatistics: (statistics: DocumentStatistics) => void
  /** 当前文档所在目录 */
  getDocDir: () => string
  /** 打开链接 */
  onOpenUrl: (url: string) => void
  /** 在 Finder 中显示 */
  onRevealPath: (path: string) => void
  /** 错误提示 */
  onError: (message: string) => void
}

/** 编辑器级键位（spec §11.2 中 scope = editor 的部分） */
export const inkEditorKeymap: KeyBinding[] = [
  { key: 'Mod-z', preventDefault: true },
  { key: 'Shift-Mod-z', preventDefault: true },
]

export function createInkExtensions(options: InkExtensionOptions): Extension[] {
  return [
    // ── 基础编辑行为 ──
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),

    // ── 语言 ──
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    highlightCompartment.of(inkSyntaxHighlighting),

    // ── 搜索 ──
    search({ top: true }),
    searchPhrasesCompartment.of(makeSearchPhrases('zh-CN')),
    inkSearchPanelPlugin,
    highlightSelectionMatches(),

    // ── Ink 自研插件 ──
    inkStyledSourcePlugin,
    focusModeField,
    inkFocusModePlugin,
    typewriterModeField,
    inkCursorCenteringPlugin,
    inkStatisticsPlugin(options.onStatistics),
    inkImageHandler({
      getDocDir: options.getDocDir,
      onError: options.onError,
    }),
    inkLinkHandler({
      getDocDir: options.getDocDir,
      onOpenUrl: options.onOpenUrl,
      onRevealPath: options.onRevealPath,
    }),
    placeholder('Start writing something...'),

    // ── 键位 ──
    keymap.of([...inkEditorKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),

    // ── 主题与外观 ──
    themeCompartment.of(inkThemeExtension()),
    darkCompartment.of(inkDarkExtension(options.dark)),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),

    // ── 桥接 ──
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      options.onDocChanged(update)
    }),
  ]
}
