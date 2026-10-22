/**
 * 排版弹层（顶栏的 Aa 按钮）
 *
 * 写作字体 / 字号 / 行高 —— 效果图里的 "Aa" 入口。
 * 改动即时生效（只改 CSS variables，不重建 EditorView）。
 */
import { useSettingsStore, FONT_STACKS } from '@/stores/settingsStore'
import type { AppSettings } from '@/lib/types'

const FONT_LABELS: Record<AppSettings['fontFamily'], string> = {
  system: '系统字体',
  quattro: 'iA Writer Quattro',
  plex: 'IBM Plex Sans',
  serif: '衬线体',
  mono: '等宽字体',
}

export function TypographyPopover({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)

  return (
    <div className="ink-popover" role="dialog" aria-label="排版">
      <div className="ink-popover-title">写作字体</div>
      <div className="ink-font-list">
        {(Object.keys(FONT_LABELS) as AppSettings['fontFamily'][]).map((family) => (
          <button
            key={family}
            className="ink-font-item"
            data-active={settings.fontFamily === family}
            style={{ fontFamily: FONT_STACKS[family] }}
            onClick={() => update({ fontFamily: family })}
          >
            {FONT_LABELS[family]}
          </button>
        ))}
      </div>

      <div className="ink-popover-row">
        <span>字号</span>
        <div className="ink-stepper">
          <button onClick={() => update({ fontSize: settings.fontSize - 1 })}>−</button>
          <span>{settings.fontSize}px</span>
          <button onClick={() => update({ fontSize: settings.fontSize + 1 })}>+</button>
        </div>
      </div>

      <div className="ink-popover-row">
        <span>行高</span>
        <div className="ink-stepper">
          <button
            onClick={() =>
              update({
                lineHeight: Number(Math.max(1.4, settings.lineHeight - 0.1).toFixed(2)),
              })
            }
          >
            −
          </button>
          <span>{settings.lineHeight.toFixed(1)}</span>
          <button
            onClick={() =>
              update({
                lineHeight: Number(Math.min(2, settings.lineHeight + 0.1).toFixed(2)),
              })
            }
          >
            +
          </button>
        </div>
      </div>

      <div className="ink-popover-row">
        <span>栏宽</span>
        <div className="ink-stepper">
          <button onClick={() => update({ contentWidth: settings.contentWidth - 40 })}>−</button>
          <span>{settings.contentWidth}px</span>
          <button onClick={() => update({ contentWidth: settings.contentWidth + 40 })}>+</button>
        </div>
      </div>

      <button className="ink-popover-close" onClick={onClose}>
        完成
      </button>
    </div>
  )
}
