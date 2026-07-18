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

const RANK = {
  CODE_EXACT: 0,
  CODE_STARTS: 1,
  CODE_PARTIAL: 2,
  CODE_TOKEN_EXACT: 3,
  CODE_TOKEN_STARTS: 4,
  CODE_TOKEN_PARTIAL: 5,
  NAME_EXACT: 10,
  NAME_STARTS: 11,
  NAME_PARTIAL: 12,
  ALL_TOKENS_EXACT: 20,
  ALL_TOKENS_STARTS: 21,
  TOKEN_STARTS: 30,
  TOKEN_PARTIAL: 31,
  COMPANY_EXACT: 40,
  COMPANY_STARTS: 41,
  COMPANY_PARTIAL: 42,
  NO_MATCH: 99,
} as const

function allTokensMatch(
  qTokens: string[],
  targetTokens: string[],
  mode: 'exact' | 'starts' | 'partial',
): boolean {
  if (qTokens.length === 0) return false
  for (const qt of qTokens) {
    let found = false
    for (const tt of targetTokens) {
      if (mode === 'exact' && tt === qt) { found = true; break }
      if (mode === 'starts' && tt.startsWith(qt)) { found = true; break }
      if (mode === 'partial' && tt.includes(qt)) { found = true; break }
    }
    if (!found) return false
  }
  return true
}

function rankIndex(qNorm: string, qTokens: string[], idx: ProductSearchIndex): number {
  // Level 1: Code (full query vs code)
  if (idx.normalizedCode === qNorm) return RANK.CODE_EXACT
  if (idx.normalizedCode.startsWith(qNorm)) return RANK.CODE_STARTS
  if (idx.normalizedCode.includes(qNorm)) return RANK.CODE_PARTIAL

  // Level 2: Code tokens
  for (const qt of qTokens) {
    for (const ct of idx.codeTokens) {
      if (ct === qt) return RANK.CODE_TOKEN_EXACT
    }
  }
  for (const qt of qTokens) {
    for (const ct of idx.codeTokens) {
      if (ct.startsWith(qt)) return RANK.CODE_TOKEN_STARTS
    }
  }
  for (const qt of qTokens) {
    for (const ct of idx.codeTokens) {
      if (ct.includes(qt)) return RANK.CODE_TOKEN_PARTIAL
    }
  }

  // Level 3: Name (full query vs name)
  if (idx.normalizedName === qNorm) return RANK.NAME_EXACT
  if (idx.normalizedName.startsWith(qNorm)) return RANK.NAME_STARTS
  if (idx.normalizedName.includes(qNorm)) return RANK.NAME_PARTIAL

  // Level 4: ALL query tokens found in name tokens
  if (allTokensMatch(qTokens, idx.nameTokens, 'exact')) return RANK.ALL_TOKENS_EXACT
  if (allTokensMatch(qTokens, idx.nameTokens, 'starts')) return RANK.ALL_TOKENS_STARTS

  // Level 5: Single token matches
  for (const qt of qTokens) {
    for (const nt of idx.nameTokens) {
      if (nt.startsWith(qt)) return RANK.TOKEN_STARTS
    }
  }
  for (const qt of qTokens) {
    for (const nt of idx.nameTokens) {
      if (nt.includes(qt)) return RANK.TOKEN_PARTIAL
    }
  }

  // Level 6: Company name
  if (idx.normalizedCompany) {
    if (idx.normalizedCompany === qNorm) return RANK.COMPANY_EXACT
    if (idx.normalizedCompany.startsWith(qNorm)) return RANK.COMPANY_STARTS
    if (idx.normalizedCompany.includes(qNorm)) return RANK.COMPANY_PARTIAL
  }

  return RANK.NO_MATCH
}

function countExactTokenMatches(qTokens: string[], nameTokens: string[]): number {
  let count = 0
  for (const qt of qTokens) {
    for (const nt of nameTokens) {
      if (nt === qt) { count++; break }
    }
  }
  return count
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

  const scored: { item: T; rank: number; exactMatches: number }[] = []
  for (const item of items) {
    const idx = getIndex(item)
    const rank = rankIndex(qNorm, qTokens, idx)
    if (rank < RANK.NO_MATCH) {
      scored.push({ item, rank, exactMatches: countExactTokenMatches(qTokens, idx.nameTokens) })
    }
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    return b.exactMatches - a.exactMatches
  })
  return scored.map((s) => s.item)
}
