/**
 * 空库引导（spec W7）
 *
 * 仅首次启动显示；确认后立即创建 Untitled.md 并进入 W1。
 */
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

import { useSettingsStore } from '@/stores/settingsStore'
import { useT } from '@/lib/i18n'
import { useUiStore } from '@/stores/uiStore'

export function LibraryBootstrap() {
  const t = useT()
  const setLibraryPath = useSettingsStore((state) => state.setLibraryPath)
  const [defaultPath, setDefaultPath] = useState('')

  useEffect(() => {
    void invoke<string | null>('home_dir').then((home) => {
      setDefaultPath(home ? `${home}/Documents/Ink` : '')
    })
  }, [])


  const confirm = async (path: string) => {
    if (!path) return
    try {
      await invoke('ensure_directory', { path })
    } catch (error) {
      useUiStore.getState().pushToast({ message: `${t('toast.createDirFailed')}: ${String(error)}`, kind: 'error' })
      return
    }
    setLibraryPath(path)
  }

  const chooseDirectory = async () => {
    const selected = await openDialog({ directory: true, multiple: false })
    if (typeof selected === 'string') {
      confirm(selected)
    }
  }

  return (
    <div className="ink-bootstrap">
      <div className="ink-bootstrap-title">Ink.</div>
      <div className="ink-bootstrap-sub">Your words stay on your Mac.</div>
      <div className="flex flex-col items-center gap-2">
        <button className="ink-button" data-primary="true" onClick={() => void chooseDirectory()}>
          {t('bootstrap.choose')}
        </button>
        {defaultPath ? (
          <button className="ink-button" onClick={() => void confirm(defaultPath)}>
            {t('bootstrap.useDefault')} {defaultPath.replace(/^\/Users\/[^/]+/, '~')}
          </button>
        ) : null}
      </div>
      {defaultPath ? (
        <div className="mt-1 text-xs" style={{ color: 'var(--secondary)' }}>
          {t('bootstrap.defaultHint')}
        </div>
      ) : null}
    </div>
  )
}
