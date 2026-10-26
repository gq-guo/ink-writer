/**
 * Quick Open（spec W3 / §14）
 *
 * - ⌘P 打开，宽 560px，距顶 18vh
 * - 文件名 fzf 风格评分；查询 ≥2 字符且文件名结果 <5 条时追加正文命中分组
 * - `#` 开头进入标签模式：上面是匹配的标签（选中补全到输入框），下面是带这个标签的段落
 * - ↑↓ 选择，Enter 打开，Esc 关闭
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { OverlayShell } from './OverlayShell'
import { fuzzyScorePath } from '@/lib/fuzzy'
import { relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useDocumentStore } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import type { DocumentMeta, SearchHit, TagCount, TagHit } from '@/lib/types'

interface FileResult {
  kind: 'file'
  document: DocumentMeta
  score: number
}

interface ContentResult {
  kind: 'content'
  hit: SearchHit
}

interface TagResult {
  kind: 'tag'
  tag: TagCount
}

interface TagHitResult {
  kind: 'tagHit'
  hit: TagHit
}

type Result = FileResult | ContentResult | TagResult | TagHitResult

/**
 * 异步搜索的结果连同它对应的搜索词和第几次打开：只有和当前一致时才显示，
 * 防止上一个词（防抖等待中）或上一次打开（文档已经改过）的结果被选中、跳到过时的位置
 */
interface Hits<T> {
  query: string
  openSeq: number
  hits: T[]
}

/** 只取和当前搜索词、当前这次打开对应的结果 */
function currentHits<T>(found: Hits<T>, query: string, openSeq: number): T[] {
  return found.query === query && found.openSeq === openSeq ? found.hits : []
}

const MIN_CONTENT_QUERY = 2
const CONTENT_TRIGGER_THRESHOLD = 5
/** 标签模式下最多列出的标签数 */
const TAG_LIST_LIMIT = 8

/** 分组标题（文件结果没有标题） */
const GROUP_LABEL: Partial<Record<Result['kind'], string>> = {
  content: 'quickOpen.contentGroup',
  tag: 'quickOpen.tagGroup',
  tagHit: 'quickOpen.tagHitGroup',
}

