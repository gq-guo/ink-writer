/**
 * 更多菜单（顶栏的 ⋯ 按钮）
 *
 * 文档级操作：收藏 / 重命名 / 在访达中显示 / 导出 / 打印 / 移入废纸篓。
 */
import { invoke } from '@tauri-apps/api/core'

import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildCommands } from '@/commands/registry'
import { useT } from '@/lib/i18n'

export function MoreMenu({ onClose }: { onClose: () => void }) {
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const deleteDocument = useDocumentStore((state) => state.deleteDocument)
  const favorites = useSettingsStore((state) => state.settings.favorites)
  const updateSettings = useSettingsStore((state) => state.update)

  const t = useT()
  const locale = useSettingsStore((state) => state.settings.locale)

  const LANG_OPTIONS = [
    ['system', 'menu.lang.system'],
    ['zh-CN', 'menu.lang.zh'],
    ['en', 'menu.lang.en'],
  ] as const

  if (!activeDocument) {
    return (
      <div className="ink-popover ink-menu" role="menu">
        <div className="ink-menu-item" data-disabled="true">
          {t('menu.noDocument')}
        </div>
      </div>
    )
  }

  const isFavorite = favorites.includes(activeDocument.path)
  const commands = buildCommands()

  const runCommand = async (id: string) => {
    onClose()
    const command = commands.find((item) => item.id === id)
    if (command) await command.run()
  }

  const toggleFavorite = () => {
    updateSettings({
      favorites: isFavorite
        ? favorites.filter((path) => path !== activeDocument.path)
        : [...favorites, activeDocument.path],
    })
    onClose()
  }

  return (
    <div className="ink-popover ink-menu" role="menu">
      <button className="ink-menu-item" onClick={toggleFavorite}>
        <span className="ink-icon ink-icon-star" aria-hidden />
        {t(isFavorite ? 'menu.favorite.remove' : 'menu.favorite.add')}
      </button>

      <div className="ink-menu-sep" />

      <button
        className="ink-menu-item"
        onClick={() => {
          // window.prompt 在 WKWebView 不可用 → 顶栏内联编辑
          useUiStore.getState().requestRename()
          onClose()
        }}
      >
        <span className="ink-icon ink-icon-file" aria-hidden />
        {t('menu.rename')}
      </button>

      <button
        className="ink-menu-item"
        onClick={() => {
          void invoke('reveal_in_finder', { path: activeDocument.path })
          onClose()
        }}
      >
        <span className="ink-icon ink-icon-folder" aria-hidden />
        {t('menu.reveal')}
      </button>

      <div className="ink-menu-sep" />

      <button className="ink-menu-item" onClick={() => void runCommand('export.html')}>
        {t('menu.exportHtml')}
      </button>
      <button className="ink-menu-item" onClick={() => void runCommand('file.print')}>
        {t('menu.print')}
      </button>

      <div className="ink-menu-sep" />

      <button
        className="ink-menu-item"
        data-danger="true"
        onClick={() => {
          void deleteDocument(activeDocument.path)
          onClose()
        }}
      >
        {t('menu.trash')}
      </button>

      <div className="ink-menu-sep" />

      <div className="ink-menu-item" data-disabled="true">
        {t('menu.language')}
      </div>
      {LANG_OPTIONS.map(([value, labelKey]) => (
        <button
          key={value}
          className="ink-menu-item"
          data-checked={locale === value ? 'true' : undefined}
          onClick={() => updateSettings({ locale: value })}
        >
          <span
            className={`ink-icon ${
              locale === value ? 'ink-icon-check ink-lang-check' : 'ink-icon-circle'
            }`}
            aria-hidden
          />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}
