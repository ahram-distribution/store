// Regression tests for the paged export walker.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllMatchingPaged, EXPORT_PAGE_SIZE, type PagedExportResult } from '../pagedExport.ts'

const PAGE = EXPORT_PAGE_SIZE

// Build n fake rows, and a fetchPage/fetchCount pair over them.
function makeSource(n: number, perPage = PAGE) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `row-${i + 1}`, v: i }))
  const calls: number[] = []
  const counts: number[] = []
  const fetchPage = async (page: number, pp: number) => {
    calls.push(page)
    const start = (page - 1) * pp
    return rows.slice(start, start + pp)
  }
  const fetchCount = async (page: number, pp: number) => {
    counts.push(page)
    return { count: rows.length }
  }
  return { rows, calls, counts, fetchPage, fetchCount }
}

describe('fetchAllMatchingPaged', () => {
  it('uses the screen page size, never a large export page size', () => {
    assert.equal(PAGE, 20)
  })

  it('collects every row across multiple pages', async () => {
    const s = makeSource(95)
    const r: PagedExportResult = await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.equal(r.rows.length, 95)
    assert.equal(r.truncated, false)
    assert.equal(r.total, 95)
    assert.deepEqual(r.rows.map(x => x.id), s.rows.map(x => x.id))
  })

  it('makes exactly one count request, not one per page', async () => {
    const s = makeSource(95)
    await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.equal(s.counts.length, 1, 'count must be fetched once')
  })

  it('stops paging once a short page is returned', async () => {
    const s = makeSource(45)
    await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    // 45 rows @ 20/page => pages 1,2,3 (page 3 is short) = 3 data calls
    assert.equal(s.calls.length, 3)
  })

  it('handles an exact multiple of the page size without an extra empty page', async () => {
    const s = makeSource(40)
    const r = await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.equal(r.rows.length, 40)
    assert.equal(s.calls.length, 2)
    assert.equal(r.truncated, false)
  })

  it('handles an empty result set', async () => {
    const s = makeSource(0)
    const r = await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.deepEqual(r.rows, [])
    assert.equal(r.total, 0)
    assert.equal(r.truncated, false)
  })

  it('handles a single page smaller than the page size', async () => {
    const s = makeSource(7)
    const r = await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.equal(r.rows.length, 7)
    assert.equal(s.calls.length, 1)
  })

  it('deduplicates ids so a shifting page boundary cannot double-count', async () => {
    // Simulates a row inserted between page 1 and page 2: page 1 returns
    // rows 1-20, page 2 repeats row 20 and adds 21-40.
    const fetchPage = async (page: number) => {
      if (page === 1) return Array.from({ length: 20 }, (_, i) => ({ id: `row-${i + 1}` }))
      if (page === 2) return Array.from({ length: 21 }, (_, i) => ({ id: `row-${i + 20}` }))
      return []
    }
    const fetchCount = async () => ({ count: 40 })
    const r = await fetchAllMatchingPaged(fetchPage, fetchCount, PAGE)
    assert.equal(new Set(r.rows.map(x => x.id)).size, r.rows.length, 'no duplicate ids')
  })

  it('flags truncation instead of silently returning a partial export', async () => {
    // Server reports 100 but page 2 comes back empty => rows cannot be completed.
    let n = 0
    const fetchPage = async () => (++n === 1 ? Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` })) : [])
    const fetchCount = async () => ({ count: 100 })
    const r = await fetchAllMatchingPaged(fetchPage, fetchCount, PAGE)
    assert.equal(r.truncated, true)
    assert.ok(r.reason && r.reason.length > 0, 'a human-readable reason is provided')
  })

  it('propagates a page fetch error instead of returning partial data', async () => {
    const fetchPage = async (page: number) => {
      if (page === 1) return [{ id: 'a' }]
      throw new Error('boom')
    }
    const fetchCount = async () => ({ count: 50 })
    await assert.rejects(
      () => fetchAllMatchingPaged(fetchPage, fetchCount, PAGE),
      /boom/,
      'a failed page must not yield a silently short export',
    )
  })

  it('propagates a count error', async () => {
    const fetchPage = async () => [{ id: 'a' }]
    const fetchCount = async () => { throw new Error('count-fail') }
    await assert.rejects(() => fetchAllMatchingPaged(fetchPage, fetchCount, PAGE), /count-fail/)
  })

  it('refuses an oversized export from the server count, before fetching pages', async () => {
    let pageCalls = 0
    const huge = 10_000_000
    const fetchPage = async () => { pageCalls++; return [] }
    const fetchCount = async () => ({ count: huge })
    const r = await fetchAllMatchingPaged(fetchPage, fetchCount, PAGE)
    assert.equal(r.truncated, true)
    assert.equal(r.total, huge)
    assert.equal(pageCalls, 0, 'must not page through an export it already knows is too large')
    assert.match(String(r.reason), /الحد الأقصى/)
  })

  it('still exports a result set at exactly the hard limit', async () => {
    const n = 1000
    const s = makeSource(n)
    const r = await fetchAllMatchingPaged(s.fetchPage, s.fetchCount, PAGE)
    assert.equal(r.truncated, false)
    assert.equal(r.rows.length, n)
  })
})
