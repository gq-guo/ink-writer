/**
 * fzf 风格模糊评分（R9 / spec §14.1）
 *
 * - 连续子序列匹配 +10/字符
 * - 匹配落在词首（空格、`-`、`_`、`/`、大小写边界之后）+8
 * - 不匹配字符 -1/字符
 * - 同分时按 mtime 近者优先
 */

const WORD_BOUNDARY = /[\s\-_/\\.]/

export interface FuzzyResult {
  score: number
  /** 命中位置 */
  positions: number[]
}

export function fuzzyScore(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }

  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let score = 0
  let ti = 0
  const positions: number[] = []
  let previousMatch = -1

  for (const qc of q) {
    const found = t.indexOf(qc, ti)
    // 所有查询字符都必须按顺序出现，否则视为不匹配
    if (found === -1) return null

    let charScore = 10
    if (found === previousMatch + 1) {
      charScore += 6 // 连续匹配额外加分
    }
    if (found === 0 || WORD_BOUNDARY.test(t[found - 1] ?? '') || isCaseBoundary(target, found)) {
      charScore += 8 // 词首
    }
    score += charScore
    positions.push(found)
    previousMatch = found
    ti = found + 1
  }

  if (positions.length === 0) return null
  return { score, positions }
}

function isCaseBoundary(target: string, index: number): boolean {
  const prev = target[index - 1]
  const cur = target[index]
  if (!prev || !cur) return false
  return prev === prev.toLowerCase() && cur === cur.toUpperCase()
}

/**
 * 查询按 `/` 分段，每段分别匹配，段命中按路径匹配加权。
 * 用于 `pro/read` 命中 `Project/README.md`。
 */
export function fuzzyScorePath(query: string, title: string, relativePath: string): FuzzyResult | null {
  const segments = query.split('/').filter(Boolean)
  if (segments.length === 0) return { score: 0, positions: [] }

  let total = 0
  const positions: number[] = []
  let matchedInTitle = false

  for (const segment of segments) {
    const titleHit = fuzzyScore(segment, title)
    const pathHit = fuzzyScore(segment, relativePath)
    if (!titleHit && !pathHit) return null
    if (titleHit) {
      total += titleHit.score
      matchedInTitle = true
    } else if (pathHit) {
      total += pathHit.score * 0.6
    }
  }

  return { score: total, positions: matchedInTitle ? positions : [] }
}
