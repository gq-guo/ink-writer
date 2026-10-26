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
    // ≥50vh：短文档也能把当前行滚到视口精确中心（40vh 时光标会停在 ~62%）
    padding: '16px 24px calc(50vh + 32px) 24px',
    caretColor: 'var(--foreground)',
  },
  '.cm-scroller': {
    overflowX: 'hidden',
    fontFamily: 'var(--writing-font)',
    scrollbarGutter: 'stable both-edges',
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
    backgroundColor: 'var(--highlight)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--highlight-strong)',
  },
  '.cm-placeholder': {
    color: 'var(--secondary)',
  },

  // ── 样式化源码（spec §2.1）──
  // 排版像一本正在编辑的书：标题不靠「更黑更粗」，靠字号和前后留白的节奏区分
  // 标记一律弱化成灰色：连同语法高亮在标记上加的颜色（任务框、表头竖线、HTML 标签）一起压掉
  '.cm-md-mark, .cm-md-mark *': {
    color: 'var(--secondary)',
  },
  // 外悬标记的定宽盒（宽度由 styledSource 按字符数给出）；text-indent 不能继承进来，否则盒内再缩一次
  '.cm-md-hang': {
    display: 'inline-block',
    textIndent: '0',
    whiteSpace: 'pre',
  },
  '.cm-md-list-lead': {
    letterSpacing: '0.35em',
  },
  '.cm-md-heading-text': {
    color: 'color-mix(in srgb, var(--foreground) 92%, var(--secondary))',
  },
  '.cm-md-url': {
    color: 'var(--secondary)',
  },
  '.cm-md-link-text': {
    color: 'var(--foreground)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--foreground) 30%, transparent)',
    textUnderlineOffset: '3px',
  },
  '.cm-md-bold': {
    fontWeight: '600',
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
    fontSize: '0.8em',
    color: 'color-mix(in srgb, var(--foreground) 78%, var(--secondary))',
    backgroundColor: 'var(--code-bg)',
    borderRadius: '2px',
    padding: '0.15em 0.4em',
  },
  // 段间距：加在段落后的分隔空行上（没有空行时加在段落最后一行），见 styledSource 的 Paragraph
  // 分隔空行本身已经占了一整行，这里只补一点：段与段之间约 1.2 行，而不是接近两行
  '.cm-md-para': {
    paddingBottom: '0.3em',
  },
  // 18px 正文下：H1 32px / H2 21px，都是 600；标题前的留白明显大于标题后
  '.cm-md-h1': {
    fontSize: '1.78em',
    fontWeight: '600',
    lineHeight: '1.25',
    letterSpacing: '-0.01em',
    paddingTop: '0.6em',
  },
  '.cm-md-h2': {
    fontSize: '1.17em',
    fontWeight: '600',
    lineHeight: '1.4',
    paddingTop: '1.3em',
  },
  '.cm-md-h3': {
    fontSize: '1.05em',
    fontWeight: '600',
    lineHeight: '1.45',
    paddingTop: '1em',
  },
  // H4 及以下不再放大，靠字号逐级收小 + 颜色变淡区分，前面都留出和 H3 相近的空白
  '.cm-md-h4': {
    fontSize: '1em',
    fontWeight: '600',
    paddingTop: '0.8em',
  },
  '.cm-md-h5': {
    fontSize: '0.92em',
    fontWeight: '600',
    letterSpacing: '0.01em',
    color: 'color-mix(in srgb, var(--foreground) 82%, var(--secondary))',
    paddingTop: '0.8em',
  },
  '.cm-md-h6': {
    fontSize: '0.85em',
    fontWeight: '600',
    letterSpacing: '0.02em',
    color: 'color-mix(in srgb, var(--foreground) 65%, var(--secondary))',
    paddingTop: '0.8em',
  },
  '.cm-md-quote': {
    borderLeft: '2px solid var(--border)',
    paddingLeft: '16px',
    color: 'color-mix(in srgb, var(--foreground) 80%, var(--secondary))',
  },
  '.cm-md-hr': {
    color: 'transparent',
  },
  '.cm-md-hr-line': {
    background: 'linear-gradient(var(--border), var(--border)) center / 100% 1px no-repeat',
  },
  // 代码块整行用代码字体（含 ``` 围栏行），左右留出内边距，代码不贴着底色边缘
  '.cm-md-codeblock': {
    backgroundColor: 'var(--code-bg)',
    fontFamily: 'var(--code-font)',
    fontSize: '0.85em',
    paddingLeft: '16px',
    paddingRight: '16px',
  },
  '.cm-md-codeblock-start': {
    borderTopLeftRadius: '3px',
    borderTopRightRadius: '3px',
    paddingTop: '6px',
  },
  '.cm-md-codeblock-end': {
    borderBottomLeftRadius: '3px',
    borderBottomRightRadius: '3px',
    paddingBottom: '6px',
  },
  '.cm-md-codeblock-text': {
    fontFamily: 'var(--code-font)',
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
