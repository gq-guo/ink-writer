import { EditorView, ViewPlugin } from '@codemirror/view'

import { t } from '@/lib/i18n'

/**
 * 搜索面板的装饰性增强（tooltip + 换行占位符）。
 *
 * CM6 把「上一个 / 下一个」等按钮渲染成纯文本图标（我们用 CSS 换成了 SVG 图标），
 * 因此需要补上 title 属性，鼠标悬停时才有可读说明。
 *
 * 注意：面板 DOM 每次打开都是重新创建的，所以要用插件在每次 update 时检查，
 * 而不是指望一次性的初始化。
 */

/** 按钮 / 复选框的 name → i18n key（文案随当前语言） */
const TIP_KEYS: Record<string, string> = {
  prev: 'searchTip.prev',
  next: 'searchTip.next',
  select: 'searchTip.select',
  replace: 'searchTip.replace',
  replaceAll: 'searchTip.replaceAll',
  close: 'searchTip.close',
  case: 'searchTip.case',
  re: 'searchTip.re',
  word: 'searchTip.word',
}

function tipFor(name: string): string | undefined {
  const key = TIP_KEYS[name]
  return key ? t(key) : undefined
}

/** 给搜索面板里的控件补上 title（只补一次） */
export function decorateSearchPanel(panel: HTMLElement): void {
  if (panel.dataset.inkTitled === '1') return
  panel.dataset.inkTitled = '1'

  // <br> 在 flex 容器里会被浏览器忽略，插入一个占满一行的 spacer 来强制换行
  const replaceField = panel.querySelector<HTMLElement>('input[name="replace"]')
  if (replaceField && !panel.querySelector('.ink-search-break')) {
    const spacer = document.createElement('div')
    spacer.className = 'ink-search-break'
    replaceField.before(spacer)
  }

  panel.querySelectorAll<HTMLElement>('button[name]').forEach((button) => {
    const tip = tipFor(button.getAttribute('name') ?? '')
    if (tip) button.title = tip
  })

  panel.querySelectorAll<HTMLInputElement>('label input[type="checkbox"]').forEach((input) => {
    const tip = tipFor(input.name)
    const label = input.closest('label')
    if (tip && label) label.title = tip
  })
}


/** 面板出现时补齐装饰（插件形式，挂在 EditorView 上） */
export const inkSearchPanelPlugin = ViewPlugin.fromClass(
  class {
    view: EditorView

    constructor(view: EditorView) {
      this.view = view
      this.decorate()
    }

    update() {
      this.decorate()
    }

    private decorate() {
      const panel = this.view.dom.querySelector<HTMLElement>('.cm-search.cm-panel')
      if (panel) decorateSearchPanel(panel)
    }
  },
)
