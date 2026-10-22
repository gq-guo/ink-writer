import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { StatusBar } from '@/components/StatusBar'
import { useEditorStore } from '@/stores/editorStore'

describe('StatusBar（spec W5）', () => {
  beforeEach(() => {
    useEditorStore.setState({
      focusMode: false,
      statistics: {
        words: 1245,
        cjkChars: 1000,
        latinWords: 245,
        characters: 7832,
        paragraphs: 42,
        sentences: 68,
        readingMinutes: 6,
      },
    })
  })

  it('显示字数与阅读时长', () => {
    render(<StatusBar />)
    expect(screen.getByText(/1,245 字/)).toBeInTheDocument()
    expect(screen.getByText(/约 6 分钟/)).toBeInTheDocument()
  })

  it('常驻显示（效果图：不需要 hover）', () => {
    const { container } = render(<StatusBar />)
    expect(container.querySelector('.ink-statusbar')).toBeInTheDocument()
    expect(screen.getByText(/1,245 字/)).toBeInTheDocument()
  })

  it('点击展开统计卡片', () => {
    render(<StatusBar />)
    fireEvent(window, new MouseEvent('mousemove', { clientY: window.innerHeight - 10 }))
    fireEvent.click(screen.getByText(/1,245 字/))
    expect(screen.getByText('字符')).toBeInTheDocument()
    expect(screen.getByText('段落')).toBeInTheDocument()
    expect(screen.getByText('阅读时长')).toBeInTheDocument()
  })

  it('Focus Mode 下完全禁用', () => {
    useEditorStore.setState({ focusMode: true })
    const { container } = render(<StatusBar />)
    expect(container.querySelector('.ink-statusbar')).toBeNull()
  })
})
