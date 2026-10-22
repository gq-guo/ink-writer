/**
 * 搜索面板文案（CM6 的 `EditorState.phrases` facet）
 *
 * @codemirror/search 内部用 `phrase(view, "next")` 之类的键取文案，
 * 注册同名键即可把面板整体本地化。
 */
import { EditorState } from '@codemirror/state'

export const searchPhrases = EditorState.phrases.of({
  Find: '查找',
  Replace: '替换为',
  next: '下一个',
  previous: '上一个',
  all: '全部选中',
  replace: '替换',
  'replace all': '全部替换',
  'match case': '大小写',
  regexp: '正则',
  'by word': '全词',
  close: '关闭',
})
