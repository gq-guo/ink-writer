/**
 * 编辑器主题（spec §8.3）
 *
 * 颜色全部引用 CSS variables —— 设置变更只改根节点变量，不重建 EditorView。
 *
 * 注意（CM6 细节）：
 * 1. base theme 里有 `&light .cm-panels` / `&dark .cm-content` 这类选择器（权重 0,2,0），
 *    它们由 darkTheme facet 决定走哪一套。主题必须通过 `EditorView.darkTheme`
 *    跟随真实主题，否则深色模式下搜索面板会被 base theme 的浅色变量覆盖成一片白。
 * 2. base theme 是运行时注入的，`.cm-line { padding: 0 2px 0 6px }` 的权重高于普通样式表，
 *    所以「样式化源码」的 .cm-md-* 规则必须放在这里（CM6 内部后挂载，优先级更高）。
 * 3. 段落间距不能用 margin 实现：CM6 的坐标模型只测量 line 盒高度，margin 不计入，
 *    会导致点击位置逐行漂移（点第 N 行落到第 N+1 行）。用 padding（属于行盒）即可。
 */
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** 主题 compartment：切换时只替换样式，不重建 EditorView */
export const themeCompartment = new Compartment()
/** 深色开关 compartment：控制 CM6 的 &light / &dark 变体 */
export const darkCompartment = new Compartment()

export const inkThemeSpec = {
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--writing-font)',
    fontSize: 'var(--writing-font-size)',
    lineHeight: 'var(--writing-line-height)',
    maxWidth: 'var(--editor-max-width)',
    margin: '0 auto',
    padding: '16px 24px 40vh 24px',
    caretColor: 'var(--accent)',
  },
  '.cm-scroller': {
    overflowX: 'hidden',
    fontFamily: 'var(--writing-font)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--foreground)',
    borderLeftWidth: '2px',
  },
  '.cm-dropCursor': {
    borderLeftColor: 'var(--secondary)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    borderColor: 'var(--border)',
  },
  '.cm-panels input, .cm-panels button': {
    fontFamily: 'var(--ui-font)',
    fontSize: 'var(--ui-font-size)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  },
  '.cm-placeholder': {
    color: 'var(--secondary)',
  },

  // ── 样式化源码（spec §2.1）──
  '.cm-md-mark': {
    color: 'var(--secondary)',
  },
  '.cm-md-heading-text': {
    color: 'var(--accent)',
  },
  '.cm-md-url': {
    color: 'var(--secondary)',
  },
  '.cm-md-link-text': {
    color: 'var(--accent)',
  },
  '.cm-md-bold': {
    fontWeight: '700',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
  },
  '.cm-md-strike': {
    textDecoration: 'line-through',
    textDecorationColor: 'var(--secondary)',
  },
  '.cm-md-code': {
    fontFamily: 'var(--code-font)',
    fontSize: '0.85em',
    backgroundColor: 'var(--code-bg)',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },
  // 段间距：只加在段落的最后一行（换行段落内部不会被撑开）
  '.cm-md-para': {
    paddingBottom: '0.9em',
  },
  '.cm-md-h1': {
    fontSize: '1.6em',
    fontWeight: '700',
    lineHeight: '1.3',
    paddingTop: '1.1em',
  },
  '.cm-md-h2': {
    fontSize: '1.35em',
    fontWeight: '700',
    lineHeight: '1.35',
    paddingTop: '1.1em',
  },
  '.cm-md-h3': {
    fontSize: '1.18em',
    fontWeight: '600',
    lineHeight: '1.4',
    paddingTop: '1em',
  },
  '.cm-md-h4': {
    fontSize: '1em',
    fontWeight: '600',
  },
  '.cm-md-h5': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'color-mix(in srgb, var(--foreground) 85%, var(--secondary))',
  },
  '.cm-md-h6': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'color-mix(in srgb, var(--foreground) 70%, var(--secondary))',
  },
  '.cm-md-quote': {
    borderLeft: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
    paddingLeft: '14px',
    color: 'color-mix(in srgb, var(--foreground) 90%, transparent)',
  },
  '.cm-md-hr': {
    color: 'transparent',
    background: 'linear-gradient(var(--border), var(--border)) center / 100% 1px no-repeat',
  },
  '.cm-md-codeblock': {
    backgroundColor: 'var(--code-bg)',
  },
  '.cm-md-codeblock-start': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
    paddingTop: '6px',
  },
  '.cm-md-codeblock-end': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
    paddingBottom: '6px',
  },
  '.cm-md-codeblock-text': {
    fontFamily: 'var(--code-font)',
    fontSize: '0.85em',
  },
}

/** 主题样式（不含深浅开关） */
export function inkThemeExtension() {
  return EditorView.theme(inkThemeSpec)
}

/** 深色开关：CM6 依据这个 facet 选择 &dark / &light 变体 */
export function inkDarkExtension(dark: boolean) {
  return dark ? EditorView.darkTheme.of(true) : []
}
