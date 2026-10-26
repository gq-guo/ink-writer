/**
 * 文档名（R3 / spec §7.3）
 *
 * 文件名就是文档的名字：侧栏、快速打开、顶栏、导出都显示文件名去扩展名，
 * 正文里的 H1 只是正文的一部分，不参与命名（和 iA Writer 一样）。
 *
 * 新文档自动命名：还叫 Untitled 的文档，文件名跟着第一行走；
 * 手动改过名就不再跟随（见 documentStore 的 autoNamedPath）。
 */
import { sanitizeFileName } from '@/lib/naming'

const EXTENSION_PATTERN = /\.(md|markdown|mdown|txt)$/i
/** 新建文档的默认名：Untitled、Untitled 2、Untitled 3 … */
const UNTITLED_PATTERN = /^Untitled(?: \d+)?$/i
/** 重命名撞名时 Rust 追加的序号：Foo-2 */
const DEDUPE_SUFFIX = /-\d+$/
/** 由第一行生成的文件名最长这么多个字 */
const AUTO_NAME_MAX_CHARS = 60

/** 文档名 = 文件名去扩展名（空则 Untitled） */
export function displayNameOf(fileName: string): string {
  return fileName.replace(EXTENSION_PATTERN, '') || 'Untitled'
}

export function isUntitledName(name: string): boolean {
  return UNTITLED_PATTERN.test(name)
}

/**
 * 由第一行生成文件名：取第一个非空行，去掉 Markdown 标记（# 标题、> 引用、列表符号、任务框、
 * 粗斜体 / 代码 / 删除线符号），再按文件名规则清理、截断。第一行没有可用文字时返回 null。
 */
export function nameFromFirstLine(content: string): string | null {
  const line = content.split('\n').find((text) => text.trim() !== '')
  if (!line) return null
  const text = line
    .trim()
    .replace(/^#{1,6}(?:\s+|$)/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/^>\s*/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*|__|~~|[*`]/g, '')
  const chars = [...sanitizeFileName(text)]
  const name = chars.slice(0, AUTO_NAME_MAX_CHARS).join('').trim()
  return name || null
}

/** 文件名是不是这个名字（含撞名时被追加了 -2 的情况） */
export function sameName(fileStem: string, name: string): boolean {
  return fileStem === name || fileStem.replace(DEDUPE_SUFFIX, '') === name
}

/**
 * 打开文档时判断它是否还在「跟着第一行自动命名」：
 * 还叫 Untitled，或者文件名正好就是第一行生成的名字（上次自动命名的结果，重启后也能接上）。
 */
export function followsFirstLine(fileName: string, content: string): boolean {
  const stem = displayNameOf(fileName)
  if (isUntitledName(stem)) return true
  const name = nameFromFirstLine(content)
  return name !== null && sameName(stem, name)
}
