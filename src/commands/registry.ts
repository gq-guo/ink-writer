/**
 * 命令注册表（spec §11.3）
 *
 * Command Palette 的数据源；每条命令带 id / 标题 / 快捷键 / 执行动作。
 */
import { invoke } from '@tauri-apps/api/core'

import { buildStandaloneHtml } from '@/lib/export-html'
import { editorBridge } from '@/editor/bridge'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { newDocumentFolder, useUiStore } from '@/stores/uiStore'
import { t } from '@/lib/i18n'
import { errorMessage } from '@/lib/errors'

export type CommandGroup = 'file' | 'edit' | 'view' | 'mode' | 'type' | 'doc'

export const GROUP_ORDER: CommandGroup[] = ['file', 'edit', 'view', 'mode', 'type', 'doc']

export interface Command {
  id: string
  title: string
  shortcut?: string
  group: CommandGroup
  run: () => void | Promise<void>
  /** 返回 false 时在 Palette 中隐藏 */
  when?: () => boolean
  /** 只给快捷键 / 菜单栏用、不在 Palette 里列出（与 when 不同：不影响执行） */
  hideInPalette?: boolean
  /**
   * 改正文的编辑命令：从快捷键 / 菜单栏触发时，焦点在编辑器以外的输入框（顶栏改名、搜索框…）就不执行，
   * 按住快捷键也不连发
   */
  editorScoped?: boolean
}

