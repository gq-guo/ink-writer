import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const { setThemeMock } = vi.hoisted(() => ({ setThemeMock: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTheme: setThemeMock }) }))

import { applyThemeToDocument, releaseBootBackground, THEME_BOOT_KEY } from '@/stores/settingsStore'

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

  it('applyThemeToDocument 记下偏好供下次启动用；临时底色留到主界面画出来再收', () => {
    mockSystemDark(false)
    window.localStorage.setItem(THEME_BOOT_KEY, 'dark')
    runBootScript()
    applyThemeToDocument('dark')
    expect(window.localStorage.getItem(THEME_BOOT_KEY)).toBe('dark')
    expect(root.style.backgroundColor).toBe('rgb(27, 26, 24)')
    expect(root.dataset.theme).toBe('dark')

    releaseBootBackground()
    expect(root.style.backgroundColor).toBe('')
    expect(root.style.colorScheme).toBe('')

    applyThemeToDocument('system')
    expect(window.localStorage.getItem(THEME_BOOT_KEY)).toBe('system')
    expect(root.dataset.theme).toBe('light')
  })
})

describe('macOS 半透明侧栏（data-vibrancy）', () => {
  const root = document.documentElement
  const originalUserAgent = navigator.userAgent

  function setUserAgent(value: string) {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
  }

  afterEach(() => {
    setUserAgent(originalUserAgent)
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    root.removeAttribute('style')
    root.removeAttribute('data-theme')
    root.removeAttribute('data-vibrancy')
    setThemeMock.mockClear()
    window.localStorage.clear()
  })

  it('Mac 上的 App：标 data-vibrancy，也先铺底色（主界面出来前不露出整窗灰色材质）', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    window.localStorage.setItem(THEME_BOOT_KEY, 'dark')
    runBootScript()
    expect(root.dataset.vibrancy).toBe('true')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.backgroundColor).toBe('rgb(27, 26, 24)')
  })

  it('半透明侧栏下收回底色是淡出到透明，再交还样式表', () => {
    vi.useFakeTimers()
    try {
      root.setAttribute('data-vibrancy', 'true')
      root.style.backgroundColor = '#1b1a18'
      releaseBootBackground()
      expect(root.style.backgroundColor).toBe('transparent')
      expect(root.style.transition).toContain('background-color')
      vi.advanceTimersByTime(300)
      expect(root.style.backgroundColor).toBe('')
      expect(root.style.transition).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('浏览器里（没有 Tauri）：不标 data-vibrancy，照常铺底色', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')
    window.localStorage.setItem(THEME_BOOT_KEY, 'dark')
    runBootScript()
    expect(root.dataset.vibrancy).toBeUndefined()
    expect(root.style.backgroundColor).toBe('rgb(27, 26, 24)')
  })

  it('窗口外观跟随主题偏好：手动深 / 浅色固定，system 交还系统', () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    applyThemeToDocument('dark')
    applyThemeToDocument('light')
    applyThemeToDocument('system')
    expect(setThemeMock.mock.calls).toEqual([['dark'], ['light'], [null]])
  })

  it('样式表只在 data-vibrancy 下把 body 设成透明、侧栏留半透明', () => {
    expect(GLOBALS_CSS).toMatch(/\[data-vibrancy='true'\] body \{\s*background: transparent;/)
    expect(GLOBALS_CSS).toMatch(/\[data-vibrancy='true'\] \.ink-sidebar \{\s*background: color-mix\(in srgb, var\(--sidebar\) \d+%, transparent\);/)
  })
})
