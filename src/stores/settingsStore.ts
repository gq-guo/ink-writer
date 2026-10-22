/**
 * 设置 store（spec §5.2 / §6.2）
 *
 * settingsStore 是唯一写磁盘的 store：字段变更 → debounce 300ms → 落盘。
 */
import { create } from 'zustand'
import type { AppSettings } from '@/lib/types'
import { readPersisted, writePersisted } from '@/lib/persist'

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

export function applyThemeToDocument(theme: AppSettings['theme']) {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,

  hydrate: async () => {
    const stored = await readPersisted<Partial<AppSettings>>('settings', {})
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      fontSize: clamp(stored.fontSize ?? DEFAULT_SETTINGS.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
      lineHeight: clamp(stored.lineHeight ?? DEFAULT_SETTINGS.lineHeight, 1.4, 2.0),
      contentWidth: clamp(stored.contentWidth ?? DEFAULT_SETTINGS.contentWidth, 560, 960),
    }
    set({ settings: merged, hydrated: true })
    applySettingsToDocument(merged)
    applyThemeToDocument(merged.theme)
  },

  update: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    applySettingsToDocument(next)
    applyThemeToDocument(next.theme)
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
