/**
 * Quick Open（spec W3 / §14）
 *
 * - ⌘P 打开，宽 560px，距顶 18vh
 * - 文件名 fzf 风格评分；查询 ≥2 字符且文件名结果 <5 条时追加正文命中分组
 * - ↑↓ 选择，Enter 打开，Esc 关闭
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { OverlayShell } from './OverlayShell'
import { fuzzyScorePath } from '@/lib/fuzzy'
import { relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import type { DocumentMeta, SearchHit } from '@/lib/types'

interface FileResult {
  kind: 'file'
  document: DocumentMeta
  score: number
}

interface ContentResult {
  kind: 'content'
  hit: SearchHit
}

type Result = FileResult | ContentResult

const MIN_CONTENT_QUERY = 2
const CONTENT_TRIGGER_THRESHOLD = 5

export function QuickOpen() {
  const visible = useUiStore((state) => state.quickOpenVisible)
  const hide = useUiStore((state) => state.hideQuickOpen)
  const documents = useDocumentStore((state) => state.documents)
  const openDocument = useDocumentStore((state) => state.openDocument)

  const t = useT()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [contentHits, setContentHits] = useState<SearchHit[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  const fileResults = useMemo<FileResult[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return documents.slice(0, 20).map((document) => ({ kind: 'file' as const, document, score: 0 }))
    }
    const scored: FileResult[] = []
    for (const document of documents) {
      const relativePath = `${document.dirPrefix}${document.fileName}`
      const hit = fuzzyScorePath(trimmed, document.displayTitle || document.fileName, relativePath)
      if (hit) scored.push({ kind: 'file', document, score: hit.score })
    }
    scored.sort((a, b) => b.score - a.score || b.document.mtime - a.document.mtime)
    return scored
  }, [documents, query])

  // 正文搜索：查询 ≥2 字符且文件名结果 <5 条
  useEffect(() => {
    const trimmed = query.trim()
    let cancelled = false
    if (trimmed.length < MIN_CONTENT_QUERY || fileResults.length >= CONTENT_TRIGGER_THRESHOLD) {
      const timer = setTimeout(() => {
        if (!cancelled) setContentHits([])
      }, 0)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
    const timer = setTimeout(() => {
      void invoke<SearchHit[]>('search_content', {
        root: useDocumentStore.getState().libraryPath,
        query: trimmed,
      })
        .then((hits) => {
          if (!cancelled) setContentHits(hits)
        })
        .catch(() => {
          if (!cancelled) setContentHits([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, fileResults.length])

  const results = useMemo<Result[]>(() => {
    const items: Result[] = [...fileResults]
    for (const hit of contentHits) items.push({ kind: 'content', hit })
    return items
  }, [contentHits, fileResults])

  const selectable = results

  if (!visible) return null

  const openSelected = () => {
    const item = selectable[selected]
    if (!item) return
    hide()
    if (item.kind === 'file') {
      void openDocument(item.document.path)
    } else {
      void openDocument(item.hit.path, [item.hit.start, item.hit.end])
    }
  }

  return (
    <OverlayShell onClose={hide} label="Quick Open">
      <input
        ref={inputRef}
        className="ink-overlay-input"
        placeholder={t('quickOpen.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelected((index) => Math.min(index + 1, selectable.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            openSelected()
          }
        }}
      />

      <div className="ink-overlay-list">
        {fileResults.length === 0 && contentHits.length === 0 ? (
          <div className="ink-overlay-empty">{t('quickOpen.empty')}</div>
        ) : null}

        {fileResults.map((item, index) => (
          <div
            key={item.document.path}
            className="ink-overlay-item"
            data-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => {
              hide()
              void openDocument(item.document.path)
            }}
          >
            <span className="ink-qo-title">
              {item.document.displayTitle || item.document.fileName}
            </span>
            <span className="ink-overlay-sub">{relativeTime(item.document.mtime)}</span>
          </div>
        ))}

        {contentHits.length > 0 ? (
          <>
            <div className="ink-overlay-group">{t('quickOpen.contentGroup')}</div>
            {contentHits.map((hit, index) => {
              const absoluteIndex = fileResults.length + index
              return (
                <div
                  key={`${hit.path}:${hit.line}:${index}`}
                  className="ink-overlay-item"
                  data-selected={absoluteIndex === selected}
                  onMouseEnter={() => setSelected(absoluteIndex)}
                  onClick={() => {
                    hide()
                    void openDocument(hit.path, [hit.start, hit.end])
                  }}
                >
                  <span className="truncate">{hit.snippet}</span>
                  <span className="ink-overlay-sub">
                    {hit.fileName}:{hit.line}
                  </span>
                </div>
              )
            })}
          </>
        ) : null}
      </div>
    </OverlayShell>
  )
}
