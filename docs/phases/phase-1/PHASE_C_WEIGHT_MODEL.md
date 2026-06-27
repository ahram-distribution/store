# Phase C — Weight Model Decision

**Status:** Design Only — No Migration, No Code Changes
**Goal:** Compare two weight storage models and select one before any implementation.

---

## The Core Question

When we add a new KPI in the future (e.g., `profitability`, `customer_satisfaction`, `on_time_delivery`), should we:

- **Design A:** Add a new column to 3 tables + update 1 function + update all RPCs + update frontend interfaces?
- **Design B:** INSERT a new row into a KPI definition table, and the system adapts automatically?

---

## Design A — Separate Columns (Current Approach)

### Current Schema

**`performance_weights_config`** — 6 weight columns (row per year):

| target_year | sales_weight | visits_weight | orders_weight | new_cust_weight | collections_weight | attendance_weight |
|-------------|-------------|--------------|--------------|-----------------|-------------------|------------------|
| 2026 | 35 | 15 | 10 | 15 | 20 | 15 |

**`employee_weight_overrides`** — same 6 columns (row per employee/month): 

| employee_id | month | year | sales_w | visits_w | orders_w | new_cust_w | collections_w | attendance_w |
|-------------|-------|------|---------|----------|----------|------------|--------------|-------------|

**`company_monthly_targets`** — same 6 weight columns + 4 target columns.

**`get_effective_weights()`** — returns 6 named fields in a jsonb object.

### Advantages

| Aspect | Assessment |
|--------|-----------|
| **Clarity** | Schema is self-documenting: you see all KPIs as columns. No JOINs needed to understand the structure. |
| **Query Performance** | Direct column access — no JOINs, no pivoting, no aggregation. A single row read gets all weights at once. |
| **RPC Simplicity** | `(get_effective_weights(...)->>'sales_weight_percent')::numeric` — direct field extraction. |
| **Frontend Simplicity** | Fixed property names: `weights.sales_weight_percent`. TypeScript interfaces are static and clear. No iteration needed. |
| **Type Safety** | Database enforces column types. Frontend interfaces are explicit. Missing field = compile error. |
| **Migration for new KPI** | `ALTER TABLE ADD COLUMN` — a single DDL statement per table (3 tables). |

### Disadvantages

| Aspect | Assessment |
|--------|-----------|
| **Schema Rigidity** | Adding a KPI requires DDL changes to 3 tables + view + function signatures. Requires migration each time. |
| **Wide Tables** | With current 6 KPIs: 6 columns. With 12 KPIs: 12 columns. With 20 KPIs: becomes unwieldy but still functional. |
| **Code Duplication** | Every RPC that references weights must explicitly name each column. Adding a KPI means updating every RPC. |
| **Frontend Fragility** | Every new KPI weight needs a new `interface` field, a new UI widget, a new label. No automatic discovery. |

### Cost of Adding a New KPI (Future)

| Step | Effort |
|------|--------|
| `ALTER TABLE performance_weights_config ADD COLUMN x_weight_percent` | 1 line |
| `ALTER TABLE employee_weight_overrides ADD COLUMN x_weight_percent` | 1 line |
| `ALTER TABLE company_monthly_targets ADD COLUMN x_weight_percent` | 1 line (optional) |
| Update `get_effective_weights()` to return new field | 3 lines |
| Update `get_governed_target_performance()` to read + apply new weight | 5 lines |
| Update frontend TypeScript interfaces | 1 line each interface |
| Update frontend UI to display new KPI | Varies (new column/card) |
| **Total DDL+SQL changes** | **~10 lines across 4 objects** |

**Not trivial, but mechanical and safe.** Each change is a predictable pattern.

---

## Design B — Normalized (Row-Based) Model

### Proposed Schema

**`kpi_definitions`** — master list of KPIs:

| id | code | name_ar | default_weight | unit | is_active |
|----|------|---------|---------------|------|-----------|
| 1 | sales | المبيعات | 35 | currency | true |
| 2 | visits | الزيارات | 15 | count | true |
| 3 | orders | الطلبات | 10 | count | true |
| 4 | new_customers | عملاء جدد | 15 | count | true |
| 5 | collections | التحصيل | 20 | currency | false |
| 6 | attendance | الحضور | 15 | count | false |

**`performance_weights_config`** — normalized (rows instead of columns):

| id | target_year | kpi_id | weight_percent |
|----|-------------|--------|---------------|
| 1 | 2026 | 1 | 35 |
| 2 | 2026 | 2 | 15 |
| 3 | 2026 | 3 | 10 |
| 4 | 2026 | 4 | 15 |
| 5 | 2026 | 5 | 20 |
| 6 | 2026 | 6 | 15 |

**`employee_weight_overrides`** — normalized:

| id | employee_id | target_month | target_year | kpi_id | weight_percent | reason |
|----|-------------|-------------|-------------|--------|---------------|--------|

**`get_effective_weights()`** — returns a JSON **array** of objects:

```json
[
  {"kpi": "sales", "weight": 35},
  {"kpi": "visits", "weight": 15},
  {"kpi": "orders", "weight": 10},
  {"kpi": "new_customers", "weight": 15},
  {"kpi": "collections", "weight": 20},
  {"kpi": "attendance", "weight": 15}
]
```

Or returns a JSON **object** with dynamic keys:
```json
{
  "sales": 35, "visits": 15, "orders": 10,
  "new_customers": 15, "collections": 20, "attendance": 15
}
```

### Advantages

| Aspect | Assessment |
|--------|-----------|
| **Extensibility** | Adding a new KPI = `INSERT INTO kpi_definitions` + 3 weight rows. No DDL. No migration. |
| **Future-Proof** | System can discover KPIs dynamically. New KPIs appear automatically if configured. |
| **Frontend Potential** | UI could iterate over `kpi_definitions` to render dynamic weight sliders without hardcoding. |
| **Single Source of Truth** | `kpi_definitions` is the one place where all KPIs are defined — no scattered column names. |

### Disadvantages

| Aspect | Assessment |
|--------|-----------|
| **Query Complexity** | Every weight read becomes a JOIN (config + kpi_definitions) or an aggregation (jsonb_agg). Instead of `SELECT sales_weight FROM config WHERE year=2026`, it's `SELECT weight FROM config_weights WHERE year=2026 AND kpi='sales'`. |
| **RPC Complexity** | Current pattern: `(get_effective_weights(...)->>'sales')::numeric` — direct key lookup on jsonb. With normalized model: either array iteration or maintaining dynamic jsonb object. Either way, the RPC must know KPI codes to extract specific weights. |
| **Frontend Rework** | All 13 consumer files reference flat property names (`emp.sales_target`, `weights.sales_weight_percent`). Switching to dynamic keys means either: (a) maintaining backward-compat field names in the RPC, or (b) rewriting every consumer to iterate a KPIs array — massive frontend change. |
| **Contract Impact** | The current RPC returns `sales_weight_percent` as a named field. Changing to a generic KPI array breaks every consumer. To avoid this, the RPC must still emit the old field names — defeating the purpose of the normalized model. |
| **Type Safety Loss** | `(jsonb_array->>'weight')::numeric` — no compile-time check. A typo in a KPI code string is a runtime bug, not a compile error. TypeScript cannot validate dynamic keys. |
| **Override Granularity** | Same complexity per override row. |
| **Performance** | Instead of reading 6 columns from 1 row, the DB must JOIN 2-3 tables and aggregate rows. At the scale of this project (19 employees, 6 KPIs), performance difference is negligible — but the code is more complex. |
| **Migration Cost** | To move from Design A to Design B: rewrite 3 tables, migrate all data, rewrite `get_effective_weights`, rewrite `get_governed_target_performance`, rewrite ALL frontend consumers. This is not a small migration — it's a system-wide refactor. |

