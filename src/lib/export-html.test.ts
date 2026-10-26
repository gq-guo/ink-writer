import { describe, expect, it } from 'vitest'
import { buildExportStylesheet, buildStandaloneHtml } from '@/lib/export-html'
import { FONT_STACKS } from '@/stores/settingsStore'

const CODE_FONT_STACK = `"JetBrains Mono", "SF Mono", Menlo, monospace`

/** 取出样式表里某条规则的 font-family 值 */
function fontFamilyOf(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)
  return rule?.[1]?.match(/font-family:\s*([^;]+);/)?.[1]?.trim()
}

describe('buildStandaloneHtml 导出字体（spec §15.1）', () => {
  it('正文使用当前选择的写作字体：衬线', () => {
    const html = buildStandaloneHtml('标题', '正文', 'serif')
    expect(fontFamilyOf(html, 'body')).toBe(FONT_STACKS.serif)
  })

  it('正文使用当前选择的写作字体：等宽', () => {
    const html = buildStandaloneHtml('标题', '正文', 'mono')
    expect(fontFamilyOf(html, 'body')).toBe(FONT_STACKS.mono)
  })

  it('每种字体选择都写进 body，且栈尾有系统回落', () => {
    for (const family of Object.keys(FONT_STACKS) as (keyof typeof FONT_STACKS)[]) {
      const stack = fontFamilyOf(buildExportStylesheet(family), 'body')
      expect(stack).toBe(FONT_STACKS[family])
      expect(stack).toMatch(/(sans-serif|serif|monospace)$/)
    }
  })

  it('代码不跟随正文字体，固定用等宽字体', () => {
    for (const family of ['serif', 'system'] as const) {
      const html = buildStandaloneHtml('标题', '`a`\n\n```\nb\n```', family)
      expect(fontFamilyOf(html, 'code')).toBe(CODE_FONT_STACK)
      expect(html).toContain('<pre><code>')
    }
  })

  it('标题不单独设置字体，继承正文', () => {
    const css = buildExportStylesheet('serif')
    const fontRules = css.match(/font-family:/g) ?? []
    // 只有 body 与 code 两处声明字体
    expect(fontRules).toHaveLength(2)
  })
})
