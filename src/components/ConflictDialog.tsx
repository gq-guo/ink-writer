/**
 * 外部修改冲突对话框（spec W8 / §12.3）
 *
 * 模态，必须三选一；选择前阻塞自动保存写入。
 */
import { OverlayShell } from './OverlayShell'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'

export function ConflictDialog() {
  const conflict = useEditorStore((state) => state.conflict)
  const resolveConflict = useDocumentStore((state) => state.resolveConflict)

  if (!conflict) return null

  const fileName = conflict.path.split('/').pop() ?? conflict.path

  return (
    <OverlayShell onClose={() => undefined} variant="dialog" label="文件冲突">
      <div className="ink-dialog-title">
        “{fileName}” 已被其他应用修改。
      </div>
      <div className="ink-dialog-actions">
        <button
          className="ink-button"
          onClick={() => void resolveConflict('save-copy')}
        >
          另存副本…
        </button>
        <button className="ink-button" onClick={() => void resolveConflict('load-disk')}>
          加载磁盘版本
        </button>
        <button
          className="ink-button"
          data-primary="true"
          onClick={() => void resolveConflict('keep-mine')}
        >
          保留我的版本
        </button>
      </div>
    </OverlayShell>
  )
}
