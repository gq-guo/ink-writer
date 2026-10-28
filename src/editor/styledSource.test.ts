import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'

import { buildDecorations, concealMarkupFacet, cursorEngagedField, mergeRanges } from '@/editor/styledSource'
import { computeFocusDecorations, focusModeField, setFocusModeEffect } from '@/editor/focusMode'

function stateWith(doc: string, focus = false) {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), focusModeField] })
  if (focus) {
    state = state.update({ effects: setFocusModeEffect.of(true) }).state
  }
  return state
}

function rangeOf(state: EditorState) {
  return { from: 0, to: state.doc.length }
}

function classesOf(decorations: ReturnType<typeof buildDecorations>): string[] {
  const cursor = decorations.iter()
  const result: string[] = []
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class) result.push(...decoration.spec.class.split(' '))
    cursor.next()
  }
  return result
}

describe('样式化源码（spec §2）', () => {
  it('标题行加上对应字号 class', () => {
    const state = stateWith('# 标题\n\n正文')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-h1')
  })

  it('H2/H3 使用不同 class', () => {
    const state = stateWith('## 二级\n\n### 三级')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-h2')
    expect(classes).toContain('cm-md-h3')
  })

  it('语法符号被弱化（HeaderMark / QuoteMark / ListMark）', () => {
    const state = stateWith('> 引用\n\n- 列表')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes.filter((c) => c === 'cm-md-mark').length).toBeGreaterThanOrEqual(2)
  })

  it('加粗 / 斜体 / 删除线 / 行内代码都有对应样式', () => {
    const state = stateWith('**粗** *斜* ~~删~~ `码`')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-bold')
    expect(classes).toContain('cm-md-italic')
    expect(classes).toContain('cm-md-strike')
    expect(classes).toContain('cm-md-code')
  })

  it('链接文本着色、URL 弱化', () => {
    const state = stateWith('[文本](http://example.com)')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-link-text')
    expect(classes).toContain('cm-md-url')
  })

  it('引用块有左侧竖线样式', () => {
    const state = stateWith('> 引用')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-quote')
  })

  it('代码块整块有底色', () => {
    const state = stateWith('```js\nconst a = 1\n```')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-codeblock')
  })

  it('分隔线渲染为通栏细线', () => {
    const state = stateWith('---')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-hr')
  })

  it('不隐藏任何字符：装饰数量与文本长度无关地覆盖原文', () => {
    const doc = '**粗体**'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [rangeOf(state)])
    // 装饰只添加样式，不删除文本
    expect(state.doc.toString()).toBe(doc)
    expect(decorations.size).toBeGreaterThan(0)
  })
})

/** 取出被弱化（ink-focus-dim）的范围 */
function dimRanges(decorations: ReturnType<typeof computeFocusDecorations>) {
  const result: { from: number; to: number }[] = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class?.includes('ink-focus-dim')) {
      result.push({ from: cursor.from, to: cursor.to })
    }
    cursor.next()
  }
  return result
}

/** 取出当前块的竖线行装饰 */
function activeLines(decorations: ReturnType<typeof computeFocusDecorations>) {
  const result: number[] = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class?.includes('ink-focus-active')) result.push(cursor.from)
    cursor.next()
  }
  return result
}

describe('Focus Mode（spec §9）', () => {
  it('关闭时不产生任何装饰', () => {
    const state = stateWith('第一段\n\n第二段')
    const decorations = computeFocusDecorations(state, [rangeOf(state)])
    expect(decorations.size).toBe(0)
  })

  it('开启时非当前块被弱化', () => {
    const doc = '第一段\n\n第二段\n\n第三段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    // 三个段落 → 两个被弱化（外加当前块的竖线行装饰）
    expect(dimRanges(decorations)).toHaveLength(2)
  })

  it('当前块带 accent 竖线（行装饰）', () => {
    const doc = '第一段\n\n第二段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    const active = activeLines(decorations)
    expect(active.length).toBeGreaterThan(0)
  })

  it('用行装饰：多行块的每一行都带 class（行元素复用，opacity 过渡才生效）', () => {
    const doc = '第一行\n第二行\n\n另一段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: doc.length },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    const dims = dimRanges(decorations)
    // 第一段两行各一个行装饰（点装饰，from === to，落在行首）
    expect(dims).toEqual([
      { from: 0, to: 0 },
      { from: 4, to: 4 },
    ])
  })

  it('段落末尾换行、还没输入时：竖线延续到新空行，上一段仍是当前块', () => {
    // 光标在第 3 行（kai1 后刚按回车得到的空行）
    const doc = 'meiyou\nkai1\n\n\nf'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 'meiyou\nkai1\n'.length },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    const lineOf = (pos: number) => withSelection.doc.lineAt(pos).number
    expect(activeLines(decorations).map(lineOf)).toEqual([1, 2, 3])
    // 隔着空行的下一段照常变淡
    expect(dimRanges(decorations).map((range) => lineOf(range.from))).toEqual([5])
  })

  it('连按两次回车（隔了空行）：只标当前空行，上一段变淡', () => {
    const doc = 'meiyou\nkai1\n\n'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: doc.length },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    const lineOf = (pos: number) => withSelection.doc.lineAt(pos).number
    expect(activeLines(decorations).map(lineOf)).toEqual([4])
    expect(dimRanges(decorations).map((range) => lineOf(range.from))).toEqual([1, 2])
  })

  it('空行上下都紧挨着文字时：上下两块都算当前块（打字后它们会合成一段）', () => {
    const doc = 'kai1\n\nf'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 'kai1\n'.length },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    expect(dimRanges(decorations)).toHaveLength(0)
    expect(activeLines(decorations)).toHaveLength(3)
  })

  it('当前块不被弱化', () => {
    const doc = '第一段\n\n第二段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    // 被弱化的块不应覆盖光标所在的第一段
    expect(dimRanges(decorations).every((range) => range.from > 0)).toBe(true)
  })
})

