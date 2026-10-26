/**
 * 排版弹层（顶栏的 Aa 按钮）
 *
 * 写作字体 / 字号 / 行高 —— 效果图里的 "Aa" 入口。
 * 改动即时生效（只改 CSS variables，不重建 EditorView）。
 */
import { useEffect } from 'react'
import { useSettingsStore, FONT_STACKS } from '@/stores/settingsStore'
import { useT } from '@/lib/i18n'
import type { AppSettings } from '@/lib/types'

const FONT_LABEL_KEYS: Record<AppSettings['fontFamily'], string> = {
  system: 'type.font.system',
  quattro: 'type.font.quattro',
  serif: 'type.font.serif',
  noto: 'type.font.noto',
  wenkai: 'type.font.wenkai',
  mono: 'type.font.mono',
}

export function TypographyPopover({ onClose }: { onClose: () => void }) {
  const t = useT()

  // Esc 关闭（替代已删除的 Done 按钮；选项即时生效，无需「确认」）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [onClose])
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)

  return (
    <div className="ink-popover" role="dialog" aria-label={t('topbar.typography')}>
      <div className="ink-popover-title">{t('type.title')}</div>
      <div className="ink-font-list">
        {(Object.keys(FONT_LABEL_KEYS) as AppSettings['fontFamily'][]).map((family) => (
          <button
            key={family}
            className="ink-font-item"
            data-active={settings.fontFamily === family}
            style={{ fontFamily: FONT_STACKS[family] }}
            onClick={() => update({ fontFamily: family })}
          >
            {t(FONT_LABEL_KEYS[family])}
          </button>
        ))}
      </div>

      <div className="ink-popover-row">
        <span>{t('type.fontSize')}</span>
        <div className="ink-stepper">
          <button onClick={() => update({ fontSize: settings.fontSize - 1 })}>−</button>
          <span>{settings.fontSize}px</span>
          <button onClick={() => update({ fontSize: settings.fontSize + 1 })}>+</button>
        </div>
      </div>

      <div className="ink-popover-row">
        <span>{t('type.lineHeight')}</span>
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
        <span>{t('type.columnWidth')}</span>
        <div className="ink-stepper">
          <button onClick={() => update({ contentWidth: settings.contentWidth - 40 })}>−</button>
          <span>{settings.contentWidth}px</span>
          <button onClick={() => update({ contentWidth: settings.contentWidth + 40 })}>+</button>
        </div>
      </div>

    </div>
  )
}
