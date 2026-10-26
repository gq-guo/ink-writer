/**
 * macOS 原生菜单栏
 *
 * 用 Tauri 的 menu API 在前端构建：文案走 i18n、动作走命令注册表，
 * 语言切换时整体重建。快捷键与 GlobalShortcuts 保持一致，
 * 同一次按键被 keydown 和菜单同时收到时由 dispatchCommand 去重。
 */
import { getName, getVersion } from '@tauri-apps/api/app'
import {
  CheckMenuItem,
  Menu,
  Submenu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
} from '@tauri-apps/api/menu'

import { dispatchCommand } from '@/commands/dispatch'
import { t, useLocaleStore } from '@/lib/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** 浏览器预览页 / 测试环境没有 Tauri 运行时 */
function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function command(id: string, text: string, accelerator?: string): MenuItemOptions {
  return { id, text, accelerator, action: () => void dispatchCommand(id, 'menu') }
}

function native(item: PredefinedMenuItemOptions['item'], text?: string): PredefinedMenuItemOptions {
  return { item, text }
}

const separator = (): PredefinedMenuItemOptions => ({ item: 'Separator' })

/**
 * 勾选型菜单项（Focus / Typewriter）：点击时 macOS 会先自行翻转勾选，
 * 命令被去重或不可用时状态就和 store 对不上，所以每次都按 store 回写。
 */
async function toggleItem(
  id: string,
  text: string,
  accelerator: string,
  read: () => boolean,
): Promise<CheckMenuItem> {
  const item: CheckMenuItem = await CheckMenuItem.new({
    id,
    text,
    accelerator,
    checked: read(),
    action: () => {
      dispatchCommand(id, 'menu')
      void item.setChecked(read())
    },
  })
  return item
}

let disposeCurrent: (() => void) | null = null

async function buildAndInstall(): Promise<void> {
  const [name, version] = await Promise.all([getName(), getVersion()])

  const readFocus = () => useEditorStore.getState().focusMode
  const readTypewriter = () => useSettingsStore.getState().settings.typewriterMode
  const focusItem = await toggleItem('mode.focus', t('mb.focus'), 'CmdOrCtrl+Shift+F', readFocus)
  const typewriterItem = await toggleItem(
    'mode.typewriter',
    t('mb.typewriter'),
    'CmdOrCtrl+Shift+T',
    readTypewriter,
  )

  const appMenu = await Submenu.new({
    text: name,
    items: [
      native({ About: { name, version } }, t('mb.about', { name })),
      separator(),
      command('app.settings', t('mb.settings'), 'CmdOrCtrl+Comma'),
      separator(),
      native('Services', t('mb.services')),
      separator(),
      native('Hide', t('mb.hide', { name })),
      native('HideOthers', t('mb.hideOthers')),
      native('ShowAll', t('mb.showAll')),
      separator(),
      native('Quit', t('mb.quit', { name })),
    ],
  })

  const fileMenu = await Submenu.new({
    text: t('mb.file'),
    items: [
      command('doc.new', t('mb.new'), 'CmdOrCtrl+N'),
      command('doc.open', t('mb.open'), 'CmdOrCtrl+O'),
      command('doc.quickOpen', t('mb.quickOpen'), 'CmdOrCtrl+P'),
      separator(),
      command('doc.save', t('mb.save'), 'CmdOrCtrl+S'),
      command('doc.rename', t('mb.rename')),
      separator(),
      command('export.html', t('mb.exportHtml'), 'CmdOrCtrl+Shift+E'),
      command('file.print', t('mb.print')),
      separator(),
      command('doc.reveal', t('mb.reveal')),
      command('doc.delete', t('mb.trash')),
      separator(),
      command('library.change', t('mb.changeLibrary')),
      separator(),
      native('CloseWindow', t('mb.closeWindow')),
    ],
  })

  const editMenu = await Submenu.new({
    text: t('mb.edit'),
    items: [
      native('Undo', t('mb.undo')),
      native('Redo', t('mb.redo')),
      separator(),
      native('Cut', t('mb.cut')),
      native('Copy', t('mb.copy')),
      native('Paste', t('mb.paste')),
      native('SelectAll', t('mb.selectAll')),
      separator(),
      command('editor.find', t('mb.find'), 'CmdOrCtrl+F'),
      // 不挂快捷键：菜单的快捷键按住会连发、焦点在改名框里也会触发，⌘L 只走 GlobalShortcuts
      command('editor.toggleTask', t('mb.toggleTask')),
    ],
  })

  const viewMenu = await Submenu.new({
    text: t('mb.view'),
    items: [
      command('app.sidebar', t('mb.sidebar'), 'Alt+Backslash'),
      command('app.palette', t('mb.palette'), 'CmdOrCtrl+K'),
      separator(),
      focusItem,
      typewriterItem,
      separator(),
      command('app.theme', t('mb.theme'), 'CmdOrCtrl+Shift+D'),
      command('font.larger', t('mb.fontLarger'), 'CmdOrCtrl+Equal'),
      command('font.smaller', t('mb.fontSmaller'), 'CmdOrCtrl+Minus'),
      separator(),
      native('Fullscreen', t('mb.fullscreen')),
    ],
  })

  const windowMenu = await Submenu.new({
    text: t('mb.window'),
    items: [
      native('Minimize', t('mb.minimize')),
      native('Maximize', t('mb.zoom')),
      separator(),
      native('BringAllToFront', t('mb.bringAllToFront')),
    ],
  })

  const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, viewMenu, windowMenu] })
  const previous = await menu.setAsAppMenu()
  await windowMenu.setAsWindowsMenuForNSApp()

  // 快捷键 / 顶栏胶囊也会切换模式，勾选状态跟着 store 走
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.focusMode !== prev.focusMode) void focusItem.setChecked(state.focusMode)
  })
  const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
    if (state.settings.typewriterMode !== prev.settings.typewriterMode) {
      void typewriterItem.setChecked(state.settings.typewriterMode)
    }
  })

  disposeCurrent?.()
  disposeCurrent = () => {
    unsubscribeEditor()
    unsubscribeSettings()
  }
  await previous?.close()
}

/** 安装菜单栏，并在语言切换时重建；返回卸载函数 */
export function installAppMenu(): () => void {
  if (!hasTauriRuntime()) return () => {}

  // 串行重建：连续切换语言时不让两次构建交错 setAsAppMenu
  let pending: Promise<void> = Promise.resolve()
  const rebuild = () => {
    pending = pending.then(buildAndInstall).catch((error: unknown) => {
      console.error('菜单栏构建失败', error)
    })
  }

  rebuild()
  const unsubscribeLocale = useLocaleStore.subscribe((state, prev) => {
    if (state.locale !== prev.locale) rebuild()
  })
  return () => {
    unsubscribeLocale()
  }
}
