import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { dispatchCommand, resetDispatchForTesting } from '@/commands/dispatch'
import { useSettingsStore, DEFAULT_SETTINGS } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

describe('dispatchCommand（快捷键与菜单栏去重）', () => {
  beforeEach(() => {
    resetDispatchForTesting()
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, fontSize: 18 } })
    useUiStore.setState({ paletteVisible: false, quickOpenVisible: false, settingsVisible: false })
  })

  it('同一次按键被 keydown 和菜单同时收到时只执行一次', () => {
    expect(dispatchCommand('font.larger', 'keyboard')).toBe(true)
    expect(dispatchCommand('font.larger', 'menu')).toBe(false)
    expect(useSettingsStore.getState().settings.fontSize).toBe(19)
  })

  it('同一来源连按不去重（⌘= 连续放大）', () => {
    dispatchCommand('font.larger', 'keyboard')
    dispatchCommand('font.larger', 'keyboard')
    expect(useSettingsStore.getState().settings.fontSize).toBe(20)
  })

  it('菜单执行前收起 overlay', () => {
    useUiStore.setState({ paletteVisible: true })
    dispatchCommand('app.settings', 'menu')
    const ui = useUiStore.getState()
    expect(ui.paletteVisible).toBe(false)
    expect(ui.settingsVisible).toBe(true)
  })

  it('未知命令返回 false', () => {
    expect(dispatchCommand('nope', 'menu')).toBe(false)
  })
})
