import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { TypographyPopover } from '@/components/TypographyPopover'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/stores/settingsStore'
import { syncLocale } from '@/lib/i18n'

describe('TypographyPopover 字体列表', () => {
  beforeEach(() => {
    syncLocale('zh-CN')
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })

  it('每一项都显示正式名称，不再露出内部 key', () => {
    render(<TypographyPopover onClose={() => {}} />)
    expect(screen.getByText('iA Writer Quattro')).toBeInTheDocument()
    expect(screen.queryByText('quattro')).not.toBeInTheDocument()
  })

  it('不再提供没有内置的 IBM Plex', () => {
    render(<TypographyPopover onClose={() => {}} />)
    expect(screen.queryByText(/plex/i)).not.toBeInTheDocument()
  })
})