### Cost of Adding a New KPI (Future, Design B)

| Step | Effort |
|------|--------|
| `INSERT INTO kpi_definitions (code, name, default_weight)` | 1 line |
| `INSERT INTO performance_weights_config (year, kpi_id, weight)` | 1 line |
| (optional) `INSERT INTO employee_weight_overrides` for any overrides | 1 line per employee |
| Update `get_governed_target_performance` to apply the new weight | 5 lines |
| Update frontend UI to display new KPI | Varies |
| **Total SQL changes** | **~3 INSERTs** |

**But:** The RPC still needs updating because the scoring formula must explicitly include the new KPI. Unless we build a fully dynamic scoring engine (which is far more complex).

---

## The Dynamic Scoring Illusion

A key observation: **even with Design B, you cannot add a KPI without modifying the RPC and frontend.**

Why? Because:
1. The RPC must know which KPI values to fetch from which tables (`orders.total_amount` for sales, `visits.check_out_at` for visits, etc.)
2. The achievement formula must be defined per KPI (`eff / target * 100`, capped)
3. The frontend must display the KPI with a label, color, position, etc.

The weight is just **one number** per KPI. The real work of adding a KPI is:
- Defining the data source query
- Adding the achievement calculation
- Building the UI component
- Adding the column to `employee_monthly_targets` (if needed)

Design B only eliminates the `ALTER TABLE ADD COLUMN` step for the weight tables. It does NOT eliminate the 80% of work that goes into integrating a new KPI.

---

## Comparison Matrix

| Criterion | Design A (Columns) | Design B (Normalized) |
|-----------|-------------------|---------------------|
| **Current migration cost** | None (already implemented) | Massive — rewrite schema, data, RPCs, frontend |
| **Adding a new KPI (SQL)** | 10 lines, 3 ALTER TABLE | 3 INSERTs |
| **Adding a new KPI (total work)** | ~85% of effort is outside weights | ~80% of effort is outside weights |
| **Query performance** | Direct column access (fastest) | JOIN + aggregation (slightly slower, irrelevant at this scale) |
| **RPC simplicity** | `->>'sales_weight'` | `->>'sales'` or array iteration (same complexity) |
| **Frontend simplicity** | Static properties, TypeScript-safe | Dynamic keys, runtime error-prone |
| **Contract compatibility** | Fully backward-compatible | Breaks all RPC consumers |
| **Type safety** | Strong (column types, compile-time) | Weak (string keys, runtime) |
| **Self-documenting** | Yes — schema shows all KPIs | Requires querying kpi_definitions |
| **Schema flexibility** | Rigid (needs DDL for new KPI) | Flexible (INSERT only) |
| **Risk of change** | Low — predictable pattern | High — system-wide refactor |

---

## Recommendation

### Choose: **Design A — Separate Columns**

### Reasons

1. **The KPI set is small and stable.** Phase 1 defines exactly 6 KPIs (4 active now, 2 deferred). The project serves a single company with a fixed business model. There is no indication that 15+ KPIs will ever be needed. A column-per-KPI design is perfectly appropriate for 6-10 KPIs.

2. **Design B does not eliminate the hard part.** Even with normalized weights, adding a KPI still requires:
   - SQL for data source + achievement formula
   - RPC changes to include the new calculation
   - Frontend UI changes (label, card, chart)
   
   The ALTER TABLE step that Design B eliminates is **<15% of the total effort**.

3. **Design B breaks every consumer.** The current RPC contract emits `sales_weight_percent` as a named field. Six frontend pages and three services depend on this shape. Changing to a dynamic array would require rewriting all of them — or keeping the old fields anyway (defeating the purpose).

4. **Type safety matters more here than flexibility.** Weight values flow from DB → RPC → Frontend. With fixed columns, a typo is caught at compile time. With dynamic keys, a typo is a production bug.