describe('mergeRanges', () => {
  it('合并重叠与相接的区间（块级替换把可见区间切开、外扩后会重叠）', () => {
    expect(mergeRanges([{ from: 30, to: 40 }, { from: 0, to: 10 }, { from: 5, to: 20 }, { from: 21, to: 25 }])).toEqual([
      { from: 0, to: 25 },
      { from: 30, to: 40 },
    ])
  })

  it('合并后同一段只出一层行内代码标记', () => {
    const doc = '段落 `code`\n\n后面'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const ranges = mergeRanges([{ from: 0, to: doc.length }, { from: 0, to: 12 }])
    expect(classesOf(buildDecorations(state, ranges)).filter((c) => c === 'cm-md-code')).toHaveLength(1)
  })
})

describe('光标外隐藏 Markdown 标记', () => {
  function concealed(doc: string, cursor: number, conceal = true): string[] {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(conceal)],
    })
    const hidden: string[] = []
    const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
    while (iter.value) {
      const spec = (iter.value as { spec?: { class?: string } }).spec
      if (!spec?.class && iter.to > iter.from) hidden.push(doc.slice(iter.from, iter.to))
      iter.next()
    }
    return hidden
  }

  const DOC = '## 数据准备\n\n1. 5 个 org 账号 `done` **重点** ~~删掉~~\n\n```\n`代码块不动`\n```'

  it('光标不在的行：隐藏 # 、反引号、粗体与删除线标记', () => {
    expect(concealed(DOC, DOC.length)).toEqual(['## ', '`', '`', '**', '**', '~~', '~~'])
  })

  it('光标所在行显示全部标记', () => {
    // 光标在标题行：标题的 # 不隐藏，列表行照常隐藏；光标不在代码块里，围栏行也隐藏
    expect(concealed(DOC, 3)).toEqual(['`', '`', '**', '**', '~~', '~~', '```', '```'])
  })

  it('设置为显示标记时不隐藏任何字符', () => {
    expect(concealed(DOC, DOC.length, false)).toEqual([])
  })

  it('刚打开文档时光标停在标题行，用户操作前标题的 # 仍然隐藏', () => {
    const doc = '# OS 迁移测试\n\n正文'
    const opened = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(true), cursorEngagedField],
    })
    const hiddenIn = (state: EditorState) => {
      const hidden: string[] = []
      const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
      while (iter.value) {
        const spec = (iter.value as { spec?: { class?: string } }).spec
        if (!spec?.class && iter.to > iter.from) hidden.push(doc.slice(iter.from, iter.to))
        iter.next()
      }
      return hidden
    }
    expect(hiddenIn(opened)).toEqual(['# '])

    // 程序设置光标（不带 userEvent）不算用户操作
    const programmatic = opened.update({ selection: { anchor: 2 } }).state
    expect(hiddenIn(programmatic)).toEqual(['# '])

    // 用户点进标题行后显示源码
    const clicked = opened.update({ selection: { anchor: 2 }, userEvent: 'select.pointer' }).state
    expect(hiddenIn(clicked)).toEqual([])
  })

  it('光标在代码块的任一行：两条围栏都显示', () => {
    const doc = '正文\n\n```ts\nconst a = 1\n```'
    expect(concealed(doc, doc.indexOf('const'))).toEqual([])
    expect(concealed(doc, 1)).toEqual(['```ts', '```'])
  })

  it('没有结尾围栏的代码块只隐藏开头一行', () => {
    expect(concealed('正文\n\n```\n代码', 1)).toEqual(['```'])
  })

  it('无序列表按层级换成 • ◦ ▪，光标所在行保留 -', () => {
    const doc = '- 一\n  - 二\n    - 三\n\n正文'
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(true)],
    })
    const symbols: string[] = []
    const iter = buildDecorations(state, [{ from: 0, to: doc.length }]).iter()
    while (iter.value) {
      const widget = (iter.value as { spec?: { widget?: { symbol?: string } } }).spec?.widget
      if (widget?.symbol) symbols.push(widget.symbol)
      iter.next()
    }
    expect(symbols).toEqual(['•', '◦', '▪'])
    expect(concealed(doc, 1)).toEqual(['-', '-'])
  })

  it('只有 # 没有文字的标题不隐藏（否则整行看不见）', () => {
    expect(concealed('#\n\n正文', 5)).toEqual([])
  })
})

