/**
 * 开发期自检：在**真实应用**里验证「光标居中」是否真的生效。
 *
 * 背景：headless Chrome 里页面被当作隐藏页，rAF 根本不会触发，
 * 无法验证依赖 rAF 的逻辑；这里在真实 WKWebView（可见窗口）里跑，
 * 把测量结果写到 /tmp/ink-selftest.txt。
 *
 * 只在 dev 构建（import.meta.env.DEV）下启用。
 */
import { EditorView } from '@codemirror/view'

import { focusModeField, setFocusModeEffect } from './focusMode'
import { typewriterModeField } from './typewriter'
import { pauseAutosave, resumeAutosave } from '@/stores/documentStore'

const RESULT_PATH = '/tmp/ink-selftest.txt'



function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count
    const step = () => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

/** 测量光标所在行相对视口中心的偏移 */
function measure(view: EditorView): string {
  const head = view.state.selection.main.head
  const coords = view.coordsAtPos(head)
  const rect = view.scrollDOM.getBoundingClientRect()
  if (!coords) return 'offset=NO-COORDS'
  const cursorCenter = (coords.top + coords.bottom) / 2
  const viewportCenter = rect.top + rect.height / 2
  return `offset=${(cursorCenter - viewportCenter).toFixed(1)}px scrollTop=${view.scrollDOM.scrollTop.toFixed(0)}`
}

export async function runCenteringSelfTest(_view: EditorView): Promise<void> {
  // 用一个独立的长文档视图来测（不打扰用户正在编辑的内容）
  const { EditorState } = await import('@codemirror/state')
  const { createInkExtensions } = await import('./extensions')

  const host = document.createElement('div')
  // 注意：不要用 display:none / z-index:-1 / pointer-events:none，
  // 那样元素无法获得焦点，hasFocus 恒为 false，自检就测不出真实行为
  host.style.cssText =
    'position:fixed;left:0;top:0;width:640px;height:400px;opacity:0.02;outline:none'
  document.body.appendChild(host)

  const doc = Array.from(
    { length: 120 },
    (_, i) => `第 ${i + 1} 段：这是一段用于验证光标居中的文字，长度足够让文档超出视口高度。`,
  ).join('\n\n')

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: createInkExtensions({
        dark: false,
        onDocChanged: () => {},
        onStatistics: () => {},
        getDocDir: () => '',
        onOpenUrl: () => {},
        onRevealPath: () => {},
        onError: () => {},
      }),
    }),
  })

  const lines: string[] = []
  const push = (line: string) => {
    lines.push(line)
    console.info('[selftest]', line)
  }

  // 全程暂停自动保存（双保险：即使探针意外触发变更也不会写盘）
  pauseAutosave()
  try {
    view.focus()
    await nextFrames(2)
    push(`initial: ${measure(view)} focus=${view.hasFocus}`)

    // 打开 Focus Mode
    view.dispatch({ effects: setFocusModeEffect.of(true) })
    await nextFrames(2)
    push(`focus-on: ${measure(view)}`)

    // 模拟在当前位置打字（连续两次）
    for (const text of ['A', 'B']) {
      view.focus()
      await nextFrames(1)
      const head = view.state.selection.main.head
      view.dispatch({ changes: { from: head, insert: text } })
      await nextFrames(3)
      push(`type-${text}: ${measure(view)}`)
    }

    // 模拟光标跳到文档中段
    const mid = Math.floor(view.state.doc.length / 2)
    view.dispatch({ selection: { anchor: mid }, scrollIntoView: true })
    await nextFrames(2)
    view.focus()
    await nextFrames(1)
    view.dispatch({ changes: { from: mid, insert: 'X' } })
    await nextFrames(3)
    push(`type-mid: ${measure(view)}`)

    // 只移动光标（不打字）→ 视图不应被拽回中心
    const before = view.scrollDOM.scrollTop
    view.focus()
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const nextLine = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines))
    view.dispatch({ selection: { anchor: nextLine.from } })
    await nextFrames(3)
    const moved = Math.abs(view.scrollDOM.scrollTop - before)
    push(`move-only: scrollTopDelta=${moved.toFixed(0)} (应接近 0，说明没有把视图拽回中心)`)

    // ── 点击定位检测：必须用独立离屏视图，绝不能碰用户文档 ──
    // （历史事故：探针替换主文档内容触发了自动保存，把探针文本写进用户文件）
    const probeHost = document.createElement('div')
    probeHost.style.cssText =
      'position:fixed;left:0;top:0;width:640px;height:400px;opacity:0.02;outline:none'
    document.body.appendChild(probeHost)
    const probeView = new EditorView({
      parent: probeHost,
      state: EditorState.create({
        doc,
        extensions: createInkExtensions({
          dark: false,
          onDocChanged: () => {},
          onStatistics: () => {},
          getDocDir: () => '',
          onOpenUrl: () => {},
          onRevealPath: () => {},
          onError: () => {},
        }),
      }),
    })
    probeView.focus()
    await nextFrames(2)

    {
      const mRect = probeView.scrollDOM.getBoundingClientRect()
      const mLines = Array.from(probeView.contentDOM.querySelectorAll('.cm-line')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.top >= mRect.top - 1 && r.bottom <= mRect.bottom + 1
      })
      push(
        `probe-editor: visible=${mLines.length} scrollerTop=${mRect.top.toFixed(1)} h=${mRect.height.toFixed(1)}`,
      )
      const domLines = Array.from(probeView.contentDOM.querySelectorAll('.cm-line'))
      for (const el of mLines.slice(0, 5)) {
        const r = el.getBoundingClientRect()
        const y = r.top + r.height / 2
        const pos = probeView.posAtCoords({ x: r.left + 12, y })
        const landed = pos === null ? 'null' : String(probeView.state.doc.lineAt(pos).number)
        const domIndex = domLines.indexOf(el)
        push(`probe-click: domIdx=${domIndex} y=${y.toFixed(0)} -> line ${landed}`)
      }
    }
    probeView.destroy()
    probeHost.remove()

    // ── 点击定位检测：posAtCoords 是否把点击映射到正确的行 ──
    const viewRect = view.scrollDOM.getBoundingClientRect()
    const allLines = Array.from(view.contentDOM.querySelectorAll('.cm-line'))
    const visible = allLines.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= viewRect.top - 1 && r.bottom <= viewRect.bottom + 1
    })
    push(`visible-lines=${visible.length} all-rendered=${allLines.length}`)
    for (const el of visible.slice(0, 6)) {
      const rect = el.getBoundingClientRect()
      const y = rect.top + rect.height / 2
      const pos = view.posAtCoords({ x: rect.left + 12, y })
      const landed = pos === null ? 'null' : String(view.state.doc.lineAt(pos).number)
      const text = (el.textContent ?? '').slice(0, 12)
      push(
        `click-map: y=${y.toFixed(0)} h=${rect.height.toFixed(1)} -> line ${landed} | ${text}`,
      )
    }

    push(`focusField=${view.state.field(focusModeField, false)}`)
    push(`typewriterField=${view.state.field(typewriterModeField, false)}`)
    push('DONE')
  } catch (error) {
    push(`ERROR: ${String(error)}`)
  } finally {
    resumeAutosave()
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('write_text_file', { path: RESULT_PATH, content: lines.join('\n') })
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}
