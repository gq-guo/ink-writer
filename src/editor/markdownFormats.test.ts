/**
 * Markdown 全格式回归（fixtures/all-formats.md）
 *
 * 逐行检查「光标不在这一行时实际显示的文字」与样式 class：
 * 标题、行内格式、链接图片、列表任务、引用、代码块、表格、分隔线、HTML。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

import { buildDecorations, concealMarkupFacet } from '@/editor/styledSource'

const DOC = readFileSync(resolve(__dirname, '../../fixtures/all-formats.md'), 'utf-8')

interface RenderedLine {
  /** 隐藏标记之后显示的文字 */
  shown: string
  /** 行装饰 class（去掉 cm-md- 前缀） */
  lineClasses: string[]
  /** [class, 覆盖的原文] */
  marks: [string, string][]
}

/**
 * 建一个语法树完整的 state。
 * EditorState.create 只在很短的时间预算里解析，慢机器（CI）上可能只解析了开头一小段；
 * ensureSyntaxTree 只推进解析上下文，不会改这个 state 里的树 —— 必须再走一个事务，
 * state 才拿到完整的树。否则后面几行（引用、代码块、表格……）的装饰都是空的。
 */
function fullyParsedState(cursor: number, conceal: boolean): EditorState {
  const created = EditorState.create({
    doc: DOC,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(conceal)],
  })
  ensureSyntaxTree(created, DOC.length, 5000)
  const state = created.update({}).state
  expect(syntaxTree(state).length, '语法树应覆盖整篇夹具').toBe(DOC.length)
  return state
}

function render(cursor = DOC.length, conceal = true): Map<string, RenderedLine> {
  const state = fullyParsedState(cursor, conceal)
  const hidden: [number, number][] = []
  const lineClasses = new Map<number, string[]>()
  const marks: [number, number, string][] = []
  const iter = buildDecorations(state, [{ from: 0, to: DOC.length }]).iter()
  while (iter.value) {
    const spec = (iter.value as { spec?: { class?: string; attributes?: unknown } }).spec
    if (iter.from === iter.to) {
      if (spec?.class) {
        const number = state.doc.lineAt(iter.from).number
        lineClasses.set(number, [...(lineClasses.get(number) ?? []), ...spec.class.split(' ')])
      }
    } else if (spec?.class) {
      marks.push([iter.from, iter.to, spec.class])
    } else {
      hidden.push([iter.from, iter.to])
    }
    iter.next()
  }

  // 以原文为 key（夹具里每行内容唯一），方便按内容取行
  const lines = new Map<string, RenderedLine>()
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    let shown = ''
    for (let pos = line.from; pos < line.to; pos++) {
      if (!hidden.some(([from, to]) => pos >= from && pos < to)) shown += DOC[pos]
    }
    lines.set(line.text, {
      shown,
      lineClasses: (lineClasses.get(number) ?? []).map((cls) => cls.replace('cm-md-', '')),
      marks: marks
        .filter(([from]) => from >= line.from && from < line.to)
        .map(([from, to, cls]) => [cls.replace('cm-md-', ''), DOC.slice(from, to)]),
    })
  }
  return lines
}

const view = render()
const line = (text: string): RenderedLine => {
  const found = view.get(text)
  if (!found) throw new Error(`夹具里没有这一行：${text}`)
  return found
}
const marksOf = (text: string, cls: string) =>
  line(text)
    .marks.filter(([c]) => c === cls)
    .map(([, source]) => source)

describe('Markdown 全格式：标题', () => {
  it('H1–H6 各有字号 class，# 在光标外隐藏', () => {
    const levels = ['一', '二', '三', '四', '五', '六']
    levels.forEach((zh, index) => {
      const level = index + 1
      const text = `${'#'.repeat(level)} ${zh}级标题 Heading ${level}`
      expect(line(text).lineClasses).toContain(`h${level}`)
      expect(line(text).shown).toBe(`${zh}级标题 Heading ${level}`)
    })
  })

  it('结尾带 # 的标题：前后的 # 都隐藏', () => {
    expect(line('## 结尾带井号的标题 ##').shown).toBe('结尾带井号的标题')
  })

  it('Setext 标题：文字行按标题排版，下划线行不放大、弱化显示', () => {
    expect(line('Setext 一级标题').lineClasses).toContain('h1')
    expect(line('===').lineClasses).not.toContain('h1')
    expect(line('===').marks).toContainEqual(['mark', '==='])
    expect(line('Setext 二级标题').lineClasses).toContain('h2')
  })
})

