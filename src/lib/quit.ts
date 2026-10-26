/**
 * 退出 / 关窗前先落盘（⌘Q、菜单「退出」、⌘W、红色关闭按钮）
 *
 * 系统自带的 Quit 菜单项直接走 NSApp terminate，进程立刻结束，
 * beforeunload 里发出去的异步保存来不及写完。所以退出改走这里：
 * 先 prepareToLeave（没存上会拦下并提示），再把 UI 快照写掉，最后退出。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'

import { isTauriRuntime, writePersisted } from '@/lib/persist'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'

let quitting = false

/** 落盘成功才返回 true；顺带把防抖中的 UI 快照（上次打开的文档等）写掉 */
async function saveBeforeExit(): Promise<boolean> {
  if (!(await useDocumentStore.getState().prepareToLeave())) return false
  try {
    await writePersisted('ui', useUiStore.getState().snapshot())
  } catch {
    /* UI 快照写不进去不值得拦住退出 */
  }
  return true
}

/** 菜单「退出 Ink」（⌘Q） */
export async function quitAfterSave(): Promise<void> {
  if (quitting) return
  quitting = true
  try {
    if (await saveBeforeExit()) await exit(0)
  } finally {
    quitting = false
  }
}

/** 关闭主窗口（⌘W / 红色按钮）同样先落盘；macOS 上关掉最后一个窗口即退出 */
export function installCloseGuard(): () => void {
  if (!isTauriRuntime()) return () => {}
  let unlisten: (() => void) | null = null
  let disposed = false
  void getCurrentWindow()
    .onCloseRequested(async (event) => {
      if (!(await saveBeforeExit())) event.preventDefault()
    })
    .then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
  return () => {
    disposed = true
    unlisten?.()
  }
}
