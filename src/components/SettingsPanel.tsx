/**
 * 设置面板（⌘, / 菜单栏「设置…」）
 *
 * 只放「设一次就不常改」的项：外观、语言、写作习惯、文档库。
 * 字体 / 字号 / 栏宽仍在顶栏 Aa 里（写作时随手调），这里不重复。
 */
import { invoke } from '@tauri-apps/api/core'

import { OverlayShell } from './OverlayShell'
import { errorMessage } from '@/lib/errors'
import { useT } from '@/lib/i18n'
import type { AppSettings } from '@/lib/types'
import { useDocumentStore } from '@/stores/documentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const THEME_OPTIONS = [
  ['system', 'settings.theme.system'],
  ['light', 'settings.theme.light'],
  ['dark', 'settings.theme.dark'],
] as const satisfies ReadonlyArray<readonly [AppSettings['theme'], string]>

const LOCALE_OPTIONS = [
  ['system', 'menu.lang.system'],
  ['zh-CN', 'menu.lang.zh'],
  ['en', 'menu.lang.en'],
] as const satisfies ReadonlyArray<readonly [AppSettings['locale'], string]>

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: ReadonlyArray<readonly [V, string]>
  onChange: (value: V) => void
}) {
  const t = useT()
  return (
    <div className="ink-segmented" role="radiogroup" aria-label={label}>
      {options.map(([option, labelKey]) => (
        <button
          key={option}
          role="radio"
          aria-checked={value === option}
          data-active={value === option}
          onClick={() => onChange(option)}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className="ink-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-on={checked}
      onClick={() => onChange(!checked)}
    />
  )
}

export function SettingsPanel() {
  const t = useT()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const hideSettings = useUiStore((state) => state.hideSettings)

  const revealLibrary = async () => {
    try {
      await invoke('reveal_in_finder', { path: settings.libraryPath })
    } catch (error) {
      useUiStore.getState().pushToast({ message: errorMessage(error), kind: 'error' })
    }
  }

  return (
    <OverlayShell
      onClose={hideSettings}
      variant="dialog"
      width={480}
      className="ink-settings-dialog"
      label={t('settings.title')}
    >
      <div className="ink-settings">
        <div className="ink-dialog-title">{t('settings.title')}</div>

        <section className="ink-settings-section">
          <h3>{t('settings.appearance')}</h3>
          <div className="ink-settings-row">
            <span>{t('settings.theme')}</span>
            <Segmented
              label={t('settings.theme')}
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => update({ theme })}
            />
          </div>
          <div className="ink-settings-row">
            <span>{t('menu.language')}</span>
            <Segmented
              label={t('menu.language')}
              value={settings.locale}
              options={LOCALE_OPTIONS}
              onChange={(locale) => update({ locale })}
            />
          </div>
        </section>

        <section className="ink-settings-section">
          <h3>{t('settings.writing')}</h3>
          <div className="ink-settings-row">
            <span>{t('settings.spellcheck')}</span>
            <Switch
              label={t('settings.spellcheck')}
              checked={settings.spellcheck}
              onChange={(spellcheck) => update({ spellcheck })}
            />
          </div>
          <div className="ink-settings-row">
            <span>{t('settings.showMarkup')}</span>
            <Switch
              label={t('settings.showMarkup')}
              checked={settings.showMarkup}
              onChange={(showMarkup) => update({ showMarkup })}
            />
          </div>
          {/* 说明紧跟在它所解释的开关下面，不能放到下一个开关之后 */}
          <p className="ink-settings-hint">{t('settings.showMarkupHint')}</p>
          <div className="ink-settings-row">
            <span>{t('settings.typewriter')}</span>
            <Switch
              label={t('settings.typewriter')}
              checked={settings.typewriterMode}
              onChange={(typewriterMode) => update({ typewriterMode })}
            />
          </div>
          <p className="ink-settings-hint">{t('settings.typographyHint')}</p>
        </section>

        <section className="ink-settings-section">
          <h3>{t('settings.library')}</h3>
          <div className="ink-settings-path" title={settings.libraryPath}>
            {settings.libraryPath}
          </div>
          <div className="ink-settings-actions">
            <button className="ink-button" onClick={() => void revealLibrary()}>
              {t('settings.libraryReveal')}
            </button>
            <button
              className="ink-button"
              onClick={() => void useDocumentStore.getState().changeLibrary()}
            >
              {t('settings.libraryChange')}
            </button>
          </div>
        </section>

        <div className="ink-dialog-actions">
          <button className="ink-button" data-primary="true" onClick={hideSettings}>
            {t('settings.done')}
          </button>
        </div>
      </div>
    </OverlayShell>
  )
}
