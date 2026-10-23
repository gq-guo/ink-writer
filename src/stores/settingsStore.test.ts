import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

async function loadStores() {
  vi.resetModules()
  const settings = await import('@/stores/settingsStore')
  const ui = await import('@/stores/uiStore')
  return { settingsStore: settings.useSettingsStore, uiStore: ui.useUiStore }
}

/** 文档库授权以 Rust 为准：前端存的 settings.libraryPath 不可信 */
describe('settingsStore.hydrate 的文档库来源', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    // 模拟 Tauri 运行时：persist 走 Rust 命令
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  function mockRust(library: { path: string | null; exists: boolean }) {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_library') return library
      if (command === 'load_persisted' && args?.key === 'settings') {
        return { libraryPath: '/forged/elsewhere', fontSize: 20 }
      }
      return null
    })
  }

  it('用 Rust 授权的库路径覆盖前端存的 libraryPath', async () => {
    mockRust({ path: '/Users/me/Documents/Ink', exists: true })
    const { settingsStore } = await loadStores()

    await settingsStore.getState().hydrate()

    expect(settingsStore.getState().settings.libraryPath).toBe('/Users/me/Documents/Ink')
    expect(settingsStore.getState().settings.fontSize).toBe(20)
  })

  it('未授权任何库时回到首次引导，而不是信任前端存的路径', async () => {
    mockRust({ path: null, exists: false })
    const { settingsStore } = await loadStores()

    await settingsStore.getState().hydrate()

    expect(settingsStore.getState().settings.libraryPath).toBe('')
  })

  it('授权的库目录已不存在：回到引导页并提示', async () => {
    mockRust({ path: '/Users/me/Gone', exists: false })
    const { settingsStore, uiStore } = await loadStores()

    await settingsStore.getState().hydrate()

    expect(settingsStore.getState().settings.libraryPath).toBe('')
    expect(uiStore.getState().toasts.some((toast) => toast.message.includes('/Users/me/Gone'))).toBe(
      true,
    )
  })
})
