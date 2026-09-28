/**
 * Server-paged export fetch.
 *
 * Replaces the old `p_per_page: 10000` "fetch everything in one request"
 * pattern. That number was a silent ceiling: a filtered result set larger
 * than 10,000 rows produced a workbook/print/PDF whose own "total" cell was
 * derived from the returned row count, so a truncated export looked complete.
 *
 * This walks the SAME server-side page/count contract the screen already uses
 * until every matching row has been collected, so an export is always the
 * complete matching dataset:
 *
 *   count = 1      -> 1 request,  1 row
 *   count = 19     -> 1 request, 19 rows
 *   count = 20     -> 1 request, 20 rows
 *   count = 21     -> 2 requests, 21 rows
 *   count = 2,359  -> 118 requests, 2,359 rows
 *
 * The page size used for the walk is the screen's own page size, so the export
 * requests are identical in shape to normal browsing. Nothing is filtered,
 * sorted or sliced in the browser.
 *
 * If the server returns fewer rows than its own count promised (a shrinking
 * result set mid-walk, or a server-side cap), that is surfaced as an explicit
 * error instead of silently producing a short file.
 */

/** Page size used for the export walk. Matches the 20-row screen model. */
export const EXPORT_PAGE_SIZE = 20

/**
 * Hard stop so a bug can never spin forever. At 20 rows per page this is
 * 200,000 rows; a filtered set anywhere near that size should fail loudly
 * rather than loop. Callers treat a hit as a truncation error.
 */
const MAX_EXPORT_ROWS = 200_000

export interface PagedExportResult {
  rows: any[]
  /** True when the walk stopped before reaching the server's count. */
  truncated: boolean
  /**
   * The server's authoritative match count, or `null` when the RPC exposes no
   * count mode. Present on truncation so the caller can report how much of the
   * set was actually collected versus what the server said existed.
   */
  total: number | null
  /** Human-readable reason, present only when `truncated` is true. */
  reason?: string
  /** Number of round trips performed. */
  requests: number
}

type CountFn = (page: number, perPage: number) => Promise<{ count: number } | null>

/**
 * Walk every page of a governed list RPC and return all matching rows.
 *
 * @param fetchPage  calls the RPC for one page and returns that page's rows
 * @param fetchCount calls the RPC in count-only mode and returns the total,
 *                   or null when the RPC has no count mode (in which case the
 *                   walk stops on the first short page)
 */
export async function fetchAllMatchingPaged(
  fetchPage: (page: number, perPage: number) => Promise<any[]>,
  fetchCount: (page: number, perPage: number) => Promise<{ count: number } | null>,
  perPage: number = EXPORT_PAGE_SIZE,
): Promise<PagedExportResult> {
  const pageSize = Math.max(1, perPage)
  const rows: any[] = []
  const seen = new Set<string>()
  let requests = 0
  let total: number | null = null

  const countEnvelope = await fetchCount(1, pageSize)
  requests++
  if (countEnvelope && typeof countEnvelope.count === 'number' && Number.isFinite(countEnvelope.count)) {
    total = Math.max(0, Math.floor(countEnvelope.count))
  }

  if (total === 0) {
    return { rows: [], total: 0, truncated: false, requests }
  }

  // Without a server count we cannot prove completeness, so stop at the first
  // short page and report it as a potential truncation.
  if (total === null) {
    for (let page = 1; page <= Math.ceil(MAX_EXPORT_ROWS / pageSize); page++) {
      const batch = await fetchPage(page, pageSize)
      requests++
      for (const row of batch) {
        const id = row?.id
        if (id != null) {
          if (seen.has(id)) continue
          seen.add(id)
        }
        rows.push(row)
      }
      if (batch.length < pageSize) {
        return { rows, total: null, truncated: false, requests }
      }
    }
    return {
      rows,
      total: null,
      truncated: true,
      reason: `التصدير تجاوز الحد الأقصى للأمان (${MAX_EXPORT_ROWS.toLocaleString('en-US')} صف)`,
      requests,
    }
  }

  // Refuse an oversized export up front rather than after thousands of
  // round-trips. The server count is authoritative, so this is known
  // before any data page is requested.
  if (total > MAX_EXPORT_ROWS) {
    return {
      rows: [],
      total,
      truncated: true,
      reason: `عدد النتائج (${total.toLocaleString('en-US')}) يتجاوز الحد الأقصى للأمان (${MAX_EXPORT_ROWS.toLocaleString('en-US')}) — تم إيقاف التصدير`,
      requests,
    }
  }

  const totalPages = Math.ceil(total / pageSize)
  for (let page = 1; page <= totalPages; page++) {
    if (rows.length >= MAX_EXPORT_ROWS) {
      return {
        rows,
        total,
        truncated: true,
        reason: `التصدير تجاوز الحد الأقصى للأمان (${MAX_EXPORT_ROWS.toLocaleString('en-US')} صف)`,
        requests,
      }
    }
    const batch = await fetchPage(page, pageSize)
    requests++
    if (!Array.isArray(batch) || batch.length === 0) {
      return {
        rows,
        total,
        truncated: true,
        reason: `توقف التصدير عند الصفحة ${page} من ${totalPages} — الخادم لم يعد ببيانات كافية`,
        requests,
      }
    }
    for (const row of batch) {
      const id = row?.id
      if (id != null) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      rows.push(row)
    }
  }

  if (rows.length < total) {
    return {
      rows,
      total,
      truncated: true,
      reason: `تم استلام ${rows.length} من ${total} صف — تم إيقاف التصدير لمنع بيانات ناقصة`,
      requests,
    }
  }

  return { rows, total, truncated: false, requests }
}