export function QuickOpen() {
  const visible = useUiStore((state) => state.quickOpenVisible)
  const initialQuery = useUiStore((state) => state.quickOpenQuery)
  const hide = useUiStore((state) => state.hideQuickOpen)
  const documents = useDocumentStore((state) => state.documents)
  const openDocument = useDocumentStore((state) => state.openDocument)

  const t = useT()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [contentHits, setContentHits] = useState<Hits<SearchHit>>({ query: '', openSeq: 0, hits: [] })
  const [allTags, setAllTags] = useState<TagCount[]>([])
  const [tagHits, setTagHits] = useState<Hits<TagHit>>({ query: '', openSeq: 0, hits: [] })
  const inputRef = useRef<HTMLInputElement | null>(null)

  const trimmed = query.trim()
  const tagMode = trimmed.startsWith('#')
  const tagQuery = tagMode ? trimmed.slice(1).toLowerCase() : ''

  // ⌘Click 标签等带着搜索词打开：换成这个词；否则保留上次的输入（渲染时调整，见 React「根据 props 调整 state」）
  const [opened, setOpened] = useState({ visible: false, query: '', seq: 0 })
  if (opened.visible !== visible || opened.query !== initialQuery) {
    // 每次打开记一个序号：上一次打开时搜到的结果不再算数
    setOpened({ visible, query: initialQuery, seq: visible && !opened.visible ? opened.seq + 1 : opened.seq })
    if (visible && initialQuery) {
      setQuery(initialQuery)
      setSelected(0)
    }
  }

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  // 标签模式：每次打开读一次全库标签（文档会变，不跨次缓存）
  useEffect(() => {
    if (!visible || !tagMode) return
    let cancelled = false
    void invoke<TagCount[]>('list_tags', { root: useDocumentStore.getState().libraryPath })
      .then((tags) => {
        if (!cancelled) setAllTags(tags ?? [])
      })
      .catch(() => {
        if (!cancelled) setAllTags([])
      })
    return () => {
      cancelled = true
    }
  }, [visible, tagMode])

  const openSeq = opened.seq

  // 标签模式：带这个标签（前缀匹配）的段落；每次打开都重新搜（文档可能改过）
  useEffect(() => {
    if (!visible || !tagQuery) return
    let cancelled = false
    const timer = setTimeout(() => {
      const done = (hits: TagHit[]) => {
        if (!cancelled) setTagHits({ query: tagQuery, openSeq, hits })
      }
      void invoke<TagHit[]>('search_tags', { root: useDocumentStore.getState().libraryPath, query: tagQuery })
        .then((hits) => done(hits ?? []))
        .catch(() => done([]))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [visible, tagQuery, openSeq])

  const fileResults = useMemo<FileResult[]>(() => {
    if (tagMode) return []
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
  }, [documents, tagMode, trimmed])

  // 正文搜索：查询 ≥2 字符且文件名结果 <5 条（标签模式不搜正文）
  const wantsContent = !tagMode && trimmed.length >= MIN_CONTENT_QUERY && fileResults.length < CONTENT_TRIGGER_THRESHOLD
  useEffect(() => {
    if (!visible || !wantsContent) return
    let cancelled = false
    const timer = setTimeout(() => {
      const done = (hits: SearchHit[]) => {
        if (!cancelled) setContentHits({ query: trimmed, openSeq, hits })
      }
      void invoke<SearchHit[]>('search_content', {
        root: useDocumentStore.getState().libraryPath,
        query: trimmed,
      })
        .then((hits) => done(hits ?? []))
        .catch(() => done([]))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [visible, wantsContent, trimmed, openSeq])

  const results = useMemo<Result[]>(() => {
    if (tagMode) {
      const tags = allTags
        .filter((tag) => tag.tag.toLowerCase().startsWith(tagQuery) && tag.tag.toLowerCase() !== tagQuery)
        .slice(0, TAG_LIST_LIMIT)
        .map((tag) => ({ kind: 'tag' as const, tag }))
      const hits = tagQuery ? currentHits(tagHits, tagQuery, openSeq) : []
      return [...tags, ...hits.map((hit) => ({ kind: 'tagHit' as const, hit }))]
    }
    const hits = wantsContent ? currentHits(contentHits, trimmed, openSeq) : []
    return [...fileResults, ...hits.map((hit) => ({ kind: 'content' as const, hit }))]
  }, [allTags, contentHits, fileResults, tagHits, tagMode, tagQuery, trimmed, wantsContent, openSeq])

  /** 结果变少时选中项不越界 */
  const activeIndex = results.length === 0 ? -1 : Math.min(Math.max(selected, 0), results.length - 1)

  if (!visible) return null

  const choose = (item: Result | undefined) => {
    if (!item) return
    if (item.kind === 'tag') {
      // 选标签只补全，不关闭：接着看带这个标签的段落
      setQuery(`#${item.tag.tag}`)
      setSelected(0)
      inputRef.current?.focus()
      return
    }
    hide()
    if (item.kind === 'file') void openDocument(item.document.path)
    else void openDocument(item.hit.path, [item.hit.start, item.hit.end])
  }

  const emptyKey = tagMode ? 'quickOpen.emptyTags' : 'quickOpen.empty'

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
            setSelected(Math.min(activeIndex + 1, results.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected(Math.max(activeIndex - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            choose(results[activeIndex])
          }
        }}
      />

      <div className="ink-overlay-list">
        {results.length === 0 && (!tagMode || tagQuery) ? <div className="ink-overlay-empty">{t(emptyKey)}</div> : null}

        {results.map((item, index) => {
          const groupKey = GROUP_LABEL[item.kind]
          const startsGroup = groupKey !== undefined && results[index - 1]?.kind !== item.kind
          return (
            <Fragment key={resultKey(item, index)}>
              {startsGroup ? <div className="ink-overlay-group">{t(groupKey)}</div> : null}
              <div
                className="ink-overlay-item"
                data-selected={index === activeIndex}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                {item.kind === 'file' ? (
                  <>
                    <span className="ink-qo-title">{item.document.displayTitle || item.document.fileName}</span>
                    <span className="ink-overlay-sub">{relativeTime(item.document.mtime)}</span>
                  </>
                ) : item.kind === 'tag' ? (
                  <>
                    <span className="truncate">#{item.tag.tag}</span>
                    <span className="ink-overlay-sub">{item.tag.count}</span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{item.hit.snippet}</span>
                    <span className="ink-overlay-sub">
                      {item.hit.fileName}:{item.hit.line}
                    </span>
                  </>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>
    </OverlayShell>
  )
}

function resultKey(item: Result, index: number): string {
  switch (item.kind) {
    case 'file':
      return item.document.path
    case 'tag':
      return `tag:${item.tag.tag}`
    default:
      return `${item.kind}:${item.hit.path}:${item.hit.line}:${index}`
  }
}
