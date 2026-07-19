const ARABIC_NORMALIZE_MAP: Record<string, string> = {
  '\u0627': '\u0627', // alef → alef (keep)
  '\u0623': '\u0627', // alef with hamza above → alef
  '\u0625': '\u0627', // alef with hamza below → alef
  '\u0622': '\u0627', // alef with madda → alef
  '\u0629': '\u0647', // ta marbuta → ha
  '\u0649': '\u064a', // alef maqsura → ya
  '\u0621': '\u0648', // hamza → waw
  '\u0624': '\u0648', // waw with hamza → waw
  '\u0626': '\u064a', // ya with hamza → ya
}

const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g
const TATWEEL_RE = /\u0640/g
const MULTIPLE_SPACES_RE = /\s+/g

export function normalizeArabic(text: string): string {
  let result = ''
  for (const ch of text) {
    result += ARABIC_NORMALIZE_MAP[ch] || ch
  }
  return result
    .replace(ARABIC_DIACRITICS_RE, '')
    .replace(TATWEEL_RE, '')
    .toLowerCase()
    .replace(MULTIPLE_SPACES_RE, ' ')
    .trim()
}

export interface ProductSearchIndex {
  id: string
  code: string
  name: string
  companyName: string
  normalizedName: string
  normalizedCode: string
  normalizedCompany: string
  codeTokens: string[]
  nameTokens: string[]
}

export function buildSearchIndex(product: {
  id: string
  legacyCode?: string
  productName: string
  companyName?: string
}): ProductSearchIndex {
  const code = (product.legacyCode || '').toLowerCase()
  const name = product.productName
  const company = product.companyName || ''
  const normalizedName = normalizeArabic(name)
  const normalizedCode = normalizeArabic(code)
  const normalizedCompany = normalizeArabic(company)
  const codeTokens = normalizedCode ? normalizedCode.split(' ').filter(Boolean) : []
  const nameTokens = normalizedName.split(' ').filter(Boolean)
  return {
    id: product.id,
    code,
    name,
    companyName: company,
    normalizedName,
    normalizedCode,
    normalizedCompany,
    codeTokens,
    nameTokens,
  }
}

function bestQualityForToken(qt: string, tokens: string[]): number {
  let best = 3
  for (const t of tokens) {
    if (t === qt) return 0
    if (t.startsWith(qt) && best > 1) best = 1
    if (t.includes(qt) && best > 2) best = 2
  }
  return best
}

function rankIndex(qNorm: string, qTokens: string[], idx: ProductSearchIndex): number {
  const totalTokens = qTokens.length

  if (idx.normalizedCode === qNorm) return 0
  if (idx.normalizedCode.startsWith(qNorm)) return 1
  if (idx.normalizedCode.includes(qNorm)) return 2
  if (idx.normalizedName === qNorm) return 10
  if (idx.normalizedName.startsWith(qNorm)) return 11
  if (idx.normalizedName.includes(qNorm)) return 12

  let matchedCount = 0
  let hasTextMatch = false
  let worstQuality = 0

  for (const qt of qTokens) {
    const codeQ = bestQualityForToken(qt, idx.codeTokens)
    const nameQ = bestQualityForToken(qt, idx.nameTokens)
    const q = codeQ <= nameQ ? codeQ : nameQ
    if (q < 3) {
      matchedCount++
      if (q > worstQuality) worstQuality = q
      if (nameQ < 3 && !/^\d+$/.test(qt)) hasTextMatch = true
    }
  }

  if (matchedCount === 0) {
    if (idx.normalizedCompany) {
      if (idx.normalizedCompany === qNorm) return 800
      if (idx.normalizedCompany.startsWith(qNorm)) return 810
      if (idx.normalizedCompany.includes(qNorm)) return 820
    }
    return 999
  }

  if (matchedCount === totalTokens) return 20 + worstQuality

  return 200 - matchedCount * 50 - (hasTextMatch ? 10 : 0) + worstQuality
}

export function searchProducts<T extends { id: string }>(
  query: string,
  items: T[],
  getIndex: (item: T) => ProductSearchIndex,
): T[] {
  const q = query.trim()
  if (!q) return items

  const qNorm = normalizeArabic(q)
  const qTokens = q.split(/\s+/).filter(Boolean).map(normalizeArabic)

  const scored: { item: T; rank: number }[] = []
  for (const item of items) {
    const idx = getIndex(item)
    const rank = rankIndex(qNorm, qTokens, idx)
    if (rank < 999) {
      scored.push({ item, rank })
    }
  }

  scored.sort((a, b) => a.rank - b.rank)
  return scored.map((s) => s.item)
}
