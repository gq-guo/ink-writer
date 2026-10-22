/**
 * 应用内更新（tauri-plugin-updater，参考 firebee）
 *
 * - 启动 3 秒后静默检查 releases/latest/download/latest.json
 * - 有新版本 → 弹系统对话框（WKWebView 没有 confirm）→ 下载安装 → 重启
 * - 任何失败都静默（不打扰写作）
 */

import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

import { useEditorStore } from '@/stores/editorStore'

export async function checkForUpdate(): Promise<void> {
  try {
    const update: Update | null = await check()
    if (!update) return
    useEditorStore.getState().setUpdateInfo({
      version: update.version,
      body: update.body?.slice(0, 500) ?? '',
    })
  } catch {
    /* 无网络 / 解析失败：静默 */
  }
}

/** 用户确认后：下载、安装、重启 */
export async function installUpdateAndRelaunch(): Promise<void> {
  try {
    const update = await check()
    if (!update) return
    await update.downloadAndInstall()
    await relaunch()
  } catch (error) {
    useEditorStore.getState().clearUpdateInfo()
    console.error('更新安装失败', error)
  }
}

/** 启动后延迟检查（不阻塞首屏） */
export function scheduleUpdateCheck(): void {
  setTimeout(() => {
    void checkForUpdate()
  }, 3000)
}
