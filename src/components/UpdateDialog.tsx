/**
 * 更新对话框：发现新版本时询问是否立即安装
 * （WKWebView 不支持 window.confirm，用自绘对话框）
 */
import { installUpdateAndRelaunch } from '@/lib/updater'
import { useEditorStore } from '@/stores/editorStore'
import { useT } from '@/lib/i18n'

export function UpdateDialog() {
  const t = useT()
  const updateInfo = useEditorStore((state) => state.updateInfo)
  const clearUpdateInfo = useEditorStore((state) => state.clearUpdateInfo)

  if (!updateInfo) return null

  return (
    <div className="ink-overlay-mask" onMouseDown={(event) => {
      if (event.target === event.currentTarget) clearUpdateInfo()
    }}>
      <div className="ink-dialog" role="dialog" aria-modal="true" aria-label="Update">
        <div className="ink-dialog-title">
          {t('update.title', { version: updateInfo.version })}
        </div>
        {updateInfo.body ? (
          <div className="ink-update-body">{updateInfo.body}</div>
        ) : null}
        <div className="ink-dialog-actions">
          <button className="ink-button" onClick={clearUpdateInfo}>
            {t('update.later')}
          </button>
          <button
            className="ink-button"
            data-primary="true"
            onClick={() => void installUpdateAndRelaunch()}
          >
            {t('update.install')}
          </button>
        </div>
      </div>
    </div>
  )
}