export function buildCommands(): Command[] {
  return [
    {
      group: 'file',
      id: 'doc.new',
      title: t('cmd.doc.new'),
      shortcut: '⌘N',
      run: () => useDocumentStore.getState().createDocument(newDocumentFolder()),
    },
    {
      group: 'file',
      id: 'doc.open',
      title: t('cmd.doc.open'),
      shortcut: '⌘O',
      run: async () => {
        // 文件选择框由 Rust 弹出：Rust 只放行用户亲手选中的库外文件
        try {
          const selected = await invoke<string | null>('pick_document')
          if (selected) await useDocumentStore.getState().openDocument(selected)
        } catch (error) {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        }
      },
    },
    {
      group: 'file',
      id: 'doc.save',
      title: t('cmd.doc.save'),
      shortcut: '⌘S',
      run: () => useDocumentStore.getState().flushSave(),
    },
    {
      group: 'edit',
      id: 'editor.find',
      title: t('cmd.editor.find'),
      shortcut: '⌘F',
      run: () => editorBridge.openFind?.(),
    },
    {
      group: 'edit',
      id: 'editor.toggleTask',
      title: t('cmd.editor.toggleTask'),
      shortcut: '⌘L',
      run: () => editorBridge.toggleTask(),
      when: () => useDocumentStore.getState().activeDocument !== null,
      editorScoped: true,
    },
    {
      group: 'view',
      id: 'doc.quickOpen',
      title: t('cmd.doc.quickOpen'),
      shortcut: '⌘P',
      run: () => useUiStore.getState().showQuickOpen(),
    },
    {
      group: 'view',
      id: 'app.palette',
      title: t('cmd.app.palette'),
      shortcut: '⌘K',
      run: () => useUiStore.getState().showPalette(),
      // Palette 已经开着，再列「打开 Palette」没有意义；⌘K 与菜单栏仍走这条命令
      hideInPalette: true,
    },
    {
      group: 'view',
      id: 'app.settings',
      title: t('cmd.app.settings'),
      shortcut: '⌘,',
      run: () => useUiStore.getState().showSettings(),
    },
    {
      group: 'view',
      id: 'app.sidebar',
      title: t('cmd.app.sidebar'),
      shortcut: '⌥\\',
      run: () => useUiStore.getState().toggleSidebar(),
    },
    {
      group: 'mode',
      id: 'mode.focus',
      title: t('cmd.mode.focus'),
      shortcut: '⌘⇧F',
      run: () => useEditorStore.getState().toggleFocusMode(),
    },
    {
      group: 'mode',
      id: 'mode.typewriter',
      title: t('cmd.mode.typewriter'),
      shortcut: '⌘⇧T',
      run: () => {
        const settings = useSettingsStore.getState()
        settings.setTypewriterMode(!settings.settings.typewriterMode)
      },
    },
    {
      group: 'view',
      id: 'app.theme',
      title: t('cmd.app.theme'),
      shortcut: '⌘⇧D',
      run: () => useSettingsStore.getState().toggleTheme(),
    },
    {
      group: 'type',
      id: 'font.larger',
      title: t('cmd.font.larger'),
      shortcut: '⌘=',
      run: () => useSettingsStore.getState().increaseFontSize(),
    },
    {
      group: 'type',
      id: 'font.smaller',
      title: t('cmd.font.smaller'),
      shortcut: '⌘-',
      run: () => useSettingsStore.getState().decreaseFontSize(),
    },
    {
      group: 'file',
      id: 'export.html',
      title: t('cmd.export.html'),
      shortcut: '⌘⇧E',
      run: async () => {
        const state = useDocumentStore.getState()
        const active = state.activeDocument
        if (!active) return
        const html = buildStandaloneHtml(
          active.displayTitle,
          editorBridge.getContent() || active.content,
          useSettingsStore.getState().settings.fontFamily,
        )
        const docDir = active.path.slice(0, active.path.lastIndexOf('/'))
        try {
          // 保存对话框由 Rust 弹出：write_text_file 只能写到这里选定的目标
          const target = await invoke<string | null>('pick_export_target', {
            defaultName: `${active.fileName.replace(/\.md$/i, '')}.html`,
            defaultDir: docDir,
          })
          if (!target) return
          await invoke('write_text_file', { path: target, content: html })

          // 导出到其他目录时，把 assets 一并复制过去（图片相对路径才能解析）
          const targetDir = target.slice(0, target.lastIndexOf('/'))
          if (docDir !== targetDir) {
            await invoke('copy_assets', { fromDir: docDir, toDir: targetDir })
          }

          useUiStore.getState().pushToast({ message: t('toast.exportedHtml'), kind: 'success' })
        } catch (error) {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        }
      },
    },
    {
      group: 'file',
      id: 'file.print',
      title: t('cmd.file.print'),
      run: async () => {
        const state = useDocumentStore.getState()
        const active = state.activeDocument
        if (!active) return
        const html = buildStandaloneHtml(
          active.displayTitle,
          editorBridge.getContent() || active.content,
          useSettingsStore.getState().settings.fontFamily,
        )
        const root = document.createElement('div')
        root.className = 'ink-print-root'
        root.innerHTML = html
        document.body.appendChild(root)
        try {
          await invoke('print_current')
        } catch (error) {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        } finally {
          // 打印对话框关闭后再移除（macOS 上 print 是异步的，延迟移除更安全）
          setTimeout(() => root.remove(), 1000)
        }
      },
    },
    {
      group: 'doc',
      id: 'doc.rename',
      title: t('cmd.doc.rename'),
      run: () => {
        if (!useDocumentStore.getState().activeDocument) return
        // window.prompt 在 WKWebView 不可用 → 顶栏内联编辑
        useUiStore.getState().requestRename()
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      group: 'doc',
      id: 'doc.reveal',
      title: t('cmd.doc.reveal'),
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        try {
          await invoke('reveal_in_finder', { path: active.path })
        } catch (error) {
          useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
        }
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      group: 'doc',
      id: 'doc.delete',
      title: t('cmd.doc.delete'),
      run: async () => {
        const active = useDocumentStore.getState().activeDocument
        if (!active) return
        await useDocumentStore.getState().deleteDocument(active.path)
      },
      when: () => useDocumentStore.getState().activeDocument !== null,
    },
    {
      group: 'file',
      id: 'library.change',
      title: t('cmd.library.change'),
      run: () => useDocumentStore.getState().changeLibrary(),
    },
  ]
}