describe('Markdown 全格式：行内', () => {
  const INLINE =
    '普通段落里有 **粗体**、__下划线粗体__、*斜体*、_下划线斜体_、***粗斜体***、~~删除线~~ 和 `行内代码`。'

  it('粗体 / 斜体 / 粗斜体 / 删除线 / 行内代码：光标外只剩文字', () => {
    expect(line(INLINE).shown).toBe(
      '普通段落里有 粗体、下划线粗体、斜体、下划线斜体、粗斜体、删除线 和 行内代码。',
    )
    expect(marksOf(INLINE, 'bold')).toEqual(['粗体', '下划线粗体', '粗斜体'])
    expect(marksOf(INLINE, 'italic')).toContain('斜体')
    expect(marksOf(INLINE, 'italic')).toContain('下划线斜体')
    expect(marksOf(INLINE, 'strike')).toEqual(['删除线'])
    expect(marksOf(INLINE, 'code')).toEqual(['行内代码'])
  })

  it('嵌套格式', () => {
    const text = '嵌套：**粗体里有 *斜体* 和 `代码`**，*斜体里有 **粗体***。'
    expect(line(text).shown).toBe('嵌套：粗体里有 斜体 和 代码，斜体里有 粗体。')
  })

  it('双反引号包住的行内代码', () => {
    const text = '带反引号的代码：`` 代码里有 ` 反引号 ``。'
    expect(marksOf(text, 'code')).toEqual([' 代码里有 ` 反引号 '])
    expect(line(text).shown).toBe('带反引号的代码： 代码里有 ` 反引号 。')
  })

  it('转义字符：光标外隐藏反斜杠，且不被当成格式', () => {
    const text = '转义字符：\\*不是斜体\\*、\\# 不是标题、\\`不是代码\\`。'
    expect(line(text).shown).toBe('转义字符：*不是斜体*、# 不是标题、`不是代码`。')
    expect(line(text).marks).toEqual([])
  })

  it('词中间的下划线不是强调', () => {
    expect(line('snake_case_word 里的下划线不应被当成强调。').marks).toEqual([])
  })
})

describe('Markdown 全格式：链接与图片', () => {
  it('行内链接：光标外只显示文字，文字带链接样式（不含 URL）', () => {
    const text = '行内链接 [Ink 官网](https://example.com/ink) 与带标题的 [链接](https://example.com "标题")。'
    expect(line(text).shown).toBe('行内链接 Ink 官网 与带标题的 链接。')
    expect(marksOf(text, 'link-text')).toEqual(['Ink 官网', '链接'])
  })

  it('自动链接隐藏尖括号、引用式链接只留文字（定义行不动）；图片在光标外只显示文件名', () => {
    const autolink = '自动链接 <https://example.com> 与裸链接 https://example.com/plain 。'
    expect(line(autolink).shown).toBe('自动链接 https://example.com 与裸链接 https://example.com/plain 。')
    expect(marksOf(autolink, 'link-text')).toEqual(['https://example.com', 'https://example.com/plain'])

    const reference = '引用式链接 [参考链接][ref] 。'
    expect(line(reference).shown).toBe('引用式链接 参考链接 。')
    expect(marksOf(reference, 'link-text')).toEqual(['参考链接'])
    expect(line('[ref]: https://example.com/ref').shown).toBe('[ref]: https://example.com/ref')
    expect(marksOf('[ref]: https://example.com/ref', 'url')).toEqual(['https://example.com/ref'])

    const image = '图片 ![替代文字](assets/photo.png)'
    expect(line(image).shown).toBe('图片 photo.png')
    expect(marksOf(image, 'image-name')).toEqual(['photo.png'])
  })
})

describe('Markdown 全格式：列表与任务', () => {
  it('光标外无序列表的 - * + 换成圆点，有序列表的序号保留', () => {
    for (const text of ['- 无序列表一', '* 星号列表', '+ 加号列表', '    - 嵌套三级']) {
      expect(line(text).shown).toBe(text.replace(/[-*+]/, ''))
    }
    for (const text of ['1. 有序列表一', '1) 括号序号']) {
      expect(line(text).shown).toBe(text)
      expect(line(text).marks.some(([cls]) => cls === 'mark')).toBe(true)
    }
  })

  it('嵌套靠加宽的前导空格表达层级', () => {
    expect(marksOf('  - 嵌套二级', 'list-lead')).toEqual(['  '])
    expect(marksOf('    - 嵌套三级', 'list-lead')).toEqual(['    '])
    expect(marksOf('- 无序列表一', 'list-lead')).toEqual([])
  })

  it('任务列表与普通列表疏密一致（每项都有段间距）', () => {
    expect(line('- 无序列表一').lineClasses).toContain('para')
    expect(line('- [ ] 未完成任务').lineClasses).toContain('para')
    expect(line('- [x] 已完成任务').lineClasses).toContain('para')
  })

  it('任务框弱化，任务里的格式照常处理；光标外 - [ ] 换成复选框', () => {
    expect(marksOf('- [x] 已完成任务', 'mark')).toContain('[x]')
    expect(marksOf('- [x] 已完成任务', 'task-done')).toEqual(['已完成任务'])
    expect(line('- [ ] 任务里有 **粗体** 和 `代码`').shown).toBe('任务里有 粗体 和 代码')
  })
})

