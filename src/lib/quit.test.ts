import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exit, writePersisted } = vi.hoisted(() => ({ exit: vi.fn(), writePersisted: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ exit }))
vi.mock('@/lib/persist', () => ({ isTauriRuntime: () => false, writePersisted }))

import { quitAfterSave } from '@/lib/quit'
import { useDocumentStore } from '@/stores/documentStore'

describe('quitAfterSave', () => {
  beforeEach(() => {
    exit.mockReset()
    writePersisted.mockReset().mockResolvedValue(undefined)
  })

  it('saves the document and UI snapshot before exiting', async () => {
    const prepare = vi.spyOn(useDocumentStore.getState(), 'prepareToLeave').mockResolvedValue(true)

    await quitAfterSave()

    expect(prepare).toHaveBeenCalled()
    expect(writePersisted).toHaveBeenCalledWith('ui', expect.anything())
    expect(exit).toHaveBeenCalledWith(0)
    expect(prepare.mock.invocationCallOrder[0]!).toBeLessThan(exit.mock.invocationCallOrder[0]!)
  })

  it('stays open when the document could not be saved', async () => {
    vi.spyOn(useDocumentStore.getState(), 'prepareToLeave').mockResolvedValue(false)

    await quitAfterSave()

    expect(exit).not.toHaveBeenCalled()
  })
})
