/**
 * i18n：简体中文 / English，跟随系统语言（安装时首选）
 *
 * - 偏好存在 AppSettings.locale（'system' | 'zh-CN' | 'en'），默认 'system'
 * - 解析规则：navigator.language 以 zh 开头 → 简体中文，否则 English
 * - 两种用法：
 *   - 组件内：const t = useT()（locale 变化时自动重渲染）
 *   - 非 React 代码（store / 命令）：直接 t('key')，读取模块内最新 locale
 */

import { useCallback } from 'react'
import { create } from 'zustand'

export type Locale = 'zh-CN' | 'en'
export type LocalePreference = 'system' | Locale

const zh: Record<string, string> = {
  // ── 通用 ──
  'common.words': '字',
  'common.minRead': '分钟',
  'common.wordsUnit': 'words',
  'common.minReadUnit': 'min read',

  // ── 顶栏 ──
  'topbar.rename': '重命名',
  'topbar.search': '搜索文档（⌘P）',
  'topbar.typography': '排版',
  'topbar.more': '更多',
  'topbar.focusMode': 'Focus Mode',
  'topbar.typewriter': 'Typewriter',
  'topbar.hideSidebar': '隐藏侧边栏',
  'topbar.showSidebar': '显示侧边栏',

  // ── 侧边栏 ──
  'sidebar.all': 'All Documents',
  'sidebar.recent': 'Recent',
  'sidebar.favorites': 'Favorites',
  'sidebar.newDocument': 'New Document',
  'sidebar.empty.library': '文档库还是空的',
  'sidebar.empty.favorites': '还没有收藏',
  'sidebar.group.today': 'Today',
  'sidebar.group.yesterday': 'Yesterday',
  'sidebar.group.thisWeek': 'This Week',
  'sidebar.group.earlier': 'Earlier',
  'sidebar.collapse': '折叠侧边栏',
  'sidebar.context.open': 'Open',
  'sidebar.context.addFavorite': 'Add to Favorites',
  'sidebar.context.removeFavorite': 'Remove from Favorites',
  'sidebar.context.rename': 'Rename…',
  'sidebar.context.reveal': 'Reveal in Finder',
  'sidebar.context.trash': 'Move to Trash',

  // ── 更多菜单 ──
  'menu.favorite.add': '加入收藏',
  'menu.favorite.remove': '取消收藏',
  'menu.rename': '重命名…',
  'menu.reveal': '在访达中显示',
  'menu.exportHtml': '导出 HTML',
  'menu.print': '打印…',
  'menu.trash': '移入废纸篓',
  'menu.noDocument': '没有打开的文档',
  'menu.language': '语言',
  'menu.lang.system': '跟随系统',
  'menu.lang.zh': '简体中文',
  'menu.lang.en': 'English',

  // ── 排版弹层 ──
  'type.title': '写作字体',
  'type.fontSize': '字号',
  'type.lineHeight': '行高',
  'type.columnWidth': '栏宽',
  'type.font.system': '系统字体',
  'type.font.serif': '衬线体',
  'type.font.mono': '等宽字体',

  // ── 状态栏 / 统计卡 ──
  'stats.words': 'Words',
  'stats.characters': 'Characters',
  'stats.paragraphs': 'Paragraphs',
  'stats.sentences': 'Sentences',
  'stats.readingTime': 'Reading time',

  // ── 主区头部时间 ──
  'meta.today': 'Today',
  'meta.yesterday': 'Yesterday',

  // ── 空文档引导 ──
  'empty.start': 'Start writing.',
  'empty.firstThought': '写下你的第一个想法…',

  // ── 空库引导 ──
  'bootstrap.choose': '选择文档库位置',
  'bootstrap.useDefault': '使用默认位置',
  'bootstrap.defaultHint': '默认 ~/Documents/Ink',

  // ── 冲突对话框 ──
  'conflict.message': '已被其他应用修改。',
  'conflict.keepMine': '保留我的版本',
  'conflict.loadDisk': '加载磁盘版本',
  'conflict.saveCopy': '另存副本…',

  // ── Quick Open ──
  'quickOpen.placeholder': 'Search documents...',
  'quickOpen.empty': 'No matching documents',
  'quickOpen.contentGroup': 'In documents',

  // ── 命令面板 ──
  'palette.placeholder': 'Type a command...',
  'palette.empty': 'No matching commands',
  'palette.group.file': '文件',
  'palette.group.edit': '编辑',
  'palette.group.view': '视图',
  'palette.group.mode': '模式',
  'palette.group.type': '排版',
  'palette.group.doc': '文档',

  // ── 命令标题 ──
  'cmd.doc.new': 'New Document',
  'cmd.doc.open': 'Open Document…',
  'cmd.doc.save': 'Save',
  'cmd.editor.find': 'Find',
  'cmd.doc.quickOpen': 'Quick Open',
  'cmd.app.palette': 'Command Palette',
  'cmd.app.sidebar': 'Toggle Sidebar',
  'cmd.mode.focus': 'Focus Mode',
  'cmd.mode.typewriter': 'Typewriter Mode',
  'cmd.app.theme': 'Toggle Theme',
  'cmd.font.larger': 'Increase Font Size',
  'cmd.font.smaller': 'Decrease Font Size',
  'cmd.export.html': 'Export as HTML',
  'cmd.file.print': 'Print…',
  'cmd.doc.rename': 'Rename Document',
  'cmd.doc.reveal': 'Reveal in Finder',
  'cmd.doc.delete': 'Move Document to Trash',

  // ── store / 命令里的 Toast ──
  'toast.gbkNotice': '已按 GBK 解码，保存时将转为 UTF-8',
  'toast.watchFailed': '无法监听文档库',
  'toast.libraryMissing': '找不到文档库',
  'toast.trashed': '文档已移入废纸篓',
  'toast.externalDeleted': '文件已在外部删除',
  'toast.perfMode': '文档超过 10MB，已进入性能模式（关闭语法高亮与 Focus Mode）',
  'toast.exportedHtml': '已导出 HTML',
  'toast.createDirFailed': '无法创建目录',
  'toast.imageNoDoc': '请先打开一个文档再插入图片',
  'save.saving': '保存中…',
  'save.saved': '已保存',

  // ── CM6 查找面板 ──
  'search.find': '查找',
  'search.replace': '替换为',
  'search.next': '下一个',
  'search.previous': '上一个',
  'search.all': '全部选中',
  'search.replaceOne': '替换',
  'search.replaceAll': '全部替换',
  'search.matchCase': '区分大小写',
  'search.regexp': '正则',
  'search.wholeWord': '全词',
  'search.close': '关闭',
}

