/**
 * 外部修改冲突对话框（spec W8 / §12.3）
 *
 * 模态，必须三选一；选择前阻塞自动保存写入。
 */
import { OverlayShell } from './OverlayShell'
import { useT } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'

export function ConflictDialog() {
  const t = useT()
  const conflict = useEditorStore((state) => state.conflict)
  const resolveConflict = useDocumentStore((state) => state.resolveConflict)

  if (!conflict) return null

  const fileName = conflict.path.split('/').pop() ?? conflict.path

  return (
    <OverlayShell onClose={() => undefined} variant="dialog" label="文件冲突">
      <div className="ink-dialog-title">
        “{fileName}” {t('conflict.message')}
      </div>
      <div className="ink-dialog-actions">
        <button
          className="ink-button"
          onClick={() => void resolveConflict('save-copy')}
        >
          {t('conflict.saveCopy')}
        </button>
        <button className="ink-button" onClick={() => void resolveConflict('load-disk')}>
          {t('conflict.loadDisk')}
        </button>
        <button
          className="ink-button"
          data-primary="true"
          onClick={() => void resolveConflict('keep-mine')}
        >
          {t('conflict.keepMine')}
        </button>
      </div>
    </OverlayShell>
  )
}
