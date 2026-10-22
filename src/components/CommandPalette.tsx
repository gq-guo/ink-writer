/**
 * Command Palette（spec W4 / §11.3）
 *
 * 结构与 Quick Open 相同；模糊匹配 + 最近使用置顶；带快捷键的命令右对齐显示快捷键。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { OverlayShell } from './OverlayShell'
import { fuzzyScore } from '@/lib/fuzzy'
import { buildCommands, type Command } from '@/commands/registry'
import { useUiStore } from '@/stores/uiStore'

interface ScoredCommand {
  command: Command
  score: number
  recent: boolean
}

export function CommandPalette() {
  const visible = useUiStore((state) => state.paletteVisible)
  const hide = useUiStore((state) => state.hidePalette)
  const recentCommands = useUiStore((state) => state.recentCommands)
  const pushRecentCommand = useUiStore((state) => state.pushRecentCommand)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const commands = useMemo(() => buildCommands(), [])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  const results = useMemo<ScoredCommand[]>(() => {
    const available = commands.filter((command) => command.when?.() ?? true)
    const trimmed = query.trim()

    const scored: ScoredCommand[] = []
    for (const command of available) {
      const recent = recentCommands.includes(command.id)
      if (!trimmed) {
        scored.push({ command, score: 0, recent })
        continue
      }
      const hit = fuzzyScore(trimmed, command.title)
      if (!hit) continue
      scored.push({ command, score: hit.score + (recent ? 1000 : 0), recent })
    }

    scored.sort((a, b) => {
      if (a.recent !== b.recent) return a.recent ? -1 : 1
      return b.score - a.score
    })
    return scored
  }, [commands, query, recentCommands])

  if (!visible) return null

  const runSelected = () => {
    const item = results[selected]
    if (!item) return
    hide()
    pushRecentCommand(item.command.id)
    void item.command.run()
  }

  return (
    <OverlayShell onClose={hide} label="Command Palette">
      <input
        ref={inputRef}
        className="ink-overlay-input"
        placeholder="Type a command..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelected((index) => Math.min(index + 1, results.length - 1))
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
        {results.length === 0 ? (
          <div className="ink-overlay-empty">No matching commands</div>
        ) : null}
        {results.map((item, index) => (
          <div
            key={item.command.id}
            className="ink-overlay-item"
            data-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => {
              hide()
              pushRecentCommand(item.command.id)
              void item.command.run()
            }}
          >
            <span className="truncate">
              {item.recent ? '⟳ ' : ''}
              {item.command.title}
            </span>
            {item.command.shortcut ? (
              <span className="ink-overlay-sub">{item.command.shortcut}</span>
            ) : null}
          </div>
        ))}
      </div>
    </OverlayShell>
  )
}
