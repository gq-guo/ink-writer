import { describe, expect, it } from 'vitest'
import { countStatistics, countChunk, countSentences, splitIntoChunks } from '@/lib/statistics'

describe('统计算法（R4 / spec §16）', () => {
  it('中文每字计 1', () => {
    const stats = countStatistics('你好世界')
    expect(stats.cjkChars).toBe(4)
    expect(stats.words).toBe(4)
  })

  it('西文按词计数', () => {
    const stats = countStatistics('hello brave new world')
    expect(stats.latinWords).toBe(4)
    expect(stats.cjkChars).toBe(0)
    expect(stats.words).toBe(4)
  })

  it('中英混排分别计数后相加', () => {
    const stats = countStatistics('你好 world')
    expect(stats.cjkChars).toBe(2)
    expect(stats.latinWords).toBe(1)
    expect(stats.words).toBe(3)
  })

  it('字符数不含空白', () => {
    const stats = countStatistics('a b\tc\n d')
    expect(stats.characters).toBe(4)
  })

  it('段落按空行切分', () => {
    const stats = countStatistics('第一段\n\n第二段\n\n\n第三段')
    expect(stats.paragraphs).toBe(3)
  })

  it('句子数按中英文句末标点切分', () => {
    expect(countStatistics('一句话。第二句！第三句？').sentences).toBe(3)
    expect(countStatistics('Hello world. How are you?').sentences).toBe(2)
    expect(countStatistics('没有句号的一段话').sentences).toBe(1)
  })

  it('空行也算一句的边界（与分片统计口径一致）', () => {
    expect(countSentences('第一段\n\n第二段')).toBe(2)
  })

  it('阅读时长 = CJK/400 + 西文/200，向上取整且最小 1', () => {
    expect(countStatistics('短').readingMinutes).toBe(1)
    expect(countStatistics('字'.repeat(401)).readingMinutes).toBe(2)
    expect(countStatistics('word '.repeat(201)).readingMinutes).toBe(2)
  })

  it('分片统计之和等于整体统计', () => {
    const text = `${'第一段内容\n\n'.repeat(50)}tail`
    const chunks = splitIntoChunks(text, 64)
    const merged = chunks.reduce(
      (acc, chunk) => {
        const part = countChunk(chunk)
        return {
          cjkChars: acc.cjkChars + part.cjkChars,
          latinWords: acc.latinWords + part.latinWords,
          characters: acc.characters + part.characters,
          paragraphs: acc.paragraphs + part.paragraphs,
          sentences: acc.sentences + part.sentences,
        }
      },
      { cjkChars: 0, latinWords: 0, characters: 0, paragraphs: 0, sentences: 0 },
    )
    const whole = countChunk(text)
    expect(merged).toEqual(whole)
  })
})
