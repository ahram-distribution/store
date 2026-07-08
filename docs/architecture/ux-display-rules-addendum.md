# UX Display Rules — Desktop Architecture Reference

**Applies to**: Executive Command Center + ALL Desktop Workspaces  
**Status**: Mandatory — Architecture requirements, not UI preferences  
**Document ref**: AH-ARCH-UX-001  
**Last updated**: 07 Jul 2026  

---

## Rule 1 — Calendar Standard

The Desktop application uses the **Gregorian calendar** only.

| Format | Example | Usage |
|---|---|---|
| `DD/MM/YYYY` | `07/07/2026` | Table columns, date inputs |
| `DD Mon YYYY` | `07 Jul 2026` | Cards, tooltips, summary displays |
| `Month YYYY` | `July 2026` | Filters, period selectors, chart axes |
| `DD Mon` | `07 Jul` | Change feed entries, compact tables |

**Forbidden**:
- ❌ Hijri dates (unless explicitly requested by PO in a future phase)
- ❌ ISO 8601 in user-facing UI (`2026-07-07T10:30:00`)
- ❌ Unix timestamps
- ❌ Relative-only dates (`"2 days ago"` without absolute date)

**Implementation**: All `Date` formatting must use a single centralized formatter. No ad-hoc formatting anywhere in Presentation.

---

## Rule 2 — Display Identity

Always display the **business name**, never the internal ID.

| Entity | Display | Never Display |
|---|---|---|
| Customer | `شركة النور للتجارة` | `8d8d4a52-7d9d-42d3-b5b4-6d9f...` |
| Product | `سكر أبيض 1 كجم` | `prod_abc123` |
| Representative | `محمد أحمد` | `rep_456` |
| Warehouse | `مخزن القاهرة` | `wh_001` |
| Branch | `فرع الجيزة` | `branch_02` |
| Company | `الشركة الأم` | `company_a` |

**Exception**: Business workflow codes are acceptable:
- ✅ `ORD-10524` — printed on invoices
- ✅ `INV-22031` — legal document number
- ✅ `CHK-00852` — bank document number
- ✅ `EMP-022` — printed on payroll

---

## Rule 3 — Technical Information

The following must **never** appear in the normal interface:
- UUID / GUID
- Database internal IDs
- RPC names
- Provider names
- Table column names
- Hash values
- Technical keys

**Scope of prohibition**:
- Table columns, detail panels, tooltips, status bars
- Export files (Excel, CSV, PDF)
- Print outputs
- Error messages
- URLs

**Only location**: Developer mode (future, disabled by default).

**Implementation**: All provider mappers must resolve `id` fields to human-readable identifiers before reaching Presentation. The UI layer must never receive a UUID.

---

## Rule 4 — Display Priority

When rendering a record, fields follow this priority:

```
1. Customer/Company Name          (most recognizable)
2. Representative Name            (who is responsible)
3. Order/Invoice/Check Number     (business workflow identifier)
4. Status                         (current state)
5. Amount                         (business impact)
6. Dates                          (time context)
7. Warehouse/Branch Name          (location)
8. Phone Number                   (contact)
...
N. Internal ID                    (NEVER DISPLAYED)
```

**Table column priority**:

| Entity | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| Order | Customer Name | Order No | Amount | Status |
| Customer | Customer Name | Phone | Balance | Credit Limit |
| Product | Product Name | Stock | Unit | Price |
| Employee | Employee Name | Code | Dept | Phone |

---

## Rule 5 — Business Language

Every screen must speak the language of the business, not the database.

| Database Field | Display (Arabic) |
|---|---|
| `status` | الحالة |
| `total_amount` | إجمالي المبلغ |
| `outstanding_balance` | الرصيد المستحق |
| `credit_limit` | الحد الائتماني |
| `inventory` | المخزون الحالي |
| `reorder_point` | حد إعادة الطلب |
| `created_at` | تاريخ الإنشاء |
| `updated_at` | آخر تحديث |
| `is_active` | الحالة (نشط / غير نشط) |
| `employee_name` | المندوب |

Column headers, labels, filters, and tooltips must use business terminology. Technical names never appear in the UI.

---

## Rule 6 — Numbers with Context

Never display a number without business context. Every KPI, total, and counter must include:

| Element | Example |
|---|---|
| Business meaning | إجمالي المبيعات (وليس 125,430 فقط) |
| Time period | اليوم — 07/07/2026 |
| Comparison period | أمس: 112,000 ج.م |
| Difference | +13,430 |
| Percentage change | ▲ +12% |
| Trend direction | ▲ (أخضر للارتفاع) |
| Last updated | آخر تحديث: 10:32:15 |
| Source records drill-down | Click → record list |

