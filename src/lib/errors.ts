/**
 * 把 invoke / 运行时异常转成给用户看的文案
 *
 * Rust 的 CommandError 序列化为 { kind: 'error', data: { code, detail } }：
 * code 按当前语言翻译（i18n 的 error.<code>），detail 是路径 / 系统错误原文。
 */
import { t } from '@/lib/i18n'

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const { kind, data } = error as { kind?: unknown; data?: unknown }
    if (kind === 'error' && data && typeof data === 'object') {
      const { code, detail } = data as { code?: unknown; detail?: unknown }
      const key = `error.${String(code)}`
      const text = t(key, { detail: String(detail ?? '') })
      // 未知错误码：至少把原文给出来
      return text === key ? String(detail ?? code) : text
    }
    if ('message' in error) return String((error as { message: unknown }).message)
  }
  return t('error.unknown')
}
