/**
 * 标题提取（R3 / spec §7.3）
 *
 * displayTitle = 首个 H1 ?? 文件名去扩展名 ?? "Untitled"
 * H1 永不触发文件重命名。
 */

/** 匹配行首 1 个 # + 空格，去除行尾 # 序列与首尾空白 */
const H1_PATTERN = /^# [ \t]*(.+?)[ \t]*#*[ \t]*$/m

const EXTENSION_PATTERN = /\.(md|markdown|mdown|txt)$/i

export function extractDisplayTitle(content: string, fileName: string): string {
  const m = H1_PATTERN.exec(content)
  if (m?.[1]?.trim()) return m[1].trim().slice(0, 80)
  const base = fileName.replace(EXTENSION_PATTERN, '')
  return base || 'Untitled'
}

/**
 * 标题重算：仅当首个 H1 所在行变化时才需要更新。
 * 返回是否发生了变化。
 */
export function titleChanged(
  content: string,
  previousTitle: string,
  fileName: string,
): boolean {
  return extractDisplayTitle(content, fileName) !== previousTitle
}
