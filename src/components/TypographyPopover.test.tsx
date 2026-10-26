import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { TypographyPopover } from '@/components/TypographyPopover'
import { DEFAULT_SETTINGS, FONT_STACKS, applySettingsToDocument, useSettingsStore } from '@/stores/settingsStore'
import { syncLocale } from '@/lib/i18n'

describe('TypographyPopover 内置中英文字体', () => {
  beforeEach(() => {
    syncLocale('zh-CN')
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })

  it('列出 Noto 宋体与霞鹜文楷，按钮用各自的字体预览', () => {
    render(<TypographyPopover onClose={() => {}} />)
    expect(screen.getByText('Noto 宋体')).toHaveStyle({ fontFamily: FONT_STACKS.noto })
    expect(screen.getByText('霞鹜文楷')).toHaveStyle({ fontFamily: FONT_STACKS.wenkai })
  })

  it('选中霞鹜文楷后写进设置', () => {
    render(<TypographyPopover onClose={() => {}} />)
    fireEvent.click(screen.getByText('霞鹜文楷'))
    expect(useSettingsStore.getState().settings.fontFamily).toBe('wenkai')
  })

  it('内置字体排在字体栈最前，系统字体只做生僻字回落', () => {
    applySettingsToDocument({ ...DEFAULT_SETTINGS, fontFamily: 'noto' })
    const stack = document.documentElement.style.getPropertyValue('--writing-font')
    expect(stack.startsWith('"Ink Serif Text", "Ink Noto Serif SC"')).toBe(true)
  })
})