**Implementation**: Every number displayed in Zones 1-4 must be a clickable element that opens the underlying records.

---

## Rule 7 — Empty States

Never show an empty table without explanation.

**Correct**:
- ✅ "لا توجد طلبات بانتظار الموافقة"
- ✅ "لا يوجد توصيلات متأخرة"
- ✅ "لا توجد شيكات مرتجعة"
- ✅ "جميع الطلبات تمت معالجتها"

**Wrong**:
- ❌ "No data" (English, generic)
- ❌ Empty table with no message
- ❌ "0 results" (no explanation)
- ❌ Skeleton loader that never resolves

**Implementation**: Every list, table, and card must have a dedicated empty state component that displays a contextual message in Arabic. Generic "لا توجد بيانات" is acceptable only as a fallback — prefer specific messages.

---

## Rule 8 — Filter Visibility

The current active filters must always be visible. The user must never wonder "what am I currently looking at?"

**Required**:
- ✅ Active filter chips displayed at the top of every workspace
- ✅ Each chip shows filter name + value (e.g., `الحالة: قيد المراجعة` `✕`)
- ✅ Chips are individually removable
- ✅ Date ranges explicitly show `من: DD/MM/YYYY — إلى: DD/MM/YYYY`
- ✅ When no filters are active, show "جميع السجلات" indicator

**Implementation**: A `<FilterBar>` component at the top of every workspace and on the Command Center. It reads from the workspace's active filter state and displays chips. Global filters (company, branch, warehouse) appear in the global toolbar and are always visible.

---

## Rule 9 — Information Density

The Desktop is designed for productivity. Design decisions:

| Rule | Rationale |
|---|---|
| Reduce empty space | No oversized margins, padding, or hero images |
| Avoid oversized cards | Cards should be compact — 180-280px width for KPIs |
| Show useful information | 3-5 rows visible in action cards before scrolling |
| No mobile spacing | Desktop has larger screens — use the space efficiently |
| Compact tables | Dense rows (36-40px height), minimally padded cells |
| Progressive disclosure | Show summary first, detail on click |

**Anti-patterns**:
- ❌ 100px KPI cards with 60px of whitespace
- ❌ Tables with 10 rows visible in 800px of vertical space
- ❌ Cards with single numbers and no supporting context
- ❌ Designs that look like mobile apps stretched to desktop

---

## Rule 10 — The "No-IT" Test

If a business user cannot understand a displayed value without asking IT, the UI is architecturally incorrect.

**Test**: Show a screenshot to a non-technical business user. If they cannot answer "what does this value mean?" within 3 seconds, the display fails.

**Failure examples**:
- ❌ `status = 'S'` instead of `الحالة: قيد المراجعة`
- ❌ `cust_id: 550e8400-e29b-41d4-a716-446655440000` instead of `العميل: شركة النور للتجارة`
- ❌ `ts: 1720345200` instead of `07/07/2026 10:30`
- ❌ `is_actv: true` instead of `الحالة: نشط`

---

## Rule 11 — The 5-Second Executive Test

Within five seconds of opening the Command Center, the executive must know:

1. **What requires a decision** — Zone 1 shows pending approvals with counts
2. **What is delayed** — Zone 2 shows overdue deliveries, pending shipping
3. **What is blocked** — Zone 2 shows warehouse blockages, inventory shortages
4. **What changed** — Zone 3 shows changes since last session
5. **Where is the operational risk** — Severity colors + count badges highlight critical items

If any of these five answers requires searching, scrolling, or clicking to find, the implementation is rejected.

---

## Enforcement

### Code Review Checklist

All Desktop Presentation PRs must verify:

- [ ] No UUID/GUID/technical ID in any rendered element
- [ ] All entity references use business names, not IDs
- [ ] All dates use Gregorian calendar with centralized formatter
- [ ] All table columns use business terminology headers
- [ ] Detail views include all required fields per entity type
- [ ] Date filters show explicit From/To labels
- [ ] Empty states display contextual messages (not generic "No data")
- [ ] Active filters are visible as removable chips
- [ ] No excessive whitespace, oversized cards, or mobile spacing
- [ ] Every number is clickable (drills down to source records)
- [ ] Every KPI includes: meaning, period, comparison, trend, last update
- [ ] Passes the "No-IT" test on at least 5 random values
- [ ] Passes the 5-second test (a non-technical user can answer all 5 questions)

