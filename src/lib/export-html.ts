/**
 * HTML 导出（spec §15.1）与打印样式（spec §15.2）
 *
 * 管线：remark-parse → remark-gfm → remark-rehype → rehype-stringify
 * 输出单文件 HTML：内嵌 <style>、<meta charset>、<title>。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import type { AppSettings } from '@/lib/types'
import { FONT_STACKS } from '@/stores/settingsStore'

/** 代码块 / 行内代码固定用等宽字体，不跟随正文字体 */
const CODE_FONT_STACK = `"JetBrains Mono", "SF Mono", Menlo, monospace`

/**
 * 打印/导出用的排版样式表（颜色取自 spec §17.1 的 Light 主题）
 *
 * 正文字体取当前选择的写作字体。只接受 FONT_STACKS 的键，字体栈来自内部固定表，
 * 不会把用户文本拼进 CSS。App 内置字体（iA Writer Quattro、JetBrains Mono 等）
 * 不随文件嵌入，读者机器上没有时按栈尾的系统字体回落（衬线 → serif，等宽 → monospace）。
 */
export function buildExportStylesheet(fontFamily: AppSettings['fontFamily']): string {
  return `
:root {
  --background: #FAFAF8;
  --foreground: #1D1D1F;
  --secondary: #86868B;
  --border: #E5E5E0;
  --code-bg: #F2F1EC;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--background);
  color: var(--foreground);
}
body {
  font-family: ${FONT_STACKS[fontFamily]};
  font-size: 18px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 680px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 700; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.18em; }
h4, h5, h6 { font-size: 1em; }
p { margin: 0 0 1em; }
a { color: #5B7FFF; text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: ${CODE_FONT_STACK};
  font-size: 0.85em;
  background: var(--code-bg);
  padding: 0.12em 0.35em;
  border-radius: 4px;
}
pre {
  background: var(--code-bg);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.5;
}
pre code { background: none; padding: 0; font-size: 0.85em; }
blockquote {
  margin: 1em 0;
  padding-left: 14px;
  border-left: 2px solid rgba(91, 127, 255, 0.3);
  color: rgba(29, 29, 31, 0.9);
}
ul, ol { padding-left: 1.4em; margin: 0 0 1em; }
li { margin: 0.2em 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
th { background: var(--code-bg); }
@media print {
  html, body { background: #FFFFFF; }
  main { max-width: none; padding: 0; }
  pre, code { background: #F4F4F2; }
  a { color: inherit; text-decoration: underline; }
  h1, h2, h3 { break-after: avoid; }
  pre, blockquote, table { break-inside: avoid; }
}
`
}

/** 导出页里允许的链接协议；相对路径（assets/x.png、#标题）不带协议，也放行 */
const SAFE_PROTOCOLS = new Set(['http', 'https', 'mailto'])

interface UrlNode {
  url?: string
  children?: UrlNode[]
}

/** `[x](javascript:…)` 在 app 里有 CSP 挡着，导出的 HTML 在浏览器里打开就没有了：去掉危险协议 */
export function isSafeUrl(url: string): boolean {
  // 浏览器解析前会删掉 tab / 换行等控制字符：`java\tscript:` 也算 javascript:
  // eslint-disable-next-line no-control-regex -- 匹配控制字符正是目的
  const compact = url.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return !scheme || SAFE_PROTOCOLS.has(scheme[1]!.toLowerCase())
}

function stripUnsafeUrls() {
  const walk = (node: UrlNode) => {
    if (typeof node.url === 'string' && !isSafeUrl(node.url)) node.url = ''
    node.children?.forEach(walk)
  }
  return (tree: object) => walk(tree as UrlNode)
}

export function markdownToHtml(markdown: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(stripUnsafeUrls)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(markdown)
  return String(file)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 生成单文件 HTML（spec §15.1） */
export function buildStandaloneHtml(
  title: string,
  markdown: string,
  fontFamily: AppSettings['fontFamily'],
): string {
  const body = markdownToHtml(markdown)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${buildExportStylesheet(fontFamily)}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}
