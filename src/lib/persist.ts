/**
 * 持久化抽象（spec §7.1）
 *
 * Tauri 环境使用 tauri-plugin-store（settings.json）；
 * 浏览器 / 测试环境回退到 localStorage。
 */
import { load, type Store } from '@tauri-apps/plugin-store'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let storePromise: Promise<Store | null> | null = null

function getStore(): Promise<Store | null> {
  if (!isTauriRuntime()) return Promise.resolve(null)
  if (!storePromise) {
    storePromise = load('settings.json', { autoSave: false }).catch(() => null)
  }
  return storePromise
}

export async function readPersisted<T>(key: string, fallback: T): Promise<T> {
  const store = await getStore()
  if (store) {
    try {
      const value = await store.get<T>(key)
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
  const store = await getStore()
  if (store) {
    try {
      await store.set(key, value)
      await store.save()
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
