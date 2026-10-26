import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { menuNewMock } = vi.hoisted(() => ({ menuNewMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: menuNewMock } }))

import { resetContextMenuForTesting, showNativeContextMenu } from '@/lib/contextMenu'

/** 一个可以手动关掉的假菜单：popup() 一直挂着，直到调用 dismiss() */
function fakeMenu(log: string[], name: string) {
  let dismiss: () => void = () => {}
  const menu = {
    popup: vi.fn(() => {
      log.push(`${name}:open`)
      return new Promise<void>((resolve) => {
        dismiss = () => {
          log.push(`${name}:dismissed`)
          resolve()
        }
      })
    }),
    close: vi.fn(async () => {
      log.push(`${name}:close`)
    }),
    dismiss: () => dismiss(),
  }
  return menu
}

describe('原生右键菜单的释放时机（防止 Tauri popup 持锁导致的死锁）', () => {
  beforeEach(() => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    resetContextMenuForTesting()
    menuNewMock.mockReset()
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    vi.useRealTimers()
  })

  it('菜单开着时不会调用 close（等再久也不会），上一个菜单在下一次右键、新菜单创建前才释放', async () => {
    vi.useFakeTimers()
    const log: string[] = []
    const first = fakeMenu(log, 'first')
    const second = fakeMenu(log, 'second')
    menuNewMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const entries = [{ label: '打开', action: () => {} }]

    const firstShown = showNativeContextMenu(entries)
    await vi.advanceTimersByTimeAsync(0)
    first.dismiss()
    await expect(firstShown).resolves.toBe(true)

    // 第二次右键：先释放第一个，再弹第二个
    const secondShown = showNativeContextMenu(entries)
    await vi.advanceTimersByTimeAsync(0)
    // 第二个菜单开着，过很久也不能有任何 close
    await vi.advanceTimersByTimeAsync(10_000)
    expect(log).toEqual(['first:open', 'first:dismissed', 'first:close', 'second:open'])
    second.dismiss()
    await expect(secondShown).resolves.toBe(true)
    expect(second.close).not.toHaveBeenCalled()
  })

  it('不在 App 里时返回 false，由调用方退回页面内菜单', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    await expect(showNativeContextMenu([{ label: '打开', action: () => {} }])).resolves.toBe(false)
    expect(menuNewMock).not.toHaveBeenCalled()
  })

  it('原生菜单创建失败时返回 false', async () => {
    menuNewMock.mockRejectedValueOnce(new Error('no menu'))
    await expect(showNativeContextMenu([{ label: '打开', action: () => {} }])).resolves.toBe(false)
  })
})
