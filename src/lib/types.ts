/**
 * Ink 领域模型 —— 与《Ink_开发规格说明书》§5.1 保持一致。
 * 任何在此文件出现的类型都应被视为跨层契约（Rust ↔ TS）。
 */

/** 库内一篇文档的元数据（Rust 返回） */
export interface DocumentMeta {
  /** 绝对路径，作为唯一 id */
  path: string
  /** 文件名（含扩展名） */
  fileName: string
  /** 相对库根目录的目录前缀，如 "Project/"，根目录为 "" */
  dirPrefix: string
  /** 文件 mtime，Unix 秒 */
  mtime: number
  /** 字节数 */
  size: number
  /** 文档名 = 文件名去扩展名（空则 "Untitled"）。正文里的 H1 不参与命名 */
  displayTitle: string
}

/** 打开后的文档 */
export interface Document extends DocumentMeta {
  /** 已统一为 UTF-8 */
  content: string
  /** 原始编码，用于一次性提示 */
  originalEncoding: 'utf-8' | 'gbk' | 'unknown'
  /** 打开序号：只有 openDocument 递增，rename 等元数据变更不影响编辑器重建 */
  openSeq: number
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export interface DocumentStatistics {
  /** CJK 字 + 西文词 的总和，状态栏显示此值 */
  words: number
  cjkChars: number
  latinWords: number
  /** 不含空白 */
  characters: number
  paragraphs: number
  /** 句子数 */
  sentences: number
  /** ≥1 */
  readingMinutes: number
}

export interface ExternalConflict {
  path: string
  diskMtime: number
  diskContent: string
}

export type ConflictChoice = 'keep-mine' | 'load-disk' | 'save-copy'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  /** 已不再生效（accent 跟随主题），保留字段以兼容旧设置文件 */
  accentColor: string
  fontFamily: 'system' | 'quattro' | 'serif' | 'noto' | 'wenkai' | 'mono'
  fontSize: number
  lineHeight: number
  contentWidth: number
  libraryPath: string
  typewriterMode: boolean
  /** 输入时检查拼写（系统红色波浪线） */
  spellcheck: boolean
  /** 显示全部 Markdown 标记；关闭时光标不在的行隐藏 # ** ` 等标记 */
  showMarkup: boolean
  /** 收藏的文档（绝对路径） */
  favorites: string[]
  /** 界面语言：跟随系统 / 简体中文 / English */
  locale: 'system' | 'zh-CN' | 'en'
}

/** Rust `read_document` 的返回 */
export interface ReadDocumentResult {
  content: string
  encoding: string
  mtime: number
  size: number
  /** 原文件行尾风格 */
  lineEnding: 'lf' | 'crlf'
}

/** Rust `write_document` 的返回 */
export interface WriteResult {
  mtime: number
}

/** 正文搜索命中 */
export interface SearchHit {
  path: string
  fileName: string
  dirPrefix: string
  line: number
  /** 命中行片段（前后各 30 字符） */
  snippet: string
  /** 命中词在文件中的字节偏移 */
  start: number
  /** 命中词结束位置 */
  end: number
}

export interface Toast {
  id: number
  message: string
  kind: 'error' | 'info' | 'success'
}

/** 目录里的一个标题（右侧悬浮目录） */
export interface OutlineHeading {
  /** 1–6 */
  level: number
  text: string
  /** 标题在文档中的起点 */
  pos: number
}
