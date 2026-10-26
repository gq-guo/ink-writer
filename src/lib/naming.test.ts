import { describe, expect, it } from 'vitest'

import { ensureMarkdownExtension, markdownExtensionOf } from '@/lib/naming'

describe('ensureMarkdownExtension', () => {
  it('appends .md unless the name already ends with it', () => {
    expect(ensureMarkdownExtension('Notes')).toBe('Notes.md')
    expect(ensureMarkdownExtension('Notes.md')).toBe('Notes.md')
    expect(ensureMarkdownExtension('Notes.MD')).toBe('Notes.MD')
  })

  it('treats a typed .txt / .markdown as part of the name so the file stays indexed', () => {
    expect(ensureMarkdownExtension('todo.txt')).toBe('todo.txt.md')
    expect(ensureMarkdownExtension('draft.markdown')).toBe('draft.markdown.md')
  })

  it('keeps the current extension of a file opened from Finder', () => {
    const extension = markdownExtensionOf('readme.markdown')
    expect(extension).toBe('markdown')
    expect(ensureMarkdownExtension('Readme v2', extension)).toBe('Readme v2.markdown')
    expect(markdownExtensionOf('Untitled.md')).toBe('md')
    expect(markdownExtensionOf('archive.zip')).toBe('md')
  })
})
