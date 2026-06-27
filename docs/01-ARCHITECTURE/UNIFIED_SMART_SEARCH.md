# Unified Smart Search Architecture

## Decision

**Trigram-Accelerated Token Search** (`pg_trgm` + GIN indexes + Token AND + `similarity()` ranking)

## Why Not Alternatives

| Approach | Reason Rejected |
|---|---|
| PostgreSQL Full Text Search | Weak Arabic support; no partial matching; poor number handling |
| Custom Token Search (no index) | Full table scan per query — unusable at scale |
| Hybrid (FTS + Trigram + Token) | Over-engineered for this data size |

## What Changed

### DB (Migration `20260923_unified_smart_search.sql`)

- **Extension**: `pg_trgm`
- **Indexes**: 11 GIN trigram indexes (across all 6 entities)
- **New RPC**: `public.unified_search(p_token, p_entity, p_query, p_filters, p_page, p_per_page, p_order_by)`
  - Supports all 6 entities with proper auth scoping
  - Token AND logic (query split by whitespace, all tokens must match)
  - `similarity()` ranking (GREATEST of all searchable columns)
  - Entity-specific filters via JSONB
  - Pagination

### Frontend

- **New file**: `src/services/unifiedSearch.ts` — generic search service
- **Updated**: `src/services/products.ts` — added `unifiedSearch()` method (uses unified_search + mapRow)
- **Updated**: `src/pages/products/ProductsPage.tsx` — debounced (300ms) server-side search; removed client-side `useMemo` filter; passes status/company filters to RPC

## Searchable Columns Per Entity

| Entity | Searchable Columns | Auth Scope |
|---|---|---|
| products | `product_name`, `legacy_code` | All governed users |
| customers | `company_name`, `code` | Employee tree + upper management |
| employees | `full_name`, `code` | Subtree + upper management |
| orders | `order_number`, `snapshot_customer_name` | Owner tree + upper management + customer self |
| visits | `code`, `customer.company_name` (JOIN) | Employee tree + upper management + customer self |
| collections | `code`, `customer.company_name` (JOIN), `reference_number` | Owner tree + upper management + customer self |

## GIN Indexes Added (11 total)

1. `products.product_name` → `idx_products_name_trgm`
2. `products.legacy_code` → `idx_products_code_trgm`
3. `customers.company_name` → `idx_customers_name_trgm`
4. `customers.code` → `idx_customers_code_trgm`
5. `employees.full_name` → `idx_employees_name_trgm`
6. `employees.code` → `idx_employees_code_trgm`
7. `orders.order_number` → `idx_orders_number_trgm`
8. `orders.snapshot_customer_name` → `idx_orders_snapshot_customer_trgm`
9. `visits.code` → `idx_visits_code_trgm`
10. `collections.code` → `idx_collections_code_trgm`
11. `collections.reference_number` → `idx_collections_reference_trgm`

## Token Search Logic (example)

Query: `فوج 120`

```
Tokens: ['فوج', '120']

WHERE (
  (p.product_name ILIKE '%فوج%' OR p.legacy_code ILIKE '%فوج%')
  AND
  (p.product_name ILIKE '%120%' OR p.legacy_code ILIKE '%120%')
)
ORDER BY GREATEST(similarity(p.product_name, 'فوج 120'), similarity(p.legacy_code, 'فوج 120')) DESC
```

## Expected Performance

| Metric | Before (ILIKE, no index) | After (GIN trigram) |
|---|---|---|
| Full table search | 50-300ms (seq scan) | <3ms (index scan) |
| Multi-token AND | N/A (client-side) | <10ms (bitmap AND) |
| Short tokens (<3 chars) | 50-300ms | 5-50ms (reduced selectivity) |
| Index size | 0 | ~3x indexed text (~50MB est.) |
| INSERT/UPDATE overhead | baseline | +15-20% index maintenance |

## Backward Compatibility

- All existing RPCs (`get_governed_products`, `get_unified_orders`, etc.) continue to work
- All existing client code continues to work
- GIN indexes accelerate existing `ILIKE` queries automatically
- `unified_search` is additive — no breaking changes

## Migration Steps

1. Run `supabase/migrations/20260923_unified_smart_search.sql` in Supabase SQL editor
2. Verify indexes created: `SELECT * FROM pg_indexes WHERE indexname LIKE 'idx_%_trgm';`
3. Test search: `SELECT * FROM unified_search('token', 'products', 'فوج 120', '{}', 1, 10);`
4. Deploy frontend changes

## Future Phases

- Integrate with CustomersPage, EmployeesPage, OrdersPage, VisitsPage, CollectionsPage
- Add relevance score display in UI
- Add pagination controls
- Upgrade `governed_global_search` to use the same engine
- Add Arabic diacritics stripping (tashkeel) in tokenizer
