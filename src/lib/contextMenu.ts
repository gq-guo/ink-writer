/**
 * 右键菜单：App 里用 macOS 原生菜单，浏览器 / 测试里退回到页面内的菜单
 *
 * 原生菜单自带系统材质、键盘导航、贴着光标弹出且不会超出屏幕，
 * 比在网页里画一个「像菜单的浮层」更像一个 Mac 应用。
 * 两种菜单共用同一份条目定义，文案和动作只写一次。
 *
 * ⚠️ 原生菜单开着的时候，绝不能再发任何会碰 webview 资源表的调用（比如 menu.close()）：
 * Tauri 2.12 的 popup 命令拿着资源表的锁一直等到菜单关掉，而菜单的事件循环里
 * 照样会处理页面发来的 IPC —— 这时 close 去抢同一把锁，菜单永远关不掉，整个 App 卡死。
 * 所以不用定时器释放菜单，而是在下一次右键、新菜单创建之前释放上一个（那时肯定没有菜单开着）。
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

/** 上一次弹出的原生菜单：等到下一次右键时再释放（见文件头的说明） */
let previousMenu: Menu | null = null
/** 菜单正开着：这期间不再弹第二个，也不碰资源表 */
let menuOpen = false

/**
 * 弹出原生右键菜单，返回 false 表示这里没有原生菜单（浏览器 / 测试 / 调用失败），由调用方退回页面内菜单。
 * 在光标处弹出；macOS 上菜单关掉之后 promise 才完成。
 */
export async function showNativeContextMenu(entries: ContextMenuEntry[]): Promise<boolean> {
  if (!isTauriRuntime()) return false
  if (menuOpen) return true
  menuOpen = true
  try {
    if (previousMenu) {
      const stale = previousMenu
      previousMenu = null
      await stale.close().catch(() => {})
    }
    const menu = await Menu.new({
      items: entries.map((entry) =>
        entry === 'separator' ? { item: 'Separator' as const } : { text: entry.label, action: entry.action },
      ),
    })
    previousMenu = menu
    await menu.popup()
    return true
  } catch {
    return false
  } finally {
    menuOpen = false
  }
}

/** 测试用：清掉模块里记着的菜单 */
export function resetContextMenuForTesting(): void {
  previousMenu = null
  menuOpen = false
}