describe('Markdown 全格式：块级', () => {
  it('引用：光标外隐藏 > ，每层一条竖线', () => {
    expect(line('> 一层引用，里面有 **粗体**。').lineClasses).toEqual(expect.arrayContaining(['quote', 'quote-1']))
    expect(line('> 一层引用，里面有 **粗体**。').shown).toBe('一层引用，里面有 粗体。')
    expect(line('> > 二层引用').lineClasses).toEqual(expect.arrayContaining(['quote', 'quote-2']))
    expect(line('> > 二层引用').shown).toBe('二层引用')
    expect(line('> - 引用里的列表').shown).toBe(' 引用里的列表')
  })

  it('围栏代码块：光标外围栏行只留语言名，其余有底色、不渲染', () => {
    expect(line('```ts').lineClasses).toEqual(expect.arrayContaining(['codeblock', 'codeblock-start', 'fence']))
    expect(line('```ts').shown).toBe('')
    expect(line('```').lineClasses).toEqual(expect.arrayContaining(['codeblock-end', 'fence']))
    expect(line('~~~').shown).toBe('')
    const inner = '波浪线围栏，里面的 **粗体** 和 # 标题 都不应被渲染'
    expect(line(inner).shown).toBe(inner)
    expect(line(inner).marks.map(([cls]) => cls)).toEqual(['codeblock-text'])
  })

  it('缩进代码块与围栏代码块同样有底色', () => {
    expect(line('    缩进代码块（四个空格）').lineClasses).toEqual(
      expect.arrayContaining(['codeblock', 'codeblock-start']),
    )
    expect(line('    第二行').lineClasses).toContain('codeblock-end')
  })

  it('表格：表头加粗，竖线与分隔行弱化，单元格里的格式照常处理', () => {
    expect(marksOf('| 左对齐 | 居中 | 右对齐 |', 'bold')).toEqual(['左对齐', '居中', '右对齐'])
    expect(marksOf('|:---|:---:|---:|', 'mark')).toEqual(['|:---|:---:|---:|'])
    expect(line('| **粗体** | `代码` | 123 |').shown).toBe('| 粗体 | 代码 | 123 |')
  })

  it('三种分隔线：横线画在整行上', () => {
    for (const text of ['---', '***', '___']) {
      expect(line(text).marks).toEqual([['hr', text]])
      expect(line(text).lineClasses).toContain('hr-line')
    }
  })

  it('HTML 标签弱化、原样显示；只有 <kbd> 画成按键并在光标外隐藏标签', () => {
    expect(line('<details>').marks.map(([cls]) => cls)).toEqual(['mark'])
    expect(line('<details>').shown).toBe('<details>')
    const kbd = '行内 HTML：<kbd>⌘</kbd> + <kbd>K</kbd>'
    expect(line(kbd).shown).toBe('行内 HTML：⌘ + K')
    expect(marksOf(kbd, 'kbd')).toEqual(['⌘', 'K'])
  })
})

describe('Markdown 全格式：光标所在行与设置', () => {
  it('光标所在行显示全部源码', () => {
    const text = '普通段落里有 **粗体**、__下划线粗体__、*斜体*、_下划线斜体_、***粗斜体***、~~删除线~~ 和 `行内代码`。'
    const atLine = render(DOC.indexOf(text) + 3)
    expect(atLine.get(text)?.shown).toBe(text)
  })

  it('设置「显示 Markdown 标记」时全文都不隐藏', () => {
    const all = render(DOC.length, false)
    for (const [text, rendered] of all) expect(rendered.shown).toBe(text)
  })
})

describe('慢机器上也能拿到完整语法树（CI 曾因此偶发失败）', () => {
  it('初次解析只解析了开头一小段时，render 仍按整篇夹具出结果', () => {
    // 让 Date.now 每次前进 50ms：EditorState.create 的解析预算立刻用完，只解析开头
    let now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (now += 50))
    let lines: Map<string, RenderedLine>
    try {
      lines = render()
    } finally {
      spy.mockRestore()
    }
    const quote = [...lines.values()].find((line) => line.lineClasses.includes('quote'))
    expect(quote, '文末附近的引用块也应带上样式').toBeDefined()
  })
})
