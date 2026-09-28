// Regression guard for the dynamic-collection 6666 paged contract.
//
// This test reads the source rather than importing it, because
// dynamicCollections.ts imports ../lib/supabase, which needs a browser env.
// The assertions below lock the *contract* so the full-collection RPC cannot
// be silently reintroduced.
//
// Runtime parity (identical id set AND order vs. the old unbounded function)
// is verified against the live database during deployment validation.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'dynamicCollections.ts'), 'utf8')

describe('dynamic collection 6666', () => {
  it('routes legacy code 6666 to the recently-available strategy', () => {
    assert.match(src, /'6666':\s*\{\s*strategy:\s*CollectionStrategy\.RecentlyAvailable\s*\}/)
  })

  it('calls the PAGED rpc, not the unbounded one', () => {
    assert.match(src, /get_recently_available_products_paged/)
    // The old single-argument function must not be called by the web loader.
    assert.doesNotMatch(
      src,
      /rpc\(\s*'get_recently_available_products'\s*,/,
      'web must not call the unbounded full-collection RPC',
    )
  })

  it('sends every parameter required for a page-scoped, filtered result', () => {
    for (const p of [
      'p_token',
      'p_governorate_id',
      'p_search',
      'p_page',
      'p_per_page',
      'p_count_only',
    ]) {
      assert.ok(src.includes(p), `loader must send ${p}`)
    }
  })

  it('takes paging and search inputs from the caller', () => {
    for (const arg of ['page', 'perPage', 'search', 'governorateId', 'countOnly']) {
      assert.ok(src.includes(arg), `loader must accept ${arg}`)
    }
  })

  it('declares exactly one dynamic collection', () => {
    const keys = [...src.matchAll(/^\s*'(\d+)':\s*\{/gm)].map(m => m[1])
    assert.deepEqual(keys, ['6666'])
  })
})
