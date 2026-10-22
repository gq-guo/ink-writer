/**
 * 搜索面板文案（CM6 的 `EditorState.phrases` facet）
 *
 * @codemirror/search 内部用 `phrase(view, "next")` 之类的键取文案，
 * 注册同名键即可把面板本地化。放在 Compartment 里，切换语言时重配。
 */
import { Compartment, EditorState } from '@codemirror/state'

import { type Locale } from '@/lib/i18n'

export function makeSearchPhrases(locale: Locale) {
  const zh = locale === 'zh-CN'
  return EditorState.phrases.of({
    Find: zh ? '查找' : 'Find',
    Replace: zh ? '替换为' : 'Replace',
    next: zh ? '下一个' : 'next',
    previous: zh ? '上一个' : 'previous',
    all: zh ? '全部选中' : 'all',
    replace: zh ? '替换' : 'replace',
    'replace all': zh ? '全部替换' : 'replace all',
    'match case': zh ? '区分大小写' : 'match case',
    regexp: zh ? '正则' : 'regexp',
    'by word': zh ? '全词' : 'by word',
    close: zh ? '关闭' : 'close',
  })
}

/** 语言切换时重配（EditorHost 负责 dispatch） */
export const searchPhrasesCompartment = new Compartment()
