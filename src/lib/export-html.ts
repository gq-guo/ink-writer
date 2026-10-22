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

/** 打印/导出用的排版样式表（颜色取自 spec §17.1 的 Light 主题） */
export const EXPORT_STYLESHEET = `
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
  font-family: -apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
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
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
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

export function markdownToHtml(markdown: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
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
export function buildStandaloneHtml(title: string, markdown: string): string {
  const body = markdownToHtml(markdown)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_STYLESHEET}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}
