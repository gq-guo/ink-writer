/**
 * 保存指示（spec §12.1）
 *
 * - `saving` 仅在持续 >300ms 时才显示（防闪烁）
 * - `saved` 1.5s 后淡出（由 store 负责状态切换）
 */
import { useEffect, useState } from 'react'

import { useDocumentStore } from '@/stores/documentStore'

export function SaveIndicator() {
  const saveState = useDocumentStore((state) => state.saveState)
  const [label, setLabel] = useState('')

  useEffect(() => {
    let cancelled = false

    if (saveState === 'saving') {
      // 只有持续超过 300ms 才显示，避免每次保存都闪一下
      const timer = setTimeout(() => {
        if (!cancelled) setLabel('保存中…')
      }, 300)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }

    const timer = setTimeout(() => {
      if (!cancelled) setLabel(saveState === 'saved' ? '已保存' : '')
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [saveState])

  if (!label) return null

  return <div className="ink-save-indicator">{label}</div>
}
