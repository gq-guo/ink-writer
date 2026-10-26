/**
 * 更新对话框：发现新版本时询问是否立即安装
 * （WKWebView 不支持 window.confirm，用自绘对话框）
 *
 * 下载期间显示进度、锁住按钮：GitHub 下载在国内可能要好几分钟，
 * 没有反馈用户会以为没点上，反复点击还会并发多路下载
 */
import { installUpdateAndRelaunch } from '@/lib/updater'
import { useEditorStore } from '@/stores/editorStore'
import { useT } from '@/lib/i18n'

export function UpdateDialog() {
  const t = useT()
  const updateInfo = useEditorStore((state) => state.updateInfo)
  const clearUpdateInfo = useEditorStore((state) => state.clearUpdateInfo)

  if (!updateInfo) return null

  const { status, progress } = updateInfo
  const busy = status === 'downloading' || status === 'installing'
  const percent = progress === null ? null : Math.round(progress * 100)

  let installLabel = t('update.install')
  if (status === 'downloading') {
    installLabel =
      percent === null
        ? t('update.downloading')
        : t('update.downloadingPercent', { percent })
  } else if (status === 'installing') {
    installLabel = t('update.installing')
  } else if (status === 'failed' || status === 'unsaved') {
    installLabel = t('update.retry')
  }

  return (
    <div className="ink-overlay-mask" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) clearUpdateInfo()
    }}>
      <div className="ink-dialog" role="dialog" aria-modal="true" aria-label="Update">
        <div className="ink-dialog-title">
          {t('update.title', { version: updateInfo.version })}
        </div>
        {updateInfo.body ? (
          <div className="ink-update-body">{updateInfo.body}</div>
        ) : null}
        {busy ? (
          <div
            className="ink-update-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            data-indeterminate={percent === null ? 'true' : undefined}
          >
            <div style={{ width: `${percent ?? 100}%` }} />
          </div>
        ) : null}
        {status === 'failed' || status === 'unsaved' ? (
          <div className="ink-update-error" role="alert">
            {t(status === 'failed' ? 'update.failed' : 'update.unsaved')}
          </div>
        ) : null}
        <div className="ink-dialog-actions">
          <button className="ink-button" onClick={clearUpdateInfo} disabled={busy}>
            {t('update.later')}
          </button>
          <button
            className="ink-button"
            data-primary="true"
            onClick={() => void installUpdateAndRelaunch()}
            disabled={busy}
            aria-busy={busy}
          >
            {installLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