const en: Record<string, string> = {
  'common.words': 'words',
  'common.minRead': 'min',
  'common.wordsUnit': 'words',
  'common.minReadUnit': 'min read',

  'topbar.rename': 'Rename',
  'topbar.search': 'Quick Open (⌘P)',
  'topbar.typography': 'Typography',
  'topbar.more': 'More',
  'topbar.focusMode': 'Focus Mode',
  'topbar.typewriter': 'Typewriter',
  'topbar.hideSidebar': 'Hide Sidebar',
  'topbar.showSidebar': 'Show Sidebar',

  'sidebar.all': 'All Documents',
  'sidebar.recent': 'Recent',
  'sidebar.favorites': 'Favorites',
  'sidebar.newDocument': 'New Document',
  'sidebar.empty.library': 'Your library is empty',
  'sidebar.empty.favorites': 'No favorites yet',
  'sidebar.group.today': 'Today',
  'sidebar.group.yesterday': 'Yesterday',
  'sidebar.group.thisWeek': 'This Week',
  'sidebar.group.earlier': 'Earlier',
  'sidebar.collapse': 'Collapse Sidebar',
  'sidebar.context.open': 'Open',
  'sidebar.context.addFavorite': 'Add to Favorites',
  'sidebar.context.removeFavorite': 'Remove from Favorites',
  'sidebar.context.rename': 'Rename…',
  'sidebar.context.reveal': 'Reveal in Finder',
  'sidebar.context.trash': 'Move to Trash',

  'menu.favorite.add': 'Add to Favorites',
  'menu.favorite.remove': 'Remove from Favorites',
  'menu.rename': 'Rename…',
  'menu.reveal': 'Reveal in Finder',
  'menu.exportHtml': 'Export as HTML',
  'menu.print': 'Print…',
  'menu.trash': 'Move to Trash',
  'menu.noDocument': 'No document open',
  'menu.language': 'Language',
  'menu.lang.system': 'System',
  'menu.lang.zh': '简体中文',
  'menu.lang.en': 'English',

  'type.title': 'Writing Font',
  'type.fontSize': 'Font Size',
  'type.lineHeight': 'Line Height',
  'type.columnWidth': 'Column Width',
  'type.font.system': 'System',
  'type.font.serif': 'Serif',
  'type.font.mono': 'Monospace',

  'stats.words': 'Words',
  'stats.characters': 'Characters',
  'stats.paragraphs': 'Paragraphs',
  'stats.sentences': 'Sentences',
  'stats.readingTime': 'Reading time',

  'meta.today': 'Today',
  'meta.yesterday': 'Yesterday',

  'empty.start': 'Start writing.',
  'empty.firstThought': 'Write down your first thought…',

  'bootstrap.choose': 'Choose library location',
  'bootstrap.useDefault': 'Use default location',
  'bootstrap.defaultHint': 'Default ~/Documents/Ink',

  'conflict.message': 'was modified by another application.',
  'conflict.keepMine': 'Keep My Version',
  'conflict.loadDisk': 'Load Disk Version',
  'conflict.saveCopy': 'Save a Copy…',

  'quickOpen.placeholder': 'Search documents...',
  'quickOpen.empty': 'No matching documents',
  'quickOpen.contentGroup': 'In documents',

  'palette.placeholder': 'Type a command...',
  'palette.empty': 'No matching commands',
  'palette.group.file': 'File',
  'palette.group.edit': 'Edit',
  'palette.group.view': 'View',
  'palette.group.mode': 'Mode',
  'palette.group.type': 'Typography',
  'palette.group.doc': 'Document',

  'cmd.doc.new': 'New Document',
  'cmd.doc.open': 'Open Document…',
  'cmd.doc.save': 'Save',
  'cmd.editor.find': 'Find',
  'cmd.doc.quickOpen': 'Quick Open',
  'cmd.app.palette': 'Command Palette',
  'cmd.app.sidebar': 'Toggle Sidebar',
  'cmd.mode.focus': 'Focus Mode',
  'cmd.mode.typewriter': 'Typewriter Mode',
  'cmd.app.theme': 'Toggle Theme',
  'cmd.font.larger': 'Increase Font Size',
  'cmd.font.smaller': 'Decrease Font Size',
  'cmd.export.html': 'Export as HTML',
  'cmd.file.print': 'Print…',
  'cmd.doc.rename': 'Rename Document',
  'cmd.doc.reveal': 'Reveal in Finder',
  'cmd.doc.delete': 'Move Document to Trash',

  'toast.gbkNotice': 'Decoded as GBK; will be saved as UTF-8',
  'toast.watchFailed': 'Cannot watch the library',
  'toast.libraryMissing': 'Library not found',
  'toast.trashed': 'Document moved to Trash',
  'toast.externalDeleted': 'File was deleted externally',
  'toast.perfMode': 'Document over 10MB: performance mode on (syntax highlighting & Focus Mode off)',
  'toast.exportedHtml': 'HTML exported',
  'toast.createDirFailed': 'Cannot create directory',
  'toast.imageNoDoc': 'Open a document before inserting images',
  'save.saving': 'Saving…',
  'save.saved': 'Saved',

  'search.find': 'Find',
  'search.replace': 'Replace',
  'search.next': 'next',
  'search.previous': 'previous',
  'search.all': 'all',
  'search.replaceOne': 'replace',
  'search.replaceAll': 'replace all',
  'search.matchCase': 'match case',
  'search.regexp': 'regexp',
  'search.wholeWord': 'by word',
  'search.close': 'close',
}

const DICTS: Record<Locale, Record<string, string>> = { 'zh-CN': zh, en }

/** 解析偏好为实际 locale（安装时按系统语言首选） */
export function resolveLocale(preference: LocalePreference): Locale {
  if (preference !== 'system') return preference
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** 模块内当前 locale（非 React 代码的 t() 读这里） */
export const useLocaleStore = create<{ locale: Locale }>(() => ({
  locale: resolveLocale('system'),
}))

/** 偏好变化时同步（settingsStore 调用） */
export function syncLocale(preference: LocalePreference): void {
  const locale = resolveLocale(preference)
  useLocaleStore.setState({ locale })
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let text = DICTS[locale][key] ?? DICTS.en[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** 非 React 环境使用（store、命令注册表等） */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(useLocaleStore.getState().locale, key, vars)
}

/** React 组件使用：locale 变化时组件重渲染；函数身份按 locale 稳定（可安全进依赖数组） */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useLocaleStore((state) => state.locale)
  const translateFor = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  )
  return translateFor
}
