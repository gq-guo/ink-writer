import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { installDropGuard } from '@/lib/dropGuard'
import { inkImageHandler } from '@/editor/imageHandler'

/** jsdom 没有 DragEvent / DataTransfer：造一个带 dataTransfer 的可取消事件 */
function dragEvent(type: 'dragover' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = {
    types: files.length > 0 ? ['Files'] : ['text/plain'],
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type })),
    dropEffect: 'none',
  }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

function png(): File {
  const file = new File([new Uint8Array([1, 2, 3])], 'icon.png', { type: 'image/png' })
  // jsdom 的 File 没有 arrayBuffer()
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  return file
}

describe('拖放兜底：文件不会被 WebKit「打开」', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
  })

  it('拖到任何地方的文件：取消默认的打开行为', () => {
    uninstall = installDropGuard()
    const drop = dragEvent('drop', [new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    document.body.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
  })

  it('拖动时：图片显示「复制」，别的文件显示「不能放」；拖的不是文件（选中的文字）不管', () => {
    uninstall = installDropGuard()
    const image = dragEvent('dragover', [png()])
    document.body.dispatchEvent(image)
    expect(image.defaultPrevented).toBe(true)
    expect((image as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy')

    const pdf = dragEvent('dragover', [new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    document.body.dispatchEvent(pdf)
    expect((pdf as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none')

    const text = dragEvent('drop', [])
    document.body.dispatchEvent(text)
    expect(text.defaultPrevented).toBe(false)
  })
})

describe('图片拖到正文以外', () => {
  it('插在光标处，并且不再触发默认的打开行为', async () => {
    invokeMock.mockResolvedValue('assets/icon.png')
    const uninstall = installDropGuard()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '第一行\n',
        selection: { anchor: 4 },
        extensions: [inkImageHandler({ getDocDir: () => '/library', onError: () => {} })],
      }),
    })
    const outside = document.createElement('aside')
    document.body.appendChild(outside)

    const drop = dragEvent('drop', [png()])
    outside.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('第一行\n![icon](assets/icon.png)'))
    expect(invokeMock).toHaveBeenCalledWith('copy_image_bytes', expect.objectContaining({ docDir: '/library', fileName: 'icon.png' }))

    view.destroy()
    uninstall()
    parent.remove()
    outside.remove()
  })
})
