/**
 * 应用内更新（tauri-plugin-updater，参考 firebee）
 *
 * - 启动 3 秒后静默检查 releases/latest/download/latest.json
 * - 有新版本 → 自绘对话框询问 → 下载（显示进度）→ 安装 → 重启
 * - 检查失败静默（不打扰写作）；安装失败留在对话框里提示，可重试
 */

import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'

/** 检查得到的 Update 句柄：安装时直接复用，不再二次 check */
let pendingUpdate: Update | null = null
/** 正在下载 / 安装：重复点击直接忽略（否则每点一次就多开一路下载） */
let installing = false

export async function checkForUpdate(): Promise<void> {
  try {
    const update: Update | null = await check()
    if (!update) return
    pendingUpdate = update
    useEditorStore.getState().setUpdateInfo({
      version: update.version,
      body: update.body?.slice(0, 500) ?? '',
      status: 'idle',
      progress: null,
    })
  } catch {
    /* 无网络 / 解析失败：静默 */
  }
}

/** 用户确认后：下载、安装、重启 */
export async function installUpdateAndRelaunch(): Promise<void> {
  if (installing) return
  installing = true
  const editor = useEditorStore.getState()
  editor.patchUpdateInfo({ status: 'downloading', progress: null })
  try {
    const update = pendingUpdate ?? (await check())
    if (!update) {
      editor.clearUpdateInfo()
      return
    }
    pendingUpdate = update
    let total = 0
    let received = 0
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength
        if (total > 0) editor.patchUpdateInfo({ progress: Math.min(received / total, 1) })
      } else {
        editor.patchUpdateInfo({ status: 'installing', progress: 1 })
      }
    })
    // 重启会直接结束进程：先把防抖中的正文落盘
    await useDocumentStore.getState().flushSave()
    await relaunch()
  } catch (error) {
    console.error('更新安装失败', error)
    editor.patchUpdateInfo({ status: 'failed', progress: null })
  } finally {
    installing = false
  }
}

/** 启动后延迟检查（不阻塞首屏） */
export function scheduleUpdateCheck(): void {
  setTimeout(() => {
    void checkForUpdate()
  }, 3000)
}

export function resetUpdaterForTesting(): void {
  pendingUpdate = null
  installing = false
}
