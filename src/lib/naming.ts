/**
 * 文件命名规则（spec §7.2）
 */

const ILLEGAL = /[/\\:*?"<>|]/g

/** 非法字符替换为 `-`，去掉首尾空白与点 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL, '-').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^\.+/, '').trim()
}

/** 文件名对应的 Markdown 扩展名（不带点）；库里只索引 .md，Finder 打开的 .markdown / .txt 保持原样 */
export function markdownExtensionOf(fileName: string): string {
  const match = /\.(md|markdown|mdown|txt)$/i.exec(fileName)
  return match ? match[1]! : 'md'
}

/**
 * 保证扩展名：沿用当前文件的扩展名（默认 .md）。
 * 名字里自带的 .txt / .markdown 只算文件名的一部分（`todo.txt` → `todo.txt.md`），
 * 否则改完名就不再是 .md，文档会从侧栏和 Quick Open 里消失
 */
export function ensureMarkdownExtension(name: string, extension = 'md'): string {
  if (!name) return name
  if (name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return name
  return `${name}.${extension}`
}

/**
 * 取当前目录最小未占用序号：`Untitled.md` → `Untitled 2.md` → `Untitled 3.md`
 */
export function uniqueUntitledName(taken: string[], base = 'Untitled'): string {
  const takenSet = new Set(taken.map((n) => n.toLowerCase()))
  if (!takenSet.has(`${base}.md`.toLowerCase())) return `${base}.md`
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base} ${i}.md`
    if (!takenSet.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}.md`
}

/**
 * 重名自动加 `-2`（spec §7.2）
 */
export function dedupeFileName(taken: string[], desired: string): string {
  const takenSet = new Set(taken.map((n) => n.toLowerCase()))
  if (!takenSet.has(desired.toLowerCase())) return desired
  const dot = desired.lastIndexOf('.')
  const stem = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  for (let i = 2; i < 10000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!takenSet.has(candidate.toLowerCase())) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}
