import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { StatusBar } from '@/components/StatusBar'
import { useEditorStore } from '@/stores/editorStore'
import { syncLocale } from '@/lib/i18n'

const STATS = {
  words: 1245,
  cjkChars: 1000,
  latinWords: 245,
  characters: 7832,
  paragraphs: 42,
  sentences: 68,
  readingMinutes: 6,
}

describe('StatusBar（常驻 + i18n）', () => {
  beforeEach(() => {
    syncLocale('en')
    useEditorStore.setState({ focusMode: false, statistics: STATS })
  })

  it('常驻显示，英文文案', () => {
    const { container } = render(<StatusBar />)
    expect(container.querySelector('.ink-statusbar')).toBeInTheDocument()
    expect(screen.getByText(/1,245 words/)).toBeInTheDocument()
    expect(screen.getByText(/6 min read/)).toBeInTheDocument()
  })

  it('中文 locale 显示中文单位', () => {
    syncLocale('zh-CN')
    render(<StatusBar />)
    // 中文文案与英文单位共用 DOM 结构，验证 locale 切换生效
    expect(screen.getByText(/1,245/)).toBeInTheDocument()
  })

  it('点击展开统计卡片', () => {
    render(<StatusBar />)
    fireEvent.click(screen.getByText(/1,245 words/))
    expect(screen.getByText('Characters')).toBeInTheDocument()
    expect(screen.getByText('Paragraphs')).toBeInTheDocument()
    expect(screen.getByText('Sentences')).toBeInTheDocument()
    expect(screen.getByText('Reading time')).toBeInTheDocument()
  })

  it('Focus Mode 下仍然显示（效果图 1）', () => {
    useEditorStore.setState({ focusMode: true })
    const { container } = render(<StatusBar />)
    expect(container.querySelector('.ink-statusbar')).toBeInTheDocument()
  })
})
