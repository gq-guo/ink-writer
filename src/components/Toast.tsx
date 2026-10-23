/**
 * Toast（spec §4.1）：错误 / 保存失败提示，底部居中（避开右上角按钮），3s 自动消失
 */
import { useUiStore } from '@/stores/uiStore'

export function Toast() {
  const toasts = useUiStore((state) => state.toasts)
  const dismissToast = useUiStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="ink-toast-stack">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="ink-toast"
          data-kind={toast.kind}
          onClick={() => dismissToast(toast.id)}
          role="status"
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
