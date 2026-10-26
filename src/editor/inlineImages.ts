/**
 * 图片内联预览
 *
 * `![alt](assets/x.png)` 所在行的下方画出图片，源码保持原样可编辑。
 *
 * - 块级 widget 只能由 StateField 提供（ViewPlugin 不允许），所以这里用 StateField；
 * - 按行正则扫描，不依赖语法树：长文的语法树在后台慢慢解析，等它的话图片会晚出现；
 *   编辑时只重扫改动涉及的行，其余装饰随改动映射；
 * - 只显示本地图片（相对文档目录，或绝对路径），经 Rust 的 read_image 读字节，
 *   不打开 asset 协议；网络图片不加载（隐私：打开文档就会向外发请求）；
 * - 代码块里的 `![..](..)` 不算图片（语法树已解析到的部分据此排除）。
 */
import { syntaxTree } from '@codemirror/language'
import { Facet, StateField, type EditorState, type Range, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

import { t } from '@/lib/i18n'
import { isPerformanceMode } from './performance'

export interface InlineImageOptions {
  /** 当前文档所在目录（相对路径据此解析） */
  getDocDir: () => string
  /** 读出图片并返回可用作 <img src> 的 URL */
  load: (path: string) => Promise<string>
}

export const inlineImageOptions = Facet.define<InlineImageOptions, InlineImageOptions | null>({
  combine: (values) => values[0] ?? null,
})

/** `![alt](dest)` / `![alt](<dest with spaces>)` / 带 "title" */
const IMAGE_PATTERN = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g

/** 语法树里这些节点内的文本不是图片 */
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText'])

/** 把 Markdown 里的图片地址解析成本地绝对路径；网络图片 / data: / 无法解析的返回 null */
export function resolveImagePath(destination: string, docDir: string): string | null {
  let target = destination.trim()
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  try {
    target = decodeURI(target)
  } catch {
    /* 不是合法的百分号编码：按原文 */
  }
  target = target.split(/[?#]/)[0] ?? ''
  if (!target) return null
  if (target.startsWith('/')) return target
  if (!docDir) return null
  return `${docDir}/${target.replace(/^\.\//, '')}`
}

class ImageWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly alt: string,
    readonly load: (path: string) => Promise<string>,
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.path === this.path && other.alt === this.alt
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-ink-image'
    const image = document.createElement('img')
    image.alt = this.alt
    image.draggable = false
    // 图片加载完高度才确定：通知 CM6 重新量，否则光标 / 滚动位置会错
    image.addEventListener('load', () => view.requestMeasure())
    wrap.appendChild(image)
    this.load(this.path).then(
      (url) => {
        image.src = url
      },
      () => {
        wrap.classList.add('is-missing')
        wrap.textContent = t('image.missing', { name: this.path.split('/').pop() ?? this.path })
        view.requestMeasure()
      },
    )
    return wrap
  }

  get estimatedHeight(): number {
    return 200
  }
}

function isInCode(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node.parent; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/** 扫描 [fromLine, toLine] 行，产出图片 widget */
function scanLines(
  state: EditorState,
  doc: Text,
  fromLine: number,
  toLine: number,
  options: InlineImageOptions,
  out: Range<Decoration>[],
): void {
  const docDir = options.getDocDir()
  for (let number = fromLine; number <= toLine; number++) {
    const line = doc.line(number)
    if (!line.text.includes('![')) continue
    IMAGE_PATTERN.lastIndex = 0
    for (let match = IMAGE_PATTERN.exec(line.text); match; match = IMAGE_PATTERN.exec(line.text)) {
      if (isInCode(state, line.from + match.index)) continue
      const path = resolveImagePath(match[2]!, docDir)
      if (!path) continue
      out.push(
        Decoration.widget({
          widget: new ImageWidget(path, match[1]!, options.load),
          block: true,
          side: 1,
        }).range(line.to),
      )
    }
  }
}

function buildAll(state: EditorState): DecorationSet {
  const options = state.facet(inlineImageOptions)
  if (!options || isPerformanceMode(state.doc.length)) return Decoration.none
  const ranges: Range<Decoration>[] = []
  scanLines(state, state.doc, 1, state.doc.lines, options, ranges)
  return Decoration.set(ranges, true)
}

export const inlineImagesField = StateField.define<DecorationSet>({
  create: buildAll,
  update(images, tr) {
    if (!tr.docChanged) return images
    const options = tr.state.facet(inlineImageOptions)
    if (!options || isPerformanceMode(tr.state.doc.length)) return Decoration.none

    // 只重扫改动涉及的行：先删掉这些行上的旧 widget，再按新文本补上
    let mapped = images.map(tr.changes)
    const doc = tr.state.doc
    const added: Range<Decoration>[] = []
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const first = doc.lineAt(fromB)
      const last = doc.lineAt(toB)
      mapped = mapped.update({
        filterFrom: first.from,
        filterTo: last.to,
        filter: () => false,
      })
      scanLines(tr.state, doc, first.number, last.number, options, added)
    })
    return added.length > 0 ? mapped.update({ add: added, sort: true }) : mapped
  },
  provide: (field) => EditorView.decorations.from(field),
})

export function inlineImages(options: InlineImageOptions) {
  return [inlineImageOptions.of(options), inlineImagesField]
}
