import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

import { SettingsPanel } from '@/components/SettingsPanel'
import { syncLocale } from '@/lib/i18n'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

describe('SettingsPanel（⌘,）', () => {
  beforeEach(() => {
    syncLocale('zh-CN')
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, libraryPath: '/Users/me/Documents/Ink' },
    })
    useUiStore.setState({ settingsVisible: true })
  })

  it('拼写检查开关写回设置', () => {
    render(<SettingsPanel />)
    const toggle = screen.getByRole('switch', { name: '输入时检查拼写' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(useSettingsStore.getState().settings.spellcheck).toBe(false)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('主题与语言用分段控件切换', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('radio', { name: '深色' }))
    expect(useSettingsStore.getState().settings.theme).toBe('dark')

    fireEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(useSettingsStore.getState().settings.locale).toBe('en')
    expect(screen.getByRole('switch', { name: 'Check spelling while typing' })).toBeInTheDocument()
  })

  it('显示文档库路径，Esc 关闭', () => {
    render(<SettingsPanel />)
    expect(screen.getByText('/Users/me/Documents/Ink')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useUiStore.getState().settingsVisible).toBe(false)
  })
})
