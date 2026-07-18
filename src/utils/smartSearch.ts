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

export function tokenize(text: string): string[] {
  return normalizeArabic(text).split(' ').filter(Boolean)
}

export interface ProductSearchIndex {
  id: string
  code: string
  name: string
  companyName: string
  normalizedName: string
  normalizedCode: string
  normalizedCompany: string
  tokens: string[]
  tokenSet: Set<string>
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
  const tokenStr = `${normalizedName} ${normalizedCode} ${normalizedCompany}`
  const tokens = tokenStr.split(' ').filter(Boolean)
  return {
    id: product.id,
    code,
    name,
    companyName: company,
    normalizedName,
    normalizedCode,
    normalizedCompany,
    tokens,
    tokenSet: new Set(tokens),
  }
}

const RANK = {
  CODE_EXACT: 0,
  CODE_STARTS: 1,
  CODE_PARTIAL: 2,
  NAME_EXACT: 3,
  NAME_STARTS: 4,
  TOKEN_STARTS: 5,
  NAME_PARTIAL: 6,
  TOKEN_PARTIAL: 7,
  NO_MATCH: 99,
} as const

function rankIndex(qNorm: string, qTokens: string[], idx: ProductSearchIndex): number {
  if (idx.normalizedCode === qNorm) return RANK.CODE_EXACT
  if (idx.normalizedCode.startsWith(qNorm)) return RANK.CODE_STARTS
  if (idx.normalizedCode.includes(qNorm)) return RANK.CODE_PARTIAL

  for (const qt of qTokens) {
    if (idx.normalizedCode === qt || idx.normalizedCode.includes(qt)) return RANK.CODE_PARTIAL
  }

  if (idx.normalizedName === qNorm) return RANK.NAME_EXACT
  if (idx.normalizedName.startsWith(qNorm)) return RANK.NAME_STARTS
  if (idx.normalizedName.includes(qNorm)) return RANK.NAME_PARTIAL

  for (const qt of qTokens) {
    for (const t of idx.tokens) {
      if (t.startsWith(qt)) return RANK.TOKEN_STARTS
    }
  }

  for (const qt of qTokens) {
    for (const t of idx.tokens) {
      if (t.includes(qt)) return RANK.TOKEN_PARTIAL
    }
  }

  return RANK.NO_MATCH
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
    if (rank < RANK.NO_MATCH) scored.push({ item, rank })
  }

  scored.sort((a, b) => a.rank - b.rank)
  return scored.map((s) => s.item)
}