5. **The migration cost of Design B is unjustified.** We would be rewriting 3 tables, 2 functions, and ALL frontend consumers — for a benefit (no ALTER TABLE for new KPIs) that we may never use, given the frozen KPI set.

### What If We Need a 7th KPI in the Future?

Adding a 7th KPI under Design A:

```sql
ALTER TABLE performance_weights_config ADD COLUMN profitability_weight_percent numeric DEFAULT 10;
ALTER TABLE employee_weight_overrides ADD COLUMN profitability_weight_percent numeric;
-- update get_effective_weights (3 lines)
-- update get_governed_target_performance (5 lines)
-- frontend: add interface field + UI widget
```

This is ~15 minutes of work. Not a burden.

### Risk of Choosing Design B Instead

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Breaking all RPC consumers | High | Keep old field names + add new structure = double maintenance |
| Frontend rewrite across 6+ pages | High | Major regression risk |
| Type safety loss | Medium | Runtime validation needed |
| No tangible benefit for 2+ years | Medium | May never materialize |
| Migration complexity | High | Data migration + testing + deployment risk |

### Does Design A Allow Expansion Without Breaking Contracts?

**Yes.** Because:
- The existing fields (`sales_weight_percent`, `orders_weight_percent`, etc.) never change name or type
- New KPI weights get NEW column names (e.g., `profitability_weight_percent`)
- No consumer is affected unless it explicitly chooses to read the new field
- This is exactly how `collections_weight_percent` and `attendance_weight_percent` were added after the original 4-KPI design

---

## Decision

| # | Item | Proposed |
|---|------|----------|
| 1 | **Weight Model** | **Design A — Separate Columns** |
| 2 | Add `orders_weight_percent` to `performance_weights_config` | ✅ Yes (after model decision) |
| 3 | Add `orders_weight_percent` to `employee_weight_overrides` | ✅ Yes (after model decision) |
| 4 | Update `get_effective_weights` to return `orders_weight_percent` | ✅ Yes (after model decision) |
| 5 | Default value for `orders_weight_percent` | ❓ Open (needs approval) |

---

## Appendix: Schema Comparison

### Design A — After Adding `orders_weight_percent`

**`performance_weights_config`** (1 row per year):
| year | sales | visits | orders | new_cust | collections | attendance |
|------|-------|--------|--------|----------|-------------|-----------|
| 2026 | 35 | 15 | 10 | 15 | 20 | 15 |

**`employee_weight_overrides`** (1 row per employee/month if override exists):
| emp_id | mo | yr | sales | visits | orders | new_cust | collections | attendance |
|--------|----|----|-------|--------|--------|----------|-------------|-----------|

### Design B — After Migration

**`kpi_definitions`**:
| id | code | name_ar |
|----|------|---------|
| 1 | sales | المبيعات |
| 2 | visits | الزيارات |
| 3 | orders | الطلبات |
| 4 | new_customers | عملاء جدد |
| 5 | collections | التحصيل |
| 6 | attendance | الحضور |

**`performance_weights_config`**: 6 rows per year (one per KPI).

**`employee_weight_overrides`**: rows only where employee has override.

### Migration Cost Summary (A → B)

| Object | Changes |
|--------|---------|
| `kpi_definitions` | New table (CREATE) + seed data |
| `performance_weights_config` | Rewrite schema (DROP columns, ADD fk to kpi_definitions) + migrate data |
| `employee_weight_overrides` | Rewrite schema + migrate data |
| `company_monthly_targets` | Rewrite weight columns |
| `get_effective_weights` | Rewrite entirely |
| `get_governed_target_performance` | Rewrite weight extraction + scoring |
| Frontend (6+ pages) | Rewrite all weight-related code |
| **Risk** | **High** — every layer of the stack changes |

---

**Recommendation is final: Design A.** Awaiting your approval to proceed with Phase C execution, including adding `orders_weight_percent` to the schema.
