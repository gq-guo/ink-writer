import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { applyThemeToDocument, THEME_BOOT_KEY } from '@/stores/settingsStore'

const BOOT_SCRIPT = readFileSync(resolve(__dirname, '../../public/theme-boot.js'), 'utf-8')
const GLOBALS_CSS = readFileSync(resolve(__dirname, '../styles/globals.css'), 'utf-8')

/** 按 index.html 的方式执行启动脚本（同步、在 React 之前） */
function runBootScript() {
  new Function(BOOT_SCRIPT)()
}

function mockSystemDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

describe('theme-boot.js：首帧前定好深浅色', () => {
  const originalMatchMedia = window.matchMedia
  const root = document.documentElement

  beforeEach(() => {
    window.localStorage.clear()
    root.setAttribute('data-theme', 'light')
    root.removeAttribute('style')
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    root.removeAttribute('style')
    root.removeAttribute('data-theme')
  })

  it('缓存为 dark：直接设成深色，并先铺深色底（避免样式到之前的白底）', () => {
    mockSystemDark(false)
    window.localStorage.setItem(THEME_BOOT_KEY, 'dark')
    runBootScript()
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.backgroundColor).toBe('rgb(27, 26, 24)')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('没有缓存（首次启动）或缓存为 system：跟随系统外观', () => {
    mockSystemDark(true)
    runBootScript()
    expect(root.dataset.theme).toBe('dark')

    window.localStorage.setItem(THEME_BOOT_KEY, 'system')
    mockSystemDark(false)
    runBootScript()
    expect(root.dataset.theme).toBe('light')
  })

  it('缓存为 light：系统是深色也用浅色', () => {
    mockSystemDark(true)
    window.localStorage.setItem(THEME_BOOT_KEY, 'light')
    runBootScript()
    expect(root.dataset.theme).toBe('light')
  })

  it('启动脚本里的底色与 globals.css 的 --background 一致', () => {
    const tokens = [...GLOBALS_CSS.matchAll(/^\s*--background:\s*(#[0-9a-f]{6});/gim)].map((m) => m[1]!.toLowerCase())
    expect(tokens).toHaveLength(2)
    const [light, dark] = tokens
    expect(BOOT_SCRIPT).toContain(`light: '${light}'`)
    expect(BOOT_SCRIPT).toContain(`dark: '${dark}'`)
  })

  it('applyThemeToDocument 记下偏好供下次启动用，并收回临时底色', () => {
    mockSystemDark(false)
    window.localStorage.setItem(THEME_BOOT_KEY, 'dark')
    runBootScript()
    applyThemeToDocument('dark')
    expect(window.localStorage.getItem(THEME_BOOT_KEY)).toBe('dark')
    expect(root.style.backgroundColor).toBe('')
    expect(root.dataset.theme).toBe('dark')

    applyThemeToDocument('system')
    expect(window.localStorage.getItem(THEME_BOOT_KEY)).toBe('system')
    expect(root.dataset.theme).toBe('light')
  })
})
