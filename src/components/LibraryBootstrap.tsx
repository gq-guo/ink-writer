/**
 * 空库引导（spec W7）
 *
 * 仅首次启动显示；确认后立即创建 Untitled.md 并进入 W1。
 */
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { useSettingsStore } from '@/stores/settingsStore'
import { useT } from '@/lib/i18n'
import { errorMessage } from '@/lib/errors'
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


  /** 选库在 Rust 侧完成（目录选择框 / 默认位置），Rust 据此授权文件访问 */
  const choose = async (useDefault: boolean) => {
    try {
      const path = await invoke<string | null>('choose_library', { useDefault })
      if (path) setLibraryPath(path)
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  }

  return (
    <div className="ink-bootstrap">
      <div className="ink-bootstrap-title">Ink.</div>
      <div className="ink-bootstrap-sub">Your words stay on your Mac.</div>
      <div className="flex flex-col items-center gap-2">
        <button className="ink-button" data-primary="true" onClick={() => void choose(false)}>
          {t('bootstrap.choose')}
        </button>
        {defaultPath ? (
          <button className="ink-button" onClick={() => void choose(true)}>
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
