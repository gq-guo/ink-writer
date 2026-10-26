import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { CommandPalette } from '@/components/CommandPalette'
import { syncLocale } from '@/lib/i18n'
import { useUiStore } from '@/stores/uiStore'

describe('CommandPalette', () => {
  beforeEach(() => {
    syncLocale('en')
    useUiStore.setState({ paletteVisible: true, recentCommands: [] })
  })

  it('不列出「打开 Command Palette」自己，其他视图命令照常列出', () => {
    render(<CommandPalette />)
    expect(screen.getByText('Quick Open')).toBeInTheDocument()
    expect(screen.queryByText('Command Palette')).not.toBeInTheDocument()
  })

  it('中文界面的占位文字是中文', () => {
    syncLocale('zh-CN')
    render(<CommandPalette />)
    expect(screen.getByPlaceholderText('搜索命令')).toBeInTheDocument()
  })
})