describe('标记外悬（列表符号 / 标题 #）', () => {
  /** 行装饰的 style（零长度区间）与外悬定宽盒（cm-md-hang 标记：盒内文字 → 宽度） */
  function decorate(doc: string, cursor: number, conceal = true) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(conceal)],
    })
    const lines = new Map<number, string>()
    const boxes = new Map<string, string>()
    const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
    while (iter.value) {
      const spec = (iter.value as { spec?: { class?: string; attributes?: { style?: string } } }).spec
      const style = spec?.attributes?.style
      if (style && iter.from === iter.to) lines.set(state.doc.lineAt(iter.from).number, style)
      if (style && spec?.class === 'cm-md-hang') boxes.set(doc.slice(iter.from, iter.to), style)
      iter.next()
    }
    return { lines, boxes }
  }
  const lineStyles = (doc: string, cursor: number, conceal = true) => decorate(doc, cursor, conceal).lines

  it('标记连同空格放进正好 Nch 宽的盒子，文字精确落在左边缘', () => {
    expect(decorate('- 列表项', 0).boxes.get('- ')).toBe('width:2ch')
    expect(decorate('10. 第十项', 0).boxes.get('10. ')).toBe('width:4ch')
    expect(decorate('## 标题', 1).boxes.get('## ')).toBe('width:3ch')
    // # 已隐藏的标题行不需要盒子
    expect(decorate('## 标题\n\n正文', 9).boxes.has('## ')).toBe(false)
  })

  it('顶层列表：文字落在正文左边缘，「- 」挂在左边距里', () => {
    const style = lineStyles('段落\n\n- 列表项', 0).get(3)!
    expect(style).toContain('padding-left:calc(0.00em + 0ch)')
    expect(style).toContain('text-indent:calc(-1 * (0.00em + 0ch + 2ch))')
  })

  it('嵌套列表：折行对齐到本级文字，只把标记挂出去', () => {
    const style = lineStyles('- 一级\n  - 二级', 0).get(2)!
    expect(style).toContain('padding-left:calc(1.20em + 0ch)')
    expect(style).toContain('text-indent:calc(-1 * (1.20em + 0ch + 2ch))')
  })

  it('引用里的列表：标记留在竖线右边，光标外不再为隐藏的「> 」留宽', () => {
    const doc = '> - 引用里的列表\n\n正文'
    expect(lineStyles(doc, doc.length).get(1)).toBe(
      'padding-left:calc(16px + 0.00em + 0ch + 2ch);text-indent:calc(-1 * (0ch + 0.00em + 0ch + 2ch))',
    )
    expect(lineStyles(doc, 3).get(1)).toBe(
      'padding-left:calc(16px + 0.00em + 0ch + 2ch);text-indent:calc(-1 * (2ch + 0.00em + 0ch + 2ch))',
    )
  })

  it('有序列表按标记长度外悬', () => {
    expect(lineStyles('10. 第十项', 0).get(1)).toContain('+ 4ch))')
  })

  it('光标所在的标题行：「## 」外悬，文字不随光标进出移动', () => {
    expect(lineStyles('## 标题\n\n正文', 1).get(1)).toBe('text-indent:-3ch')
  })

  it('光标不在的标题行：# 已隐藏，不加外悬', () => {
    expect(lineStyles('## 标题\n\n正文', 9).has(1)).toBe(false)
  })

  it('关闭隐藏标记时，所有 ATX 标题都外悬', () => {
    expect(lineStyles('# 一\n\n### 三\n\n正文', 12, false).get(3)).toBe('text-indent:-4ch')
  })
})
