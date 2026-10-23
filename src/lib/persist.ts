/**
 * 持久化抽象（spec §7.1）
 *
 * Tauri 环境经 Rust 命令读写 settings.json（只开放 settings / ui 两个键；
 * 前端不再直接拿 store 插件 —— 它能往任意路径写 JSON）；
 * 浏览器 / 测试环境回退到 localStorage。
 */
import { invoke } from '@tauri-apps/api/core'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function readPersisted<T>(key: string, fallback: T): Promise<T> {
  if (isTauriRuntime()) {
    try {
      const value = await invoke<T | null>('load_persisted', { key })
      return value === undefined || value === null ? fallback : value
    } catch {
      return fallback
    }
  }
  try {
    const raw = window.localStorage.getItem(`ink:${key}`)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writePersisted(key: string, value: unknown): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke('save_persisted', { key, value })
    } catch {
      /* 持久化失败不应影响写作 */
    }
    return
  }
  try {
    window.localStorage.setItem(`ink:${key}`, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

/** Rust 侧已授权的文档库（非 Tauri 环境返回 null，沿用本地设置） */
export interface LibraryStatus {
  path: string | null
  exists: boolean
}

export async function loadAuthorizedLibrary(): Promise<LibraryStatus | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<LibraryStatus>('get_library')
  } catch {
    return { path: null, exists: false }
  }
}