### Testing

- [ ] `displayRules.test.ts` — validates provider mappers strip UUIDs
- [ ] Visual regression: no UUID leaks in rendered DOM
- [ ] Integration: every number in Command Center zones is clickable
- [ ] Session: filter state persists and restores correctly

---

---

## Rule 12 — Workspace Memory

Every workspace must restore its exact previous state when the user returns.

| Saved Item | Restore On |
|---|---|
| Filters (global + local) | Tab click, app restart |
| Column order | Tab click |
| Column widths | Tab click |
| Sort key + direction | Tab click |
| Search text | Tab click |
| Scroll position | Tab click |
| Selected row(s) | Tab click |

**Implementation**: Each workspace state is saved to `ahram_session_state.openWorkspaces[].memory` on every user interaction. On tab switch or app restart, the saved state is read and applied before rendering.

---

## Rule 13 — Global Filter Inheritance

All workspaces automatically inherit global filters (company, branch, warehouse, date range). No workspace should ask the user to re-select these.

**Model**:
```
GlobalToolbar (user sets company/branch/warehouse/date)
  │
  ├──► commandCenterStore.filters
  │
  ├──► Command Center (inherits automatically)
  ├──► SalesWorkspace (inherits + adds local status filter)
  ├──► CustomersWorkspace (inherits + adds local credit filter)
  └──► All workspaces (inheritance is automatic)
```

**Implementation**: `useWorkspaceFilters()` hook in each workspace merges `commandCenterStore.filters` (global) with local overrides.

---

## Rule 14 — Context-Aware Toolbar

The toolbar has two layers:

| Layer | Visibility | Content |
|---|---|---|
| **Layer 1 — Global** | Always visible | Search, Date, Company, Branch, Warehouse, Notifications, User, Refresh |
| **Layer 2 — Commands** | Visible when workspace active | Workspace-specific actions (New Order, Approve, Export, etc.) |

**Workspace command definitions**:
```typescript
interface ToolbarCommand {
  id: string
  label: string     // Arabic
  icon: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}

// Defined in each workspace's registration:
registerWorkspace({
  type: 'sales',
  commands: [
    { id: 'new-order', label: 'طلب جديد', icon: '📋', shortcut: 'Ctrl+N', onClick: ... },
    { id: 'approve', label: 'اعتماد', icon: '✅', onClick: ... },
    { id: 'reject', label: 'رفض', icon: '❌', onClick: ... },
    { id: 'export', label: 'تصدير', icon: '📥', onClick: ... },
  ],
})
```

**Extensibility**: Adding commands to a workspace requires only modifying its registration — no changes to `GlobalCommandToolbar`. Future workspaces define their own commands.

---

## Reference Mapping

| Source Addendum | Rule # | Documented In |
|---|---|---|
| Calendar Standard | Rule 1 | `executive-command-center-spec.md` §9.1 |
| Display Identity | Rule 2 | `executive-command-center-spec.md` §9.2 |
| UUID Policy | Rule 3 | `executive-command-center-spec.md` §9.3 |
| Display Priority | Rule 4 | This document |
| Business Language | Rule 5 | `executive-command-center-spec.md` §9.4 |
| Numbers with Context | Rule 6 | `executive-command-center-spec.md` §6 |
| Empty States | Rule 7 | NEW — This document |
| Filter Visibility | Rule 8 | NEW — This document |
| Information Density | Rule 9 | NEW — This document |
| No-IT Test | Rule 10 | `executive-command-center-spec.md` §9.7 |
| 5-Second Executive Test | Rule 11 | `executive-command-center-spec.md` §1 |
| Workspace Memory | Rule 12 | `executive-command-center-spec.md` §11 |
| Global Filter Inheritance | Rule 13 | `executive-command-center-spec.md` §10 |
| Context-Aware Toolbar | Rule 14 | `executive-command-center-spec.md` §19 |
| Role-Driven UI | Rule 15 | `executive-command-center-spec.md` §13 |
| No Empty Modules | Rule 16 | `executive-command-center-spec.md` §13 |
| Role Aware Commands | Rule 17 | `executive-command-center-spec.md` §13 |
| Grid First | Rule 18 | `executive-command-center-spec.md` §17 |
| Action Over Display | Rule 19 | `executive-command-center-spec.md` §1 |
| Company Scale | Rule 20 | `executive-command-center-spec.md` §14 |
