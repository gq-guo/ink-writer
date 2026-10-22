/**
 * 命令注册表（spec §11.3）
 *
 * Command Palette 的数据源；每条命令带 id / 标题 / 快捷键 / 执行动作。
 */
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { buildStandaloneHtml } from '@/lib/export-html'
import { editorBridge } from '@/editor/bridge'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

export interface Command {
  id: string
  title: string
  shortcut?: string
  run: () => void | Promise<void>
  /** 返回 false 时在 Palette 中隐藏 */
  when?: () => boolean
}

export function buildCommands(): Command[] {
  return [
    {
      id: 'doc.new',
      title: 'New Document',
      shortcut: '⌘N',
      run: () => useDocumentStore.getState().createDocument(),
    },
    {
      id: 'doc.open',
      title: 'Open Document…',
      shortcut: '⌘O',
      run: async () => {
        const selected = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
        })
        if (typeof selected === 'string') {
          await useDocumentStore.getState().openDocument(selected)
        }
      },
    },
    {
      id: 'doc.save',
      title: 'Save',
      shortcut: '⌘S',
      run: () => useDocumentStore.getState().flushSave(),
    },
    {
      id: 'doc.quickOpen',
      title: 'Quick Open',
      shortcut: '⌘P',
      run: () => useUiStore.getState().showQuickOpen(),
    },
    {
      id: 'app.palette',
      title: 'Command Palette',
      shortcut: '⌘K',
      run: () => useUiStore.getState().showPalette(),
    },
    {
      id: 'app.sidebar',
      title: 'Toggle Sidebar',
      shortcut: '⌥\\',
      run: () => useUiStore.getState().toggleSidebar(),
    },
    {
      id: 'mode.focus',
      title: 'Focus Mode',
      shortcut: '⌘⇧F',
      run: () => useEditorStore.getState().toggleFocusMode(),
    },
    {
      id: 'mode.typewriter',
      title: 'Typewriter Mode',
      shortcut: '⌘⇧T',
      run: () => {
        const settings = useSettingsStore.getState()
        settings.setTypewriterMode(!settings.settings.typewriterMode)
      },
    },
    {
      id: 'app.theme',
      title: 'Toggle Theme',
      shortcut: '⌘⇧D',
      run: () => useSettingsStore.getState().toggleTheme(),
    },
    {
      id: 'font.larger',
      title: 'Increase Font Size',
      shortcut: '⌘=',
      run: () => useSettingsStore.getState().increaseFontSize(),
    },
    {
      id: 'font.smaller',
      title: 'Decrease Font Size',
      shortcut: '⌘-',
      run: () => useSettingsStore.getState().decreaseFontSize(),
    },
    {
      id: 'font.family.system',
      title: 'Font: System',
      run: () => useSettingsStore.getState().update({ fontFamily: 'system' }),
    },
    {
      id: 'font.family.quattro',
      title: 'Font: iA Writer Quattro',
      run: () => useSettingsStore.getState().update({ fontFamily: 'quattro' }),
    },
    {
      id: 'font.family.plex',
      title: 'Font: IBM Plex Sans',
      run: () => useSettingsStore.getState().update({ fontFamily: 'plex' }),
    },
    {
      id: 'font.family.serif',
      title: 'Font: Source Serif',
      run: () => useSettingsStore.getState().update({ fontFamily: 'serif' }),
    },
    {
      id: 'font.family.mono',
      title: 'Font: JetBrains Mono',
      run: () => useSettingsStore.getState().update({ fontFamily: 'mono' }),
    },
    {
      id: 'font.lineHeight.increase',
      title: 'Increase Line Height',
      run: () => {
        const store = useSettingsStore.getState()
        store.update({ lineHeight: Math.min(2.0, Number((store.settings.lineHeight + 0.1).toFixed(2))) })
      },
    },
    {
      id: 'font.lineHeight.decrease',
      title: 'Decrease Line Height',
      run: () => {
        const store = useSettingsStore.getState()
        store.update({ lineHeight: Math.max(1.4, Number((store.settings.lineHeight - 0.1).toFixed(2))) })
      },
    },
    {
      id: 'editor.width.increase',
      title: 'Wider Text Column',
      run: () => {
        const store = useSettingsStore.getState()
        store.update({ contentWidth: Math.min(960, store.settings.contentWidth + 40) })
      },
    },
    {
      id: 'editor.width.decrease',
      title: 'Narrower Text Column',
      run: () => {
        const store = useSettingsStore.getState()
        store.update({ contentWidth: Math.max(560, store.settings.contentWidth - 40) })
      },
    },
    {
      id: 'export.html',
      title: 'Export as HTML',
      shortcut: '⌘⇧E',
      run: async () => {
        const state = useDocumentStore.getState()
        const active = state.activeDocument
        if (!active) return
        const html = buildStandaloneHtml(active.displayTitle, editorBridge.getContent() || active.content)
        const target = await saveDialog({
          defaultPath: `${active.fileName.replace(/\.md$/i, '')}.html`,
          filters: [{ name: 'HTML', extensions: ['html'] }],
        })
        if (!target) return
        try {
          await invoke('write_text_file', { path: target, content: html })

          // 导出到其他目录时，把 assets 一并复制过去（图片相对路径才能解析）
          const docDir = active.path.slice(0, active.path.lastIndexOf('/'))
          const targetDir = target.slice(0, target.lastIndexOf('/'))
          if (docDir !== targetDir) {
            await invoke('copy_assets', { fromDir: docDir, toDir: targetDir })
          }

          useUiStore.getState().pushToast({ message: '已导出 HTML', kind: 'success' })
        } catch (error) {
          useUiStore.getState().pushToast({ message: String(error), kind: 'error' })
        }
      },
    },
    {
      id: 'file.print',
      title: 'Print…',
      run: async () => {
        const state = useDocumentStore.getState()
        const active = state.activeDocument
        if (!active) return
        const html = buildStandaloneHtml(active.displayTitle, editorBridge.getContent() || active.content)
        const root = document.createElement('div')
        root.className = 'ink-print-root'
        root.innerHTML = html
        document.body.appendChild(root)
        try {
          await invoke('print_current')
        } catch (error) {
          useUiStore.getState().pushToast({ message: String(error), kind: 'error' })
        } finally {
          // 打印对话框关闭后再移除（macOS 上 print 是异步的，延迟移除更安全）
          setTimeout(() => root.remove(), 1000)
        }
      },
    },
    {
      id: 'doc.favorite',
      title: 'Add to Favorites',
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        const settings = useSettingsStore.getState()
        const isFavorite = settings.settings.favorites.includes(active.path)
        settings.update({
          favorites: isFavorite
            ? settings.settings.favorites.filter((path) => path !== active.path)
            : [...settings.settings.favorites, active.path],
        })
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      id: 'doc.rename',
      title: 'Rename Document',
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        const name = window.prompt('重命名文档', active.fileName.replace(/\.md$/i, ''))
        if (!name) return
        await useDocumentStore.getState().renameDocument(active.path, name)
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      id: 'doc.reveal',
      title: 'Reveal in Finder',
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        try {
          await invoke('reveal_in_finder', { path: active.path })
        } catch (error) {
          useUiStore.getState().pushToast({ message: String(error), kind: 'error' })
        }
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      id: 'doc.delete',
      title: 'Move Document to Trash',
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        await useDocumentStore.getState().deleteDocument(active.path)
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
  ]
}
