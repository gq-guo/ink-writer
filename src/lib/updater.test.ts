import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { check, relaunch } = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))

import { checkForUpdate, installUpdateAndRelaunch, resetUpdaterForTesting } from '@/lib/updater'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'

type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

function fakeUpdate(download: (onEvent: (event: DownloadEvent) => void) => Promise<void>) {
  return { version: '0.4.1', body: 'notes', downloadAndInstall: vi.fn(download) }
}

describe('updater', () => {
  beforeEach(() => {
    resetUpdaterForTesting()
    useEditorStore.getState().clearUpdateInfo()
    check.mockReset()
    relaunch.mockReset()
    vi.spyOn(useDocumentStore.getState(), 'flushSave').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports download progress, flushes saves, then relaunches', async () => {
    const seen: Array<number | null> = []
    const update = fakeUpdate(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 200 } })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      seen.push(useEditorStore.getState().updateInfo?.progress ?? null)
      onEvent({ event: 'Progress', data: { chunkLength: 150 } })
      onEvent({ event: 'Finished' })
    })
    check.mockResolvedValue(update)
    await checkForUpdate()

    await installUpdateAndRelaunch()

    expect(seen).toEqual([0.25])
    expect(useEditorStore.getState().updateInfo?.status).toBe('installing')
    expect(check).toHaveBeenCalledTimes(1)
    expect(useDocumentStore.getState().flushSave).toHaveBeenCalled()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated clicks while a download is running', async () => {
    let finish: () => void = () => {}
    const update = fakeUpdate(() => new Promise<void>((resolve) => (finish = resolve)))
    check.mockResolvedValue(update)
    await checkForUpdate()

    const first = installUpdateAndRelaunch()
    await installUpdateAndRelaunch()
    await installUpdateAndRelaunch()
    expect(useEditorStore.getState().updateInfo?.status).toBe('downloading')
    finish()
    await first

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open with a retry state when relaunch is refused', async () => {
    check.mockResolvedValue(fakeUpdate(async () => {}))
    relaunch.mockRejectedValue(new Error('process.restart not allowed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await checkForUpdate()

    await installUpdateAndRelaunch()

    expect(useEditorStore.getState().updateInfo).toMatchObject({ version: '0.4.1', status: 'failed' })
  })

  it('does not relaunch while the current document is unsaved', async () => {
    check.mockResolvedValue(fakeUpdate(async () => {}))
    useDocumentStore.setState({ saveState: 'error' })
    await checkForUpdate()

    await installUpdateAndRelaunch()

    expect(relaunch).not.toHaveBeenCalled()
    expect(useEditorStore.getState().updateInfo?.status).toBe('unsaved')
    useDocumentStore.setState({ saveState: 'idle' })
  })

  it('retries only the relaunch once the update is installed', async () => {
    const update = fakeUpdate(async () => {})
    check.mockResolvedValue(update)
    relaunch.mockRejectedValueOnce(new Error('process.restart not allowed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await checkForUpdate()

    await installUpdateAndRelaunch()
    await installUpdateAndRelaunch()

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledTimes(2)
  })
})
