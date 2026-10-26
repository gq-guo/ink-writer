/**
 * 右键菜单：App 里用 macOS 原生菜单，浏览器 / 测试里退回到页面内的菜单
 *
 * 原生菜单自带系统材质、键盘导航、贴着光标弹出且不会超出屏幕，
 * 比在网页里画一个「像菜单的浮层」更像一个 Mac 应用。
 * 两种菜单共用同一份条目定义，文案和动作只写一次。
 */
import { Menu } from '@tauri-apps/api/menu'

import { isTauriRuntime } from '@/lib/persist'

export type ContextMenuEntry =
  | {
      label: string
      action: () => void
      /** 危险操作（移到废纸篓）：页面内菜单标红；原生菜单按系统惯例不上色 */
      danger?: boolean
    }
  | 'separator'

/** 菜单关掉之后再释放：点选的动作回调要先执行完 */
const RELEASE_DELAY_MS = 1000

/**
 * 弹出原生右键菜单，返回 false 表示这里没有原生菜单（浏览器 / 测试 / 调用失败），由调用方退回页面内菜单。
 * 在光标处弹出；macOS 上菜单关掉之后 promise 才完成。
 */
export async function showNativeContextMenu(entries: ContextMenuEntry[]): Promise<boolean> {
  if (!isTauriRuntime()) return false
  let menu: Menu
  try {
    menu = await Menu.new({
      items: entries.map((entry) =>
        entry === 'separator' ? { item: 'Separator' as const } : { text: entry.label, action: entry.action },
      ),
    })
  } catch {
    return false
  }
  try {
    await menu.popup()
    return true
  } catch {
    return false
  } finally {
    setTimeout(() => void menu.close().catch(() => {}), RELEASE_DELAY_MS)
  }
}
