/**
 * 设置 store（spec §5.2 / §6.2）
 *
 * settingsStore 是唯一写磁盘的 store：字段变更 → debounce 300ms → 落盘。
 */
import { create } from 'zustand'
import type { AppSettings } from '@/lib/types'
import { loadAuthorizedLibrary, readPersisted, writePersisted } from '@/lib/persist'
import { syncLocale, t } from '@/lib/i18n'
import { useUiStore } from './uiStore'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentColor: '#007AFF',
  fontFamily: 'quattro',
  fontSize: 18,
  lineHeight: 1.7,
  contentWidth: 680,
  libraryPath: '',
  typewriterMode: false,
  favorites: [],
  locale: 'system',
}

export const FONT_STACKS: Record<AppSettings['fontFamily'], string> = {
  system: `-apple-system, "PingFang SC", sans-serif`,
  quattro: `"iA Writer Quattro", -apple-system, "PingFang SC", sans-serif`,
  plex: `"IBM Plex Sans", -apple-system, "PingFang SC", sans-serif`,
  serif: `ui-serif, Georgia, "Songti SC", "Times New Roman", serif`,
  mono: `"JetBrains Mono", "PingFang SC", monospace`,
}

export const FONT_SIZE_RANGE = { min: 14, max: 24 } as const

interface SettingsState {
  settings: AppSettings
  hydrated: boolean
  hydrate: () => Promise<void>
  update: (patch: Partial<AppSettings>) => void
  setTheme: (theme: AppSettings['theme']) => void
  toggleTheme: () => void
  setFontSize: (size: number) => void
  increaseFontSize: () => void
  decreaseFontSize: () => void
  setLibraryPath: (path: string) => void
  setTypewriterMode: (on: boolean) => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(settings: AppSettings) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void writePersisted('settings', settings)
  }, 300)
}

/** 把设置应用到根节点的 CSS variables（spec §8.3：只改变量，不重建 EditorView） */
export function applySettingsToDocument(settings: AppSettings) {
  const root = document.documentElement
  root.style.setProperty('--writing-font', FONT_STACKS[settings.fontFamily])
  root.style.setProperty('--writing-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--writing-line-height', String(settings.lineHeight))
  root.style.setProperty('--editor-max-width', `${settings.contentWidth}px`)
  root.style.setProperty('--accent', settings.accentColor)
}

export function resolveTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 主题切换时颜色过渡的时长（与 globals.css 的 .ink-theme-transition 对应，留一点余量） */
const THEME_TRANSITION_MS = 320
let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 把主题写到 <html data-theme>。animate：用户切换 / 系统外观变化时做一次颜色过渡；
 * 启动时不做（否则首屏会从默认色渐变过来）。
 */
export function applyThemeToDocument(theme: AppSettings['theme'], options?: { animate?: boolean }) {
  const root = document.documentElement
  const next = resolveTheme(theme)
  if (root.getAttribute('data-theme') === next) return
  if (options?.animate && root.hasAttribute('data-theme')) {
    root.classList.add('ink-theme-transition')
    if (themeTransitionTimer) clearTimeout(themeTransitionTimer)
    themeTransitionTimer = setTimeout(() => {
      themeTransitionTimer = null
      root.classList.remove('ink-theme-transition')
    }, THEME_TRANSITION_MS)
  }
  root.setAttribute('data-theme', next)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,

  hydrate: async () => {
    const stored = await readPersisted<Partial<AppSettings>>('settings', {})
    // 文档库只认 Rust 侧授权的路径；settings.libraryPath 仅作展示用的副本
    const library = await loadAuthorizedLibrary()
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      ...(library ? { libraryPath: library.exists ? (library.path ?? '') : '' } : {}),
      fontSize: clamp(stored.fontSize ?? DEFAULT_SETTINGS.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
      lineHeight: clamp(stored.lineHeight ?? DEFAULT_SETTINGS.lineHeight, 1.4, 2.0),
      contentWidth: clamp(stored.contentWidth ?? DEFAULT_SETTINGS.contentWidth, 560, 960),
    }
    set({ settings: merged, hydrated: true })
    applySettingsToDocument(merged)
    applyThemeToDocument(merged.theme)
    syncLocale(merged.locale)
    // 库目录被删 / 改名 → 提示并回到引导页（spec §22.2）
    if (library?.path && !library.exists) {
      useUiStore
        .getState()
        .pushToast({ message: `${t('toast.libraryMissing')}: ${library.path}`, kind: 'error' })
    }
  },

  update: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    applySettingsToDocument(next)
    applyThemeToDocument(next.theme, { animate: true })
    syncLocale(next.locale)
    schedulePersist(next)
  },

  setTheme: (theme) => get().update({ theme }),

  toggleTheme: () => {
    const current = resolveTheme(get().settings.theme)
    get().update({ theme: current === 'dark' ? 'light' : 'dark' })
  },

  setFontSize: (size) =>
    get().update({ fontSize: clamp(size, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max) }),

  increaseFontSize: () => get().setFontSize(get().settings.fontSize + 1),
  decreaseFontSize: () => get().setFontSize(get().settings.fontSize - 1),

  setLibraryPath: (path) => get().update({ libraryPath: path }),

  setTypewriterMode: (on) => get().update({ typewriterMode: on }),
}))

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

// 主题为「跟随系统」时监听 macOS 外观变化（spec §17.1）。
// 此前只有编辑器跟着变，<html data-theme> 不更新，顶栏 / 侧栏会停在旧配色。
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useSettingsStore.getState().settings.theme === 'system') {
      applyThemeToDocument('system', { animate: true })
    }
  })
}
