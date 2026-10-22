/**
 * 更多菜单（顶栏的 ⋯ 按钮）
 *
 * 文档级操作：收藏 / 重命名 / 在访达中显示 / 导出 / 打印 / 移入废纸篓。
 */
import { invoke } from '@tauri-apps/api/core'

import { useDocumentStore } from '@/stores/documentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildCommands } from '@/commands/registry'

export function MoreMenu({ onClose }: { onClose: () => void }) {
  const activeDocument = useDocumentStore((state) => state.activeDocument)
  const renameDocument = useDocumentStore((state) => state.renameDocument)
  const deleteDocument = useDocumentStore((state) => state.deleteDocument)
  const favorites = useSettingsStore((state) => state.settings.favorites)
  const updateSettings = useSettingsStore((state) => state.update)

  if (!activeDocument) {
    return (
      <div className="ink-popover ink-menu" role="menu">
        <div className="ink-menu-item" data-disabled="true">
          没有打开的文档
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
        {isFavorite ? '取消收藏' : '加入收藏'}
      </button>

      <div className="ink-menu-sep" />

      <button
        className="ink-menu-item"
        onClick={() => {
          const name = window.prompt('重命名文档', activeDocument.fileName.replace(/\.md$/i, ''))
          if (name) void renameDocument(activeDocument.path, name)
          onClose()
        }}
      >
        <span className="ink-icon ink-icon-file" aria-hidden />
        重命名…
      </button>

      <button
        className="ink-menu-item"
        onClick={() => {
          void invoke('reveal_in_finder', { path: activeDocument.path })
          onClose()
        }}
      >
        <span className="ink-icon ink-icon-folder" aria-hidden />
        在访达中显示
      </button>

      <div className="ink-menu-sep" />

      <button className="ink-menu-item" onClick={() => void runCommand('export.html')}>
        导出 HTML
      </button>
      <button className="ink-menu-item" onClick={() => void runCommand('file.print')}>
        打印…
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
        移入废纸篓
      </button>
    </div>
  )
}
