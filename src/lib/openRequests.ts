/**
 * 打开 Finder 交来的文档（双击 .md / 「打开方式」/ 拖到 Dock 图标）
 *
 * Rust 把文件放进队列并发 ink://open-requested；这里取走队列、打开最后一个
 * （单窗口单文档，R10）。调用串行化：事件与启动时的主动拉取交错到达时，
 * 后一次会等前一次打开完，启动流程据此判断是否还需要打开默认文档。
 */
import { invoke } from '@tauri-apps/api/core'

import { useDocumentStore } from '@/stores/documentStore'

let chain: Promise<unknown> = Promise.resolve()

/** 有文件被打开时返回 true */
export function openRequestedFiles(): Promise<boolean> {
  const run = chain.then(async () => {
    const paths = await invoke<string[]>('take_open_requests')
    const last = paths.at(-1)
    if (!last) return false
    await useDocumentStore.getState().openDocument(last)
    return true
  })
  chain = run.catch(() => undefined)
  return run
}
