/**
 * 文件命名规则（spec §7.2）
 */

const ILLEGAL = /[/\\:*?"<>|]/g

/** 非法字符替换为 `-`，去掉首尾空白与点 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL, '-').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^\.+/, '').trim()
}

/** 保证扩展名为 .md */
export function ensureMarkdownExtension(name: string): string {
  if (/\.(md|markdown|mdown|txt)$/i.test(name)) return name
  return `${name}.md`
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
