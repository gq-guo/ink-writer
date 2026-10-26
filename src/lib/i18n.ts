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
  'common.wordsUnit': '字',
  'common.minReadUnit': '分钟读完',

  // ── 顶栏 ──
  'topbar.rename': '重命名',
  'topbar.search': '搜索文档（⌘P）',
  'topbar.typography': '排版',
  'topbar.more': '更多',
  'topbar.typewriter': '打字机模式',
  'topbar.hideSidebar': '隐藏侧边栏',
  'topbar.showSidebar': '显示侧边栏',

  // ── 侧边栏 ──
  'sidebar.all': '全部',
  'sidebar.documents': '文档',
  'sidebar.recent': '最近',
  'sidebar.favorites': '收藏',
  'sidebar.newDocument': '新建文档',
  'sidebar.empty.library': '文档库还是空的',
  'sidebar.empty.favorites': '还没有收藏',
  'sidebar.group.today': '今天',
  'sidebar.group.yesterday': '昨天',
  'sidebar.group.thisWeek': '最近 7 天',
  'sidebar.group.earlier': '更早',
  'sidebar.collapse': '折叠侧边栏',
  'sidebar.context.addFavorite': '加入收藏',
  'sidebar.context.removeFavorite': '取消收藏',
  'sidebar.context.rename': '重命名…',
  'sidebar.context.reveal': '在访达中显示',
  'sidebar.context.trash': '移到废纸篓',

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
  'type.font.quattro': 'iA Writer Quattro',
  'type.font.system': '系统字体',
  'type.font.serif': '衬线体',
  'type.font.noto': 'Noto 宋体',
  'type.font.wenkai': '霞鹜文楷',
  'type.font.mono': '等宽字体',

  // ── 状态栏 / 统计卡 ──
  'stats.words': '字数',
  'stats.characters': '字符数',
  'stats.paragraphs': '段落数',
  'stats.sentences': '句子数',
  'stats.readingTime': '阅读时长',

  // ── 主区头部时间 ──
  'meta.today': '今天',
  'meta.yesterday': '昨天',

  // ── 空文档引导 ──

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
  'quickOpen.placeholder': '搜索文档',
  'quickOpen.empty': '没有匹配的文档',
  'quickOpen.contentGroup': '正文中',

  // ── 命令面板 ──
  'palette.placeholder': '搜索命令',
  'palette.empty': '没有匹配的命令',
  'palette.group.file': '文件',
  'palette.group.edit': '编辑',
  'palette.group.view': '视图',
  'palette.group.mode': '模式',
  'palette.group.type': '排版',
  'palette.group.doc': '文档',

  // ── 命令标题 ──
  'cmd.doc.new': '新建文档',
  'cmd.doc.open': '打开文档…',
  'cmd.doc.save': '保存',
  'cmd.editor.find': '查找',
  'cmd.doc.quickOpen': '快速打开',
  'cmd.app.palette': '命令面板',
  'cmd.app.sidebar': '显示 / 隐藏侧边栏',
  'cmd.mode.focus': '专注模式',
  'cmd.mode.typewriter': '打字机模式',
  'cmd.app.theme': '切换深浅色',
  'cmd.font.larger': '放大字号',
  'cmd.font.smaller': '缩小字号',
  'cmd.export.html': '导出 HTML',
  'cmd.file.print': '打印…',
  'cmd.doc.rename': '重命名文档',
  'cmd.doc.reveal': '在访达中显示',
  'cmd.doc.delete': '将文档移到废纸篓',
  'cmd.app.settings': '设置…',

  // ── 原生菜单栏 ──
  'mb.about': '关于 {name}',
  'mb.settings': '设置…',
  'mb.services': '服务',
  'mb.hide': '隐藏 {name}',
  'mb.hideOthers': '隐藏其他',
  'mb.showAll': '全部显示',
  'mb.quit': '退出 {name}',
  'mb.file': '文件',
  'mb.new': '新建文档',
  'mb.open': '打开…',
  'mb.quickOpen': '快速打开…',
  'mb.save': '保存',
  'mb.rename': '重命名…',
  'mb.exportHtml': '导出 HTML…',
  'mb.print': '打印…',
  'mb.reveal': '在访达中显示',
  'mb.trash': '移到废纸篓',
  'mb.changeLibrary': '更换文档库位置…',
  'mb.closeWindow': '关闭窗口',
  'mb.edit': '编辑',
  'mb.undo': '撤销',
  'mb.redo': '重做',
  'mb.cut': '剪切',
  'mb.copy': '拷贝',
  'mb.paste': '粘贴',
  'mb.selectAll': '全选',
  'mb.find': '查找…',
  'mb.view': '显示',
  'mb.sidebar': '显示 / 隐藏侧边栏',
  'mb.palette': '命令面板…',
  'mb.focus': '专注模式',
  'mb.typewriter': '打字机模式',
  'mb.theme': '切换深浅色',
  'mb.fontLarger': '放大字号',
  'mb.fontSmaller': '缩小字号',
  'mb.fullscreen': '进入全屏幕',
  'mb.window': '窗口',
  'mb.minimize': '最小化',
  'mb.zoom': '缩放',
  'mb.bringAllToFront': '前置全部窗口',

  // ── 设置面板 ──
  'settings.title': '设置',
  'settings.appearance': '外观',
  'settings.theme': '主题',
  'settings.theme.system': '跟随系统',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.writing': '写作',
  'settings.spellcheck': '输入时检查拼写',
  'settings.typewriter': '打字机模式',
  'settings.showMarkup': '显示 Markdown 标记',
  'settings.showMarkupHint': '关闭时，光标不在的行会隐藏 # ** ` 等标记，光标所在行照常显示源码',
  'settings.typographyHint': '字体、字号和栏宽在顶栏的 Aa 里调整',
  'settings.library': '文档库',
  'settings.libraryReveal': '在访达中显示',
  'settings.libraryChange': '更换位置…',
  'settings.done': '完成',

  // ── store / 命令里的 Toast ──
  'toast.gbkNotice': '已按 GBK 解码，保存时将转为 UTF-8',
  'toast.watchFailed': '无法监听文档库',
  'toast.libraryMissing': '找不到文档库',
  'toast.trashed': '文档已移入废纸篓',
  'toast.deleteUnsaved': '当前文档有修改没能保存，已取消移入废纸篓',
  'toast.externalDeleted': '文件已在外部删除',
  'toast.perfMode': '文档超过 10MB，已进入性能模式（关闭语法高亮与专注模式）',
  'toast.exportedHtml': '已导出 HTML',
  'toast.savedCopy': '已另存副本：{name}',
  'toast.renamedDeduped': '{requested} 已存在，已重命名为 {name}',
  'toast.createDirFailed': '无法创建目录',
  'toast.imageNoDoc': '请先打开一个文档再插入图片',
  'toast.libraryMoved': '已复制 {count} 篇文档到新位置（同名文件已跳过，旧库未删除）',
  'menu.changeLibrary': '更换文档库位置…',
  'cmd.library.change': '更换文档库位置…',
  'update.title': '发现新版本 {version}',
  'update.later': '稍后',
  'update.install': '立即安装并重启',
  'update.downloading': '正在下载…',
  'update.downloadingPercent': '正在下载… {percent}%',
  'update.installing': '正在安装…',
  'update.failed': '更新失败。可以重试，或到 GitHub Releases 手动下载',
  'update.retry': '重试',
  'update.unsaved': '新版本已装好，但当前文档还没保存成功。先处理保存问题，再点重试',
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

  // ── 错误（Rust CommandError 的错误码，见 src/lib/errors.ts）──
  'error.unknown': '未知错误',
  'error.permissionDenied': '权限被拒绝：{detail}',
  'error.notFound': '文件不存在：{detail}',
  'error.storageFull': '磁盘空间不足，保存失败：{detail}',
  'error.ioFailed': '操作失败：{detail}',
  'error.accessDenied': '无权访问该路径：{detail}',
  'error.invalidPath': '无效的文件路径：{detail}',
  'error.invalidFileName': '无效的文件名：{detail}',
  'error.tooManyDuplicates': '同名文件过多：{detail}',
  'error.createFailed': '创建文档失败：{detail}',
  'error.trashFailed': '移入废纸篓失败：{detail}',
  'error.unknownEncoding': '无法识别文件编码：{detail}',
  'error.settingsIo': '无法读写应用设置：{detail}',
  'error.documentsDirMissing': '找不到文稿目录：{detail}',
  'error.createDirFailed': '无法创建目录：{detail}',
  'error.dialogFailed': '无法打开对话框：{detail}',
  'error.unsupportedSetting': '不支持的设置项：{detail}',
  'error.revealFailed': '无法在访达中显示：{detail}',
  'error.unsupportedUrl': '仅支持打开 http/https/mailto 链接：{detail}',
  'error.openUrlFailed': '无法打开链接：{detail}',
  'error.printFailed': '无法打印：{detail}',
  'error.watchFailed': '无法监听文档库：{detail}',
  'toast.startupFailed': '启动失败：{error}',
  'toast.watchError': '文件监听异常：{error}',

  // ── 相对时间 ──
  'time.justNow': '刚刚',
  'time.minutesAgo': '{n} 分钟前',
  'time.hoursAgo': '{n} 小时前',
  'time.yesterday': '昨天',
  'time.daysAgo': '{n} 天前',

  // ── 查找面板按钮提示 ──
  'searchTip.prev': '上一个匹配',
  'searchTip.next': '下一个匹配',
  'searchTip.select': '选中全部匹配',
  'searchTip.replace': '替换',
  'searchTip.replaceAll': '全部替换',
  'searchTip.close': '关闭',
  'searchTip.case': '区分大小写',
  'searchTip.re': '正则表达式',
  'searchTip.word': '全字匹配',
  'conflict.label': '文件冲突',
  'outline.label': '目录',
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
  'topbar.typewriter': 'Typewriter',
  'topbar.hideSidebar': 'Hide Sidebar',
  'topbar.showSidebar': 'Show Sidebar',

  'sidebar.all': 'All',
  'sidebar.documents': 'Documents',
  'sidebar.recent': 'Recent',
  'sidebar.favorites': 'Favorites',
  'sidebar.newDocument': 'New Document',
  'sidebar.empty.library': 'Your library is empty',
  'sidebar.empty.favorites': 'No favorites yet',
  'sidebar.group.today': 'Today',
  'sidebar.group.yesterday': 'Yesterday',
  'sidebar.group.thisWeek': 'Last 7 days',
  'sidebar.group.earlier': 'Earlier',
  'sidebar.collapse': 'Collapse Sidebar',
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
  'type.font.quattro': 'iA Writer Quattro',
  'type.font.system': 'System',
  'type.font.serif': 'Serif',
  'type.font.noto': 'Noto Serif',
  'type.font.wenkai': 'LXGW WenKai',
  'type.font.mono': 'Monospace',

  'stats.words': 'Words',
  'stats.characters': 'Characters',
  'stats.paragraphs': 'Paragraphs',
  'stats.sentences': 'Sentences',
  'stats.readingTime': 'Reading time',

  'meta.today': 'Today',
  'meta.yesterday': 'Yesterday',


  'bootstrap.choose': 'Choose library location',
  'bootstrap.useDefault': 'Use default location',
  'bootstrap.defaultHint': 'Default ~/Documents/Ink',

  'conflict.message': 'was modified by another application.',
  'conflict.keepMine': 'Keep My Version',
  'conflict.loadDisk': 'Load Disk Version',
  'conflict.saveCopy': 'Save a Copy…',

  'quickOpen.placeholder': 'Search documents',
  'quickOpen.empty': 'No matching documents',
  'quickOpen.contentGroup': 'In documents',

  'palette.placeholder': 'Search commands',
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
  'cmd.app.settings': 'Settings…',

  // ── Native menu bar ──
  'mb.about': 'About {name}',
  'mb.settings': 'Settings…',
  'mb.services': 'Services',
  'mb.hide': 'Hide {name}',
  'mb.hideOthers': 'Hide Others',
  'mb.showAll': 'Show All',
  'mb.quit': 'Quit {name}',
  'mb.file': 'File',
  'mb.new': 'New Document',
  'mb.open': 'Open…',
  'mb.quickOpen': 'Quick Open…',
  'mb.save': 'Save',
  'mb.rename': 'Rename…',
  'mb.exportHtml': 'Export as HTML…',
  'mb.print': 'Print…',
  'mb.reveal': 'Show in Finder',
  'mb.trash': 'Move to Trash',
  'mb.changeLibrary': 'Change Library Location…',
  'mb.closeWindow': 'Close Window',
  'mb.edit': 'Edit',
  'mb.undo': 'Undo',
  'mb.redo': 'Redo',
  'mb.cut': 'Cut',
  'mb.copy': 'Copy',
  'mb.paste': 'Paste',
  'mb.selectAll': 'Select All',
  'mb.find': 'Find…',
  'mb.view': 'View',
  'mb.sidebar': 'Show / Hide Sidebar',
  'mb.palette': 'Command Palette…',
  'mb.focus': 'Focus Mode',
  'mb.typewriter': 'Typewriter Mode',
  'mb.theme': 'Toggle Light / Dark',
  'mb.fontLarger': 'Increase Font Size',
  'mb.fontSmaller': 'Decrease Font Size',
  'mb.fullscreen': 'Enter Full Screen',
  'mb.window': 'Window',
  'mb.minimize': 'Minimize',
  'mb.zoom': 'Zoom',
  'mb.bringAllToFront': 'Bring All to Front',

  // ── Settings panel ──
  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.writing': 'Writing',
  'settings.spellcheck': 'Check spelling while typing',
  'settings.typewriter': 'Typewriter Mode',
  'settings.showMarkup': 'Show Markdown syntax',
  'settings.showMarkupHint': 'When off, # ** ` and similar marks are hidden except on the line you are editing',
  'settings.typographyHint': 'Font, size and column width are under Aa in the toolbar',
  'settings.library': 'Library',
  'settings.libraryReveal': 'Show in Finder',
  'settings.libraryChange': 'Change Location…',
  'settings.done': 'Done',

  'toast.gbkNotice': 'Decoded as GBK; will be saved as UTF-8',
  'toast.watchFailed': 'Cannot watch the library',
  'toast.libraryMissing': 'Library not found',
  'toast.trashed': 'Document moved to Trash',
  'toast.deleteUnsaved': 'Unsaved changes could not be written; the document was not moved to Trash',
  'toast.externalDeleted': 'File was deleted externally',
  'toast.perfMode': 'Document over 10MB: performance mode on (syntax highlighting & Focus Mode off)',
  'toast.exportedHtml': 'HTML exported',
  'toast.savedCopy': 'Saved a copy: {name}',
  'toast.renamedDeduped': '{requested} already exists; renamed to {name}',
  'toast.createDirFailed': 'Cannot create directory',
  'toast.imageNoDoc': 'Open a document before inserting images',
  'toast.libraryMoved': 'Copied {count} documents to the new location (same-name files skipped, old library kept)',
  'menu.changeLibrary': 'Change Library Location…',
  'cmd.library.change': 'Change Library Location…',
  'update.title': 'New version {version} is available',
  'update.later': 'Later',
  'update.install': 'Install & Restart',
  'update.downloading': 'Downloading…',
  'update.downloadingPercent': 'Downloading… {percent}%',
  'update.installing': 'Installing…',
  'update.failed': 'Update failed. Try again, or download it from GitHub Releases.',
  'update.retry': 'Retry',
  'update.unsaved': 'The update is installed, but the current document isn\'t saved yet. Fix the save problem, then retry.',
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

  // ── Errors ──
  'error.unknown': 'Unknown error',
  'error.permissionDenied': 'Permission denied: {detail}',
  'error.notFound': 'File not found: {detail}',
  'error.storageFull': 'Disk is full; could not save: {detail}',
  'error.ioFailed': 'Operation failed: {detail}',
  'error.accessDenied': 'Access to this path is not allowed: {detail}',
  'error.invalidPath': 'Invalid file path: {detail}',
  'error.invalidFileName': 'Invalid file name: {detail}',
  'error.tooManyDuplicates': 'Too many files with the same name: {detail}',
  'error.createFailed': 'Could not create the document: {detail}',
  'error.trashFailed': 'Could not move to Trash: {detail}',
  'error.unknownEncoding': 'Unrecognized file encoding: {detail}',
  'error.settingsIo': 'Could not read or write app settings: {detail}',
  'error.documentsDirMissing': 'Documents folder not found: {detail}',
  'error.createDirFailed': 'Could not create folder: {detail}',
  'error.dialogFailed': 'Could not open the dialog: {detail}',
  'error.unsupportedSetting': 'Unsupported setting: {detail}',
  'error.revealFailed': 'Could not reveal in Finder: {detail}',
  'error.unsupportedUrl': 'Only http/https/mailto links can be opened: {detail}',
  'error.openUrlFailed': 'Could not open the link: {detail}',
  'error.printFailed': 'Could not print: {detail}',
  'error.watchFailed': 'Cannot watch the library: {detail}',
  'toast.startupFailed': 'Startup failed: {error}',
  'toast.watchError': 'File watching error: {error}',

  // ── Relative time ──
  'time.justNow': 'just now',
  'time.minutesAgo': '{n} min ago',
  'time.hoursAgo': '{n} hr ago',
  'time.yesterday': 'yesterday',
  'time.daysAgo': '{n} days ago',

  // ── Find panel tooltips ──
  'searchTip.prev': 'Previous match',
  'searchTip.next': 'Next match',
  'searchTip.select': 'Select all matches',
  'searchTip.replace': 'Replace',
  'searchTip.replaceAll': 'Replace all',
  'searchTip.close': 'Close',
  'searchTip.case': 'Match case',
  'searchTip.re': 'Regular expression',
  'searchTip.word': 'Whole word',
  'conflict.label': 'File conflict',
  'outline.label': 'Outline',
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
