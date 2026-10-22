/**
 * 统计算法（R4 / spec §16.1）
 *
 * - CJK 每字计 1
 * - 西文按空白分词计词
 * - 阅读时长 = CJK/400 + 西文/200 分钟，向上取整，最小 1
 * - 字符数不含空白
 */
import type { DocumentStatistics } from './types'

export const CJK_PATTERN =
  /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\u30a0-\u30ff\uac00-\ud7af\u3000-\u303f\uff01-\uff5e]/

const CJK_GLOBAL = new RegExp(CJK_PATTERN.source, 'g')
const WHITESPACE = /\s/
const WORD_CHAR = /[\p{L}\p{N}]/u

/** 分片统计的中间结果 */
export interface ChunkStatistics {
  cjkChars: number
  latinWords: number
  characters: number
  paragraphs: number
  sentences: number
}

export const EMPTY_CHUNK: ChunkStatistics = {
  cjkChars: 0,
  latinWords: 0,
  characters: 0,
  paragraphs: 0,
  sentences: 0,
}

/**
 * 统计一段文本。
 * 为了支持分片计算，段落按「空行」切分，跨片的段落不会被重复计数。
 */
export function countChunk(text: string): ChunkStatistics {
  let cjk = 0
  let characters = 0

  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) {
      cjk++
      characters++
    } else if (!WHITESPACE.test(ch)) {
      characters++
    }
  }

  const latinWords = text
    .replace(CJK_GLOBAL, ' ')
    .split(/\s+/)
    .filter((w) => WORD_CHAR.test(w)).length

  const paragraphs = text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0).length

  const sentences = countSentences(text)

  return { cjkChars: cjk, latinWords, characters, paragraphs, sentences }
}

/**
 * 句子数：按中英文句末标点切分，空行也算一句的边界。
 * 空行同时作为边界，是为了让「分片统计」与「整体统计」结果一致
 * （分片正是按空行切开的）。
 */
export function countSentences(text: string): number {
  return text
    .split(/[.!?。！？…]+[\s"'”’」』）)]*|\n\s*\n/)
    .filter((part) => part.trim().length > 0).length
}

export function mergeChunks(chunks: ChunkStatistics[]): ChunkStatistics {
  return chunks.reduce<ChunkStatistics>(
    (acc, chunk) => ({
      cjkChars: acc.cjkChars + chunk.cjkChars,
      latinWords: acc.latinWords + chunk.latinWords,
      characters: acc.characters + chunk.characters,
      paragraphs: acc.paragraphs + chunk.paragraphs,
      sentences: acc.sentences + chunk.sentences,
    }),
    { ...EMPTY_CHUNK },
  )
}

/** 把文本切成若干块，优先在段落边界处断开，避免跨片重复计数 */
export function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + chunkSize)
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end)
      if (boundary > start) end = boundary + 2
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

export function toDocumentStatistics(chunk: ChunkStatistics): DocumentStatistics {
  const readingMinutes = Math.max(1, Math.ceil(chunk.cjkChars / 400 + chunk.latinWords / 200))
  return {
    words: chunk.cjkChars + chunk.latinWords,
    cjkChars: chunk.cjkChars,
    latinWords: chunk.latinWords,
    characters: chunk.characters,
    paragraphs: chunk.paragraphs,
    sentences: chunk.sentences,
    readingMinutes,
  }
}

export function countStatistics(text: string): DocumentStatistics {
  return toDocumentStatistics(countChunk(text))
}

export const EMPTY_STATISTICS: DocumentStatistics = toDocumentStatistics(EMPTY_CHUNK)
