/**
 * Command Palette（spec W4 / 效果图 2 · 7）
 *
 * - 命令按「文件 / 编辑 / 视图 / 模式 / 排版 / 文档」分组，带分区标题
 * - 模糊匹配 + 最近使用置顶；带快捷键的命令右对齐显示快捷键
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { OverlayShell } from './OverlayShell'
import { fuzzyScore } from '@/lib/fuzzy'
import { buildCommands, GROUP_ORDER, type Command, type CommandGroup } from '@/commands/registry'
import { useUiStore } from '@/stores/uiStore'
import { useLocaleStore, useT } from '@/lib/i18n'

interface ScoredCommand {
  command: Command
  score: number
  recent: boolean
}

type Row = { kind: 'header'; group: CommandGroup } | { kind: 'command'; item: ScoredCommand }

export function CommandPalette() {
  const visible = useUiStore((state) => state.paletteVisible)
  const hide = useUiStore((state) => state.hidePalette)
  const recentCommands = useUiStore((state) => state.recentCommands)
  const pushRecentCommand = useUiStore((state) => state.pushRecentCommand)

  const t = useT()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 语言切换时重建命令表（标题需要重新翻译）
  const locale = useLocaleStore((state) => state.locale)
  const commands = useMemo(() => {
    void locale
    return buildCommands()
  }, [locale])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  /** 过滤 + 评分（保持命令注册顺序，组内稳定） */
  const scored = useMemo<ScoredCommand[]>(() => {
    const available = commands.filter((command) => !command.hideInPalette && (command.when?.() ?? true))
    const trimmed = query.trim()

    return available.flatMap((command, index) => {
      const recent = recentCommands.includes(command.id)
      if (!trimmed) return [{ command, score: index, recent }]
      const hit = fuzzyScore(trimmed, command.title)
      if (!hit) return []
      return [{ command, score: hit.score + (recent ? 1000 : 0), recent }]
    })
  }, [commands, query, recentCommands])

  /** 按分组组装行（分区标题 + 命令） */
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = []
    for (const group of GROUP_ORDER) {
      const items = scored.filter((item) => item.command.group === group)
      if (items.length === 0) continue
      // 有查询时按评分排序（最近使用置顶已由分数体现）；无查询保持注册顺序
      if (query.trim()) items.sort((a, b) => b.score - a.score)
      result.push({ kind: 'header', group })
      for (const item of items) result.push({ kind: 'command', item })
    }
    return result
  }, [scored, query])

  const commandRows = rows.filter((row) => row.kind === 'command') as Extract<Row, { kind: 'command' }>[]

  if (!visible) return null

  const runSelected = () => {
    const target = commandRows[selected]
    if (!target) return
    hide()
    pushRecentCommand(target.item.command.id)
    void target.item.command.run()
  }

  let commandIndex = -1

  return (
    <OverlayShell onClose={hide} label="Command Palette">
      <input
        ref={inputRef}
        className="ink-overlay-input"
        placeholder={t('palette.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelected((index) => Math.min(index + 1, commandRows.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            runSelected()
          }
        }}
      />

      <div className="ink-overlay-list">
        {commandRows.length === 0 ? (
          <div className="ink-overlay-empty">{t('palette.empty')}</div>
        ) : null}
        {rows.map((row) => {
          if (row.kind === 'header') {
            return (
              <div key={`group-${row.group}`} className="ink-overlay-group">
                {t(`palette.group.${row.group}`)}
              </div>
            )
          }
          commandIndex += 1
          const index = commandIndex
          const { command, recent } = row.item
          return (
            <div
              key={command.id}
              className="ink-overlay-item"
              data-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onClick={() => {
                hide()
                pushRecentCommand(command.id)
                void command.run()
              }}
            >
              <span className="truncate">
                {recent ? '⟳ ' : ''}
                {command.title}
              </span>
              {command.shortcut ? (
                <span className="ink-overlay-sub">{command.shortcut}</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </OverlayShell>
  )
}
