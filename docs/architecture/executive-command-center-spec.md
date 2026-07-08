# Executive Command Center — Architecture Specification (V3)

**Version**: 3.0 — FINAL  
**Status**: Draft for Product Owner Approval  
**Design Philosophy**: Operating Room, not Dashboard. Business Flows, not Widgets.  

---

## 1. Core Philosophy

The Executive Command Center is the **operating room** of Ahram ERP Desktop.

A dashboard shows information.  
An operating room drives the business.

### The Five Questions

When the executive opens the application, the screen must answer within 5 seconds:

1. **What is waiting for my decision?** — Pending approvals, executive authorizations
2. **What is blocked?** — Warehouse, shipping, inventory, credit
3. **What is losing money?** — Returned checks, credit violations, delayed deliveries
4. **What happened since I left?** — Order changes, collections, new customers, inventory movement
5. **What requires action before I close?** — The single most important thing to do NOW

### Design Principles

| Principle | Meaning |
|---|---|
| **Action over information** | Every element must lead to a workflow, not just display a value |
| **Business flows over widgets** | Organize by operational workflow (approvals, problems, changes), not by data types |
| **Zero dead ends** | Every number is clickable. Every click opens a workspace with records and filters |
| **Session continuity** | Remember everything — last company, branch, filters, decisions. Resume where you left off |
| **Future-ready** | Reserve space for sync engine, offline queue, AI assistant, DB health — before they exist |
| **Provenance by default** | Every number displays its source (RPC, table, filter, formula). No orphan data |
| **Gregorian calendar only** | All dates use Gregorian. Never display Hijri, ISO 8601, or timestamps in user-facing UI |
| **Names over IDs** | Display business names (customer, product, employee) — never UUIDs, database IDs, or technical keys |
| **Business language** | Every label, header, and value must use the vocabulary of the business, not the database |
| **The "No-IT" test** | If a business user cannot understand a displayed value without asking IT, the design fails |
| **Meaningful empty states** | Never show empty tables without explanation. Display contextual messages ("لا توجد طلبات بانتظار الموافقة"), not generic "No data" |
| **Filter visibility** | Active filters must always be visible as removable chips. User must never wonder "what am I looking at" |
| **Information density** | Desktop is for productivity. Reduce empty space, avoid oversized cards, use compact tables. No mobile spacing |
| **Context-aware toolbar** | Toolbar adapts to the active workspace — appending workspace-specific commands (New Order, Approve, Export) dynamically |
| **Command Center is HOME** | Opens automatically after login. Always pinned, never closable, never duplicated. "Home" action returns to it |
| **3-level refresh** | Refresh current workspace, refresh visible widgets, refresh everything. Never refresh the whole application unnecessarily |
| **Workspace memory** | Each workspace remembers its own filters, columns, sort, scroll, and selection independently. Returning restores exact state |
| **User profile driven UI** | Desktop adapts to the logged-in employee's role. Home screen is role-driven. Different roles see different default workspaces |
| **No empty modules** | If a user cannot access a menu item, hide it completely. Never disable or show "Access Denied" |
| **Role aware commands** | Toolbar, context menu, and actions change according to: current workspace, current user role, current selection. Never show unusable actions |
| **Grid first** | Desktop is built around DataGrids. Cards are secondary. Every operational workspace prioritizes the grid |
| **Action over display** | If something is displayed, the user must be able to do something with it. Minimize read-only information |
| **Company scale** | Architecture supports multiple companies, branches, warehouses, and distribution regions without redesign |

---

## 2. Layout Architecture — Four Operational Zones

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  GLOBAL TOOLBAR (48px) — [Global Search] [Date] [Company] [Branch] [Warehouse]        │
│  [🔔 Notifications] [👤 REP-001] [🔄 Refresh] [⏱️ 08:30]                             │
│  ─── context-aware zone (appears when workspace is active) ───                       │
│  [New Order] [Approve] [Reject] [Export] [Print]                                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  ──── ZONE 1: IMMEDIATE DECISIONS ──── (top, highest prominence)                      │
│  "What requires my decision right now?"                                                │
│                                                                                        │
│  ┌────────────────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │ ⚡ PENDING APPROVALS        [7]│  │ ↩️ RETURNED / CANCELLED                  [3]│  │
│  │ Orders awaiting your decision  │  │ Orders returned by warehouse / cancelled    │  │
│  │                                │  │                                             │  │
│  │ # │ Customer       │ Amt│ Days│  │ # │ Customer       │ Amt   │ Reason    │    │  │
│  │───┼────────────────┼────┼─────│  │───┼────────────────┼───────┼───────────│    │  │
│  │ORD│ مكة سوهاج      │124k│ 2   │  │ORD│ النور          │ 87k   │ عميل رفض  │    │  │
│  │ORD│ النور          │87k │ 1   │  │ORD│ الإسكندرية     │ 256k  │ مخزون ناقص│    │  │
│  │ORD│ الإسكندرية     │256k│ 5h  │  │REQ│ أمر توريد      │ 43k   │ إذن مطلوب │    │  │
│  │ORD│ الدلتا         │43k │ 5d⚠️│  │    │ 023         │       │           │    │  │
│  │ +3 more            │    │     │  │                                             │  │
│  │                                │  │                                             │  │
│  │ [📋 Review All Decisions →]  │  │ [🔍 Review Returned →]                      │  │
│  └────────────────────────────────┘  └─────────────────────────────────────────────┘  │
│                                                                                        │
│  ──── ZONE 2: OPERATIONAL PROBLEMS ──── (middle, scrollable horizontally)              │
│  "What is broken and needs fixing?"                                                    │
│                                                                                        │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ 🔧 BLOCKED      │ │ 📦 DELAYED      │ │ ⚠️ INVENTORY    │ │ 💳 CREDIT       │  │
│  │ Warehouse [4]   │ │ Shipping [5]    │ │ Shortage [12]   │ │ Exceeded [8]    │  │
│  ├─ ORD-185 (3h)   │ ├─ ORD-175 (2d)   │ ├─ موز: 0 left    │ ├─ النور (+45k)   │  │
│  │─ ORD-186 (2.5h) │ │─ ORD-178 (1d)   │ │─ سكر: 2 left    │ │─ سوهاج (+32k)   │  │
│  │─ +2 more        │ │─ +3 more        │ │─ +10 more       │ │─ +6 more        │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                                        │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐                      │
│  │ 💳 RETURNED     │ │ 👤 ATTENDANCE   │ │ 📍 GPS          │                      │
│  │ Checks [3]      │ │ Exceptions [5]  │ │ Anomalies [2]   │                      │
│  ├─ CHK-045 (1.2M) │ ├─ EMP-022 (no)   │ ├─ Truck-07 (off) │                      │
│  │─ CHK-046 (800k) │ │─ EMP-015 (late) │ │─ Truck-12 (idle)│                      │
│  │─ CHK-047 (500k) │ │─ +3 more        │ │                 │                      │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘                      │
│                                                                                        │
│  ──── ZONE 3: BUSINESS CHANGES (since last session) ────                              │
│  "What happened while I was away?"                                                    │
│                                                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐   │
│  │ SUMMARY:  🆕 Orders +3  │  ✅ Collections +2  │  🚚 Delivered +5  │  👥 Cust+1  │   │
│  │ ──────────────────────────────────────────────────────────────────────────── │   │
│  │                                                                               │   │
│  │ 10:15  ←  ORD-191 changed to "قيد المراجعة" — by أحمد حسن                  │   │
│  │ 10:08  ←  Check #CHK-045 returned (بنك مصر) — 1,240,000 ج.م                 │   │
│  │ 09:55  ←  New order ORD-196 (مكة التجارية) — 43,100 ج.م                    │   │
│  │ 09:30  ←  Customer limit exceeded — النور للتوريدات (+45,000)               │   │
│  │ 09:15  ←  EMP-022 محمد علي absent without notice                            │   │
│  │ 09:00  ←  ORD-188 status → "جاهز للتوصيل"                                   │   │
│  │                                                                               │   │
│  │  [View Full Activity Log →]                                                   │   │
│  └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│  ──── ZONE 4: BUSINESS HEALTH ──── (collapsible, collapsed by default)                │
│  "How is the business performing?"                                                     │
│                                                                                        │
│  [📊 Business Health ▼  (8 indicators, 2 charts)]                                     │
│                                                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                │
│  │ Sales    │ │ Orders   │ │ Pending  │ │ Collect  │                                │
│  │ ▲12%    │ │ ▲8%     │ │ ⚠️+133% │ │ ▼-3%    │                                │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                │
│  │ Stock    │ │ Attend   │ │ Delayed  │ │ Credit   │                                │
│  │ ▲+50%   │ │ ▲+2%    │ │ ⚠️+150% │ │ ⚠️+166% │                                │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                                │
│                                                                                        │
│  ┌──────────────┐  ┌──────────────┐                                                  │
│  │ 📈 Sales     │  │ 📊 Orders    │                                                  │
│  │  (chart)     │  │  (chart)     │                                                  │
│  └──────────────┘  └──────────────┘                                                  │
│                                                                                        │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  FUTURE RESERVED AREA (16px, hidden, space allocated)                                 │
│  [⎔ Local PostgreSQL] [⟳ Sync Engine] [📴 Offline Queue] [🤖 AI Assistant]           │
│  [🗄️ Database Health] [⬆️ Update Manager] [🧩 Plugin Center]                         │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  STATUS BAR (32px) — two parts                                                        │
│  [BUSINESS]  Pending: 7  |  Blocked: 4  |  Late: 5  |  Attendance: 2                │
│  [TECHNICAL] 🟢 Online  |  🗄️ DB: OK  |  🔄 Synced  |  👤 REP-001  |  🕒 10:32:15  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Zone Weight Distribution

| Zone | Purpose | Viewport | Priority |
|---|---|---|---|
| **Zone 1: Immediate Decisions** | What needs MY decision NOW | 35% | Critical |
| **Zone 2: Operational Problems** | What is broken | 25% | High |
| **Zone 3: Business Changes** | What changed since last session | 20% | Medium |
| **Zone 4: Business Health** | KPI performance trends | 20% (collapsible) | Supplementary |

---

## 3. Zone 1 — Immediate Decisions (Detailed)

### Purpose

This is the executive's personal decision queue. Only items requiring the logged-in user's authority appear here. This is the FIRST thing the executive sees.

### Items

| Item | Condition | Severity | Click Action |
|---|---|---|---|
| **Pending Approvals** | `orders.status IN ('submitted','reviewing')` | 🟠 Warning | SalesWorkspace → filter submitted+reviewing |
| **Returned Orders** | `orders.status = 'returned' AND needs_review = true` | 🔴 Critical | SalesWorkspace → filter returned |
| **Authorization Requests** | `authorizations.status = 'pending' AND approver_id = current_user` | 🟠 Warning | AuthorizationWorkspace → filter pending |
| **Cancellation Requests** | `orders.cancellation_requested = true` | 🔴 Critical | SalesWorkspace → filter cancellation |

### Empty State

```
┌────────────────────────────────────────────────────────────┐
│  ✅  لا توجد قرارات معلقة                                  │
│                                                             │
│  جميع الطلبات تمت معالجتها. لا شيء ينتظر قرارك الآن.        │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Zone 2 — Operational Problems (Detailed)

### Purpose

A scrollable horizontal strip of problem cards. Each card represents one category of operational issue. Cards are shown ONLY if they have active items.

### Cards

| Card | Condition | Severity | Click Action |
|---|---|---|---|
| **Blocked Warehouse** | `orders.status='preparing' AND updated_at < now()-interval'2h'` | 🔴 Critical | Workspace → filter blocked |
| **Delayed Shipping** | `delivery_tracking.status NOT IN ('delivered','cancelled') AND updated_at < now()-interval'24h'` | 🟠 Warning | Workspace → filter delayed |
| **Inventory Shortage** | `products.inventory <= reorder_point` | 🟠 Warning | ProductsWorkspace → filter low stock |
| **Credit Exceeded** | `customers.outstanding_balance > credit_limit` | 🔴 Critical | CustomersWorkspace → filter credit violation |
| **Returned Checks** | `collections.payment_type='check' AND status='returned'` | 🔴 Critical | CollectionsWorkspace → filter returned checks |
| **Attendance Exceptions** | `attendance.date=today AND status IN ('absent','late')` | 🟠 Warning | AttendanceWorkspace → filter today |
| **GPS Anomalies** | `gps_tracking.anomaly_detected = true` (future) | 🟠 Warning | Future |

### Card Visibility Rules

- Cards with 0 items are HIDDEN
- Remaining cards reflow to fill the strip
- Horizontal scroll if >4 cards have items
- "View All Problems" link at end of strip (opens consolidated view — future)

---

## 5. Zone 3 — Business Changes (Detailed)

### Purpose

A complete picture of everything that changed in the system since the executive's last session. This replaces the need to manually check each workspace for "what's new."

### Summary Bar

At the top of Zone 3, a horizontal bar shows change counts by category:

```
🆕 Orders: +3    ✅ Collections: +2    🚚 Delivered: +5    👥 New Customers: +1
📦 Inventory: -3    💰 Price Updates: 2    📋 Status Changes: 12    🔄 Total Events: 28
```

### Change Feed

Below the summary bar, a scrollable list of individual changes sorted by timestamp (most recent first). Each entry:

```
[severity-icon] [time] ← [description] — [actor]

Click → opens workspace with the affected record selected
```

### Session Tracking

```typescript
// Stored in Electron localStorage under key 'ahram_session_state'
interface SessionState {
  lastLoginTimestamp: string    // ISO timestamp
  lastLogoutTimestamp: string   // ISO timestamp
  lastCompanyId: string | null
  lastBranchId: string | null
  lastWarehouseId: string | null
  lastDateRange: { preset: string; start: string | null; end: string | null }
  recentActions: { action: string; timestamp: string; workspace: string }[]
  recentDecisions: { decision: string; orderId: string; timestamp: string }[]
  openWorkspaces: { type: string; filters: Record<string, string>; title: string }[]
  activeWorkspaceId: string | null
  isKpiExpanded: boolean
}
```

### Change Types Tracked

| Entity | Change Types |
|---|---|
| Orders | Created, status changed, returned, cancelled, approved, rejected |
| Collections | Payment received, check returned, check cleared |
| Deliveries | Dispatched, delivered, delayed, exception |
| Customers | Created, credit limit changed, status changed |
| Products | Created, price changed, inventory changed, deactivated |
| Employees | Attendance exception, leave approved |

---

## 6. Zone 4 — Business Health (Detailed)

### Purpose

Performance indicators with full provenance. This zone is COLLAPSED BY DEFAULT because operational priorities (Zones 1-3) take precedence.

### Behavior

| State | Action |
|---|---|
| **Collapsed (default)** | Shows only toggle: `[📊 Business Health ▼]` |
| **Expanded** | Shows KPI strip (8 cards) + 2 charts |
| **Preference saved** | `isKpiExpanded` persisted in session state |

### KPI Provenance (Every KPI must show this on hover)

```
المبيعات اليوم
▲ +12%  |  125,430 ج.م  |  أمس: 112,000  |  +13,430
─────────────────────────────────────────────
المصدر:       ISalesOrderProvider.searchOrders()
RPC:          get_unified_orders({ p_token })
التعريف:      إجمالي قيمة الطلبات المسلمة اليوم
الفلاتر:      created_at >= اليوم 00:00
              created_at <= اليوم 23:59
              status = 'delivered'
المعادلة:     SUM(order_items.quantity * order_items.unit_price)
              WHERE order.status = 'delivered'
              AND order.created_at = CURRENT_DATE
السجلات:      ORD-182 (42,000), ORD-185 (31,000), ORD-188 (52,430) ...
آخر تحديث:    10:32:15
```

### Charts (Future)

Reserved space for:
- 📈 Sales trend (7-day / 30-day)
- 📊 Orders by status (pie or bar)

---

## 7. Session Persistence

### What is Saved

| Item | Storage | Restore Behavior |
|---|---|---|
| Last login timestamp | `ahram_session.lastLoginTimestamp` | Zone 3 filter |
| Last filters (company, branch, warehouse, date) | `ahram_session` | Pre-populate global toolbar |
| Open workspaces | `ahram_session.openWorkspaces` | Restore tabs on launch |
| Active workspace | `ahram_session.activeWorkspaceId` | Set active tab |
| Recent actions | `ahram_session.recentActions` | Show in Zone 3 |
| Recent decisions | `ahram_session.recentDecisions` | Show in Zone 3 |
| KPI expand state | `ahram_session.isKpiExpanded` | Apply on load |

### Save Triggers

| Event | Action |
|---|---|
| Company/Branch/Warehouse change | Save immediately |
| Date range change | Save immediately |
| Workspace opened/closed | Save immediately |
| Approval/Rejection action | Save to recent decisions |
| Application close | Save full session state |
| Logout | Save full session state + clear token |

### Resume Flow

```
1. DesktopShell mounts
2. Token exists
3. Read ahram_session_state from localStorage
4. Parse session state
   ├── Valid → restore filters, workspaces, active tab
   └── Invalid → create fresh session with default state
5. Zone 3 loads: "Changes since your last session (since 08:30)"
6. All zones load data with restored filter context
```

---

## 8. Future Reserved Area

### Reserved Slot

A 16px strip below Zone 4 and above the Status Bar. Invisible by default. Contains placeholder items that become active when the corresponding system is implemented.

```
[⎔ Local PostgreSQL] [⟳ Sync Engine] [📴 Offline Queue] [🤖 AI Assistant]
[🗄️ Database Health] [⬆️ Update Manager] [🧩 Plugin Center]
```

### Behavior

| State | Visual |
|---|---|
| **All systems disabled** | Hidden (0px) |
| **1+ system active** | Appears as thin status bar (16px) |
| **System has alert** | Individual badge + click → detail |
| **All systems healthy** | Green dot on each |
| **System error** | Red dot + tooltip |

### Future-Proofing

The layout allocates vertical space for this zone even when hidden. Adding a new system indicator requires only:
1. Add entry to `SystemIndicatorConfig`
2. Wire to data source
3. It appears in the reserved slot

---

## 9. The Command Center as HOME

The Command Center is NOT just another workspace. It is the HOME of the Desktop application.

### Rules

| Rule | Implementation |
|---|---|
| **Opens automatically after login** | `WorkspaceManager` creates a Command Center tab if none exists in session state |
| **Always pinned** | Command Center tab uses `pinned: true` — close button is hidden |
| **Cannot be closed** | `closeWorkspace()` ignores attempts to close the Command Center |
| **Cannot be duplicated** | `addWorkspace()` checks for existing Command Center tab before creating |
| **Always first in tab bar** | Command Center tab is always inserted at index 0 |
| **"Home" action** | `Alt+Home` or sidebar Home button always switches to the Command Center |
| **Session persistence** | Command Center state is saved/restored like all workspaces |

### Tab Bar Position

```
│  [🏠 المركز التنفيذي]  │  [الطلبات]  │  [العملاء]  │  +  │
    ↑ pinned, index 0       unpinned      unpinned
```

### Registration

```typescript
// In WorkspaceRegistry:
registerWorkspace({
  type: 'commandCenter',
  label: 'المركز التنفيذي',
  icon: '🏠',
  pinned: true,          // Cannot be closed
  home: true,            // This is the HOME workspace
  render: () => <ExecutiveCommandCenter />,
})
```

---

## 10. Global Filter Inheritance

Global filters (Company, Branch, Warehouse, Date Range) are automatically inherited by every workspace. No workspace should ask the user to select the company again.

### Inheritance Model

```
GlobalToolbar (user sets filters here)
  │
  ├──► commandCenterStore.filters
  │
  ├──► Command Center (Zones 1-4) ← inherits automatically
  │
  ├──► SalesWorkspace ← inherits automatically + may add local filter
  │     ├── Global: company=الشركة الأم, branch=الكل, warehouse=الكل, date=Today
  │     └── Local: status=submitted
  │
  ├──► CustomersWorkspace ← inherits automatically
  │     ├── Global: company=الشركة الأم, branch=الكل, warehouse=الكل, date=Today
  │     └── Local: creditViolation=true
  │
  └──► All workspaces ← inheritance is automatic, zero configuration
```

### How It Works

```typescript
// Each workspace receives merged filters:
interface WorkspaceFilters {
  // Inherited from global toolbar (always present)
  companyId: string | null
  branchId: string | null
  warehouseId: string | null
  dateFrom: string | null
  dateTo: string | null

  // Workspace-specific (added locally)
  status?: string
  searchQuery?: string
  // ...
}
```

### Implementation

1. Global filter changes → `commandCenterStore.filters` updates
2. All open workspaces receive new filter values via Zustand subscription
3. Each workspace re-fetches data with merged filters (global + local)
4. Workspace can override a global filter locally if needed

### Filter Display

Every workspace shows active filter chips at the top, separating global from local:

```
[الشركة: الكل] [الفرع: الجيزة ✕] [المخزن: الكل] [التاريخ: اليوم]
[الحالة: قيد المراجعة ✕]    ← local filter added by workspace
```

---

## 11. Workspace-Level Memory

Every workspace remembers its own state independently. Returning to a workspace restores it exactly as the user left it.

### Per-Workspace Saved State

```typescript
interface WorkspaceMemory {
  // Global filter snapshot (what was selected when user last viewed this workspace)
  filters: {
    global: GlobalFilters
    local: Record<string, string>
  }

  // DataGrid state
  columns: {
    order: string[]           // Column order by key
    widths: Record<string, number>  // Column widths in px
    frozenColumns: string[]   // Frozen column keys
  }

  // View state
  sortKey: string | null
  sortDirection: 'asc' | 'desc'
  searchText: string
  scrollPosition: { top: number; left: number }

  // Selection
  selectedRowId: string | null
  selectedRowIds: string[]     // Multi-select

  // Pagination
  page: number
  pageSize: number
}
```

### When State is Saved

| Event | Action |
|---|---|
| User changes a filter | Save immediately |
| User resizes a column | Save immediately |
| User reorders columns | Save immediately |
| User sorts a column | Save immediately |
| User selects a row | Save immediately |
| User scrolls | Save on debounce (500ms) |
| User switches to another tab | Save immediately |
| User closes the app | Save all workspace states |

### When State is Restored

| Event | Action |
|---|---|
| Workspace tab is clicked | Restore all saved state before rendering |
| Workspace tab is re-opened after close | Restore from session persistence |
| Application is re-launched | Restore all open workspaces with their full state |

---

## 12. 3-Level Refresh

Refresh must have three levels to avoid unnecessary full-application reloads.

### Level 1 — Refresh Current Workspace

| Action | Shortcut | Behavior |
|---|---|---|
| Refresh the active workspace only | `Ctrl+R` | Re-fetches data for the currently visible workspace. Other workspaces and the Command Center remain unchanged. |

### Level 2 — Refresh Visible Widgets

| Action | Shortcut | Behavior |
|---|---|---|
| Refresh all visible content on screen | `Ctrl+Shift+R` | Re-fetches the active workspace + all visible Command Center zones. Hidden workspace tabs are NOT refreshed. |

### Level 3 — Refresh Everything

| Action | Shortcut | Behavior |
|---|---|---|
| Refresh every open workspace + Command Center | `Ctrl+Alt+R` | Re-fetches ALL open workspaces + ALL Command Center zones. This is the equivalent of a full reload without losing state. |

### Menu

```
[🔄 Refresh ▼]
├── 🔄 Current Workspace    (Ctrl+R)
├── 🔄 Visible Content     (Ctrl+Shift+R)
└── 🔄 Everything          (Ctrl+Alt+R)
```

### Implementation

```typescript
type RefreshLevel = 'current' | 'visible' | 'all'

interface RefreshCommand {
  level: RefreshLevel
  timestamp: number
}

// Each widget subscribes to refresh events:
// - 'current': only refresh if this widget is the active workspace
// - 'visible': refresh if this widget is visible (active workspace or visible CC zone)
// - 'all': refresh regardless of visibility
```

---

## 13. Role-Driven Desktop

The Desktop adapts to the logged-in employee's role. Different roles see different default workspaces, navigation items, and commands.

### Home Screen by Role

| Role | Default Home Screen | Primary Navigation |
|---|---|---|
| **Executive Supervisor** | Executive Command Center (Zones 1-4) | Full navigation |
| **Warehouse Manager** | Warehouse Operations | Warehouse, Inventory, Shipping |
| **Sales Manager** | Sales Operations | Sales, Customers, Reports |
| **Sales Representative** | Daily Route / My Customers | My Customers, New Order |
| **Accountant** | Financial Operations | Collections, Cheques, Customers Accounts |
| **Admin** | Administration | All modules |

### Navigation Filtering

```typescript
interface RoleAccess {
  roleId: string
  homeWorkspace: string
  visibleModules: string[]       // Which sidebar items to show
  defaultCommands: string[]      // Which toolbar commands are available
}
```

- If a user's role does not have access to a module, it is **completely hidden** from the sidebar
- If a user has access to only 1-2 modules, the sidebar shows only those + Settings
- The toolbar's Layer 2 (workspace commands) only shows commands the user's role can execute

### Implementation

```typescript
// In WorkspaceRegistry, each workspace can define role access:
registerWorkspace({
  type: 'warehouse',
  label: 'عمليات المخازن',
  icon: '🏭',
  roles: ['executive_supervisor', 'warehouse_manager', 'admin'],
  // ...
})

// Sidebar filters out modules where user's role is not in the allowed list
```

---

## 14. Company Scale Architecture

The Desktop is built for a distribution company with multi-entity support:

| Entity | Relationship | Future Growth |
|---|---|---|
| **Company** | Top-level organization | Add new company without code changes |
| **Branch** | Belongs to company | Add new branch per company |
| **Warehouse** | Belongs to branch | Add new warehouse per branch |
| **Distribution Region** | Belongs to company | Add new region |

All global filters (company, branch, warehouse) cascade naturally. The UI never hardcodes a specific company or branch ID.

---

## 15. Performance Budgets

| Metric | Target | Measurement |
|---|---|---|
| Application startup (cold) | <3s | First paint to interactive |
| Workspace switch | <300ms | Tab click to content visible |
| Filter change (data refresh) | <200ms | Filter change to updated data |
| Search response | Instant while typing | Debounce 150ms, result render <50ms |
| DataGrid render (100 rows) | <500ms | Data received to rendered table |
| DataGrid sort | <100ms | Click header to sorted view |
| DataGrid filter (client-side) | <50ms | Filter input to filtered view |

---

## 16. Version Policy

| Rule | Detail |
|---|---|
| Every build increments version | `major.minor.patch` in `desktop/package.json` |
| Never overwrite previous builds | Each build gets a unique filename with version |
| Maintain complete version history | All builds archived in `desktop/release/` |
| Version displayed in status bar | User can see current build version |
| Build metadata included | Git commit hash + build date in `window.__BUILD_INFO__` |

---

## 17. Grid-First Architecture

Desktop is built around DataGrids. Cards are secondary.

| Element | Priority | Usage |
|---|---|---|
| **DataGrid** | Primary | Every operational workspace uses DataGrid as main view |
| **KPI Card** | Secondary | Summary context, Zone 4 only |
| **Action Card** | Secondary | Zone 1-2 quick views, always drill to DataGrid |
| **Detail Panel** | Secondary | Opens from DataGrid row click |

### DataGrid Features (All Workspaces)

- Sorting (single column, click header)
- Filtering (per-column, text/number/date/select)
- Column resize (drag column edge)
- Column reorder (drag column header)
- Column chooser (show/hide columns)
- Freeze columns (left side)
- Multi-select (checkbox column)
- Pagination (page size selector)
- Export (Excel, CSV)
- Print
- Copy (selected rows)
- Row click → detail panel
- Context menu (right-click)
- Empty state (contextual message)
- Loading state (skeleton rows)

---

## 18. UX Display Rules

### 13.1 Calendar Standard

All dates in the Desktop application use the **Gregorian calendar**.

| Format | Example | Usage |
|---|---|---|
| `DD/MM/YYYY` | `07/07/2026` | Table columns, date inputs |
| `DD Mon YYYY` | `07 Jul 2026` | Cards, tooltips, summaries |
| `Month YYYY` | `July 2026` | Filters, period selectors |
| `DD Mon` | `07 Jul` | Compact displays (change feed) |

Forbidden: Hijri dates (unless explicitly requested), ISO 8601 (`2026-07-07T10:30:00`), Unix timestamps.

### 13.2 Display Identity

| Display this | Never this |
|---|---|
| `شركة النور للتجارة` | `8d8d4a52-7d9d-42d3-b5b4-6d9f...` |
| `محمد أحمد` | `rep_456` |
| `مخزن القاهرة` | `wh_001` |
| `ORD-10524` (business code) | `order_abc123` (internal ID) |

Only display codes that exist in the business workflow: order numbers (`ORD-`), invoice numbers (`INV-`), check numbers (`CHK-`), employee codes (`EMP-`). Never display UUIDs, GUIDs, or database sequence IDs.

### 13.3 UUID Policy

UUIDs, GUIDs, database IDs, technical keys, and hash values must NEVER appear in:
- Table columns, detail panels, tooltips, status bars
- Export files (Excel, CSV), print outputs
- Error messages or URLs

The Presentation layer MUST NEVER receive a UUID from the Application layer. Providers and mappers MUST resolve all `id` fields to human-readable identifiers before they reach the UI.

### 13.4 Business Language

| Database Term | Display (Arabic) |
|---|---|
| `status` | الحالة |
| `total_amount` | إجمالي المبلغ |
| `outstanding_balance` | الرصيد المستحق |
| `credit_limit` | الحد الائتماني |
| `inventory` | المخزون الحالي |
| `created_at` | تاريخ الإنشاء |
| `is_active` | الحالة (نشط / غير نشط) |

No technical column names may appear in the UI.

### 13.5 Detail View Requirements

Every drill-down detail view MUST display:
- **Order**: Customer Name, Order No, Amount, Status, Created Date, Representative Name, Warehouse, Phone
- **Customer**: Customer Name, Customer Code, Phone, Outstanding Balance, Credit Limit, Status, Representative
- **Product**: Product Name, Current Stock, Reorder Point, Unit Price, Category, Status
- **Collection**: Customer Name, Check No, Amount, Bank, Due Date, Status, Return Date (if applicable)
- **Employee**: Employee Name, Employee Code, Department, Phone, Status

### 13.6 Date Filter Display

Every date filter MUST show explicit From/To labels:

```
من: 01/07/2026    إلى: 07/07/2026
الفترة الحالية: 01/07/2026 — 07/07/2026
فترة المقارنة: 24/06/2026 — 30/06/2026
```

### 13.7 Empty States

Every list, table, and card must have a dedicated empty state component with a contextual Arabic message:

- ✅ `"لا توجد طلبات بانتظار الموافقة"` — for pending approvals
- ✅ `"لا يوجد توصيلات متأخرة"` — for delayed deliveries
- ✅ `"جميع الطلبات تمت معالجتها"` — for completed workflows

Generic `"لا توجد بيانات"` is acceptable only as a fallback. Never use English "No data", never show an empty table without any message.

### 13.8 Filter Visibility

Active filters must always be visible to the user:

- Filter chips displayed at the top of every workspace: `الحالة: قيد المراجعة  ✕`
- Global filters shown in the toolbar: `الفرع: الجيزة  ✕`
- Date ranges explicitly shown: `من: 01/07/2026  إلى: 07/07/2026`
- Chips are individually removable
- Empty filter state shows `جميع السجلات`

### 13.9 Information Density

Design for productivity on desktop-sized screens:

| Rule | Detail |
|---|---|
| Compact tables | Row height 36-40px, minimally padded cells |
| KPI card size | 180-280px width, no oversized cards |
| Action card rows | 3-5 visible before scroll |
| No mobile spacing | Use available screen real estate efficiently |
| Progressive disclosure | Show summary → click → detail |

Anti-patterns: 100px KPIs with 60px whitespace, tables with 10 rows in 800px, mobile-app-stretched-to-desktop layouts.

### 13.10 The "No-IT" Test

If a business user cannot understand a displayed value within 3 seconds without asking IT, the implementation is rejected. All rendered values must pass this test.

### 9.8 Enforcement

- All provider mappers MUST strip UUIDs from presentation-facing data
- All date formatting MUST use a centralized Gregorian formatter
- Code review must verify: no UUID in rendered DOM, business names only, Gregorian dates
- Reference: `docs/architecture/ux-display-rules-addendum.md`

---

## 19. Widget Map (V3 — Zones)

```
ExecutiveCommandCenter
│
├── GlobalToolbar (context-aware — 2 layers)
│   ├── Layer 1: Global (always visible)
│   │   ├── GlobalSearch [Ctrl+K]
│   │   ├── DateRangeSelector (10 presets: Today, Yesterday, This Week, Last Week,
│   │   │                     This Month, Last Month, Current Quarter, Current Year,
│   │   │                     Custom Range)
│   │   ├── CompanySelector
│   │   ├── BranchSelector (cascaded from Company)
│   │   ├── WarehouseSelector (cascaded from Branch)
│   │   ├── RefreshButton [Ctrl+R] (opens 3-level menu: Current, Visible, All)
│   │   ├── NotificationCenter
│   │   ├── UserMenu
│   │   └── SessionIndicator ("آخر جلسة: 08:30")
│   └── Layer 2: Workspace Commands (context-aware, shown when workspace active)
│       ├── SalesWorkspace: [New Order] [Approve] [Reject] [Export] [Print]
│       ├── CustomersWorkspace: [New Customer] [Statement] [Visit History] [Collections]
│       ├── ProductsWorkspace: [New Product] [Price Update] [Stock Adjust] [Export]
│       └── [future workspaces define their own commands — extensible via registry]
│
├── Zone1_ImmediateDecisions
│   ├── DecisionCard_PendingApprovals
│   │   ├── MiniTable.rows[*].onClick → SalesWorkspace + recordId
│   │   └── ActionButton [Review All Decisions →]
│   └── DecisionCard_ReturnedCancelled
│       ├── MiniTable.rows[*].onClick → SalesWorkspace + recordId
│       └── ActionButton [Review Returned →]
│
├── Zone2_OperationalProblems
│   ├── ProblemCard_BlockedWarehouse
│   ├── ProblemCard_DelayedShipping
│   ├── ProblemCard_InventoryShortage
│   ├── ProblemCard_CreditExceeded
│   ├── ProblemCard_ReturnedChecks
│   ├── ProblemCard_AttendanceExceptions
│   ├── ProblemCard_GpsAnomalies (future)
│   └── MiniTable.rows[*].onClick → respective workspace + recordId
│
├── Zone3_BusinessChanges
│   ├── ChangesSummaryBar (counts by category)
│   ├── ChangeEntry[*].onClick → respective workspace + entityId
│   └── ViewAllLink → ActivityLogWorkspace
│
├── Zone4_BusinessHealth (collapsible)
│   ├── ToggleButton [📊 Business Health ▼/▲]
│   ├── ExecutiveKpiCard[*] (8 cards, with provenance tooltip)
│   ├── Chart_SalesTrend (future)
│   └── Chart_OrdersByStatus (future)
│
├── FutureReservedArea (hidden, 16px allocated)
│   └── SystemIndicator[*]
│
└── SystemStatusBar (split into 2 parts)
    ├── Business Status
    │   ├── PendingApprovalsCount
    │   ├── BlockedOrdersCount
    │   ├── AttendanceAlertsCount
    │   └── LateDeliveriesCount
    └── Technical Status
        ├── OnlineStatus
        ├── DatabaseStatus
        ├── SyncStatus
        ├── CurrentUser
        └── Clock
```

---

## 20. Data Flow (V3)

```
┌──────────────────┐
│  Session Restore  │──► commandCenterStore ←── Global filters
└──────────────────┘       │
                           │
     ┌─────────────────────┼──────────────────────┐
     ▼                     ▼                      ▼
┌──────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Zone 1   │    │ Zone 2           │    │ Zone 3           │
│ Decisions│    │ Problems         │    │ Changes          │
│          │    │                  │    │                  │
│ searchOrd│    │ searchOrders()   │    │ queryChanges()   │
│ ers()    │    │ searchCustomers()│    │ └─ since last    │
│ searchAu│    │ searchProducts() │    │    login timestamp│
│ ths()    │    │ searchAttendance │    │                  │
│          │    │ searchCollection │    │                  │
└────┬─────┘    └────────┬─────────┘    └────────┬─────────┘
     │                   │                       │
     ▼                   ▼                       ▼
┌──────────────────────────────────────────────────────────┐
│  BootstrapContext.providers                                │
│  salesOrder | customer | productCatalog | collection      │
│  attendance | employee | authorization (future)           │
└──────────────────────────────────┬───────────────────────┘
                                   ▼
                        ┌────────────────────┐
                        │ Supabase RPC/Legacy│
                        └────────────────────┘
```

---

## 21. File Structure (V3)

```
src/desktop/commandcenter/
│
├── ExecutiveCommandCenter.tsx        # Layout: 4 zones + future + status
├── commandCenterStore.ts             # Zustand store
├── commandCenterTypes.ts             # All interfaces
├── useCommandCenterData.ts           # Data orchestration hook
├── sessionPersistence.ts             # Session save/restore
│
├── zone1/                            # IMMEDIATE DECISIONS
│   ├── Zone1_ImmediateDecisions.tsx  # 2-column decision cards
│   ├── DecisionCard.tsx              # Reusable decision card
│   └── DecisionCardConfig.ts         # Card definitions
│
├── zone2/                            # OPERATIONAL PROBLEMS
│   ├── Zone2_OperationalProblems.tsx # Horizontal scroll strip
│   ├── ProblemCard.tsx               # Reusable problem card
│   └── ProblemCardConfig.ts          # Card definitions
│
├── zone3/                            # BUSINESS CHANGES
│   ├── Zone3_BusinessChanges.tsx     # Summary + feed
│   ├── ChangesSummaryBar.tsx         # Counts by category
│   └── ChangeEntry.tsx               # Single change row
│
├── zone4/                            # BUSINESS HEALTH
│   ├── Zone4_BusinessHealth.tsx      # Collapsible container
│   ├── ExecutiveKpiCard.tsx          # KPI with provenance
│   ├── KpiConfig.ts                  # 8 KPI definitions
│   └── KpiTooltip.tsx                # Provenance tooltip
│
├── future/                           # FUTURE RESERVED
│   └── FutureReservedArea.tsx        # Hidden status strip
│
├── toolbar/                          # GLOBAL TOOLBAR
│   ├── GlobalCommandToolbar.tsx
│   ├── DateRangeSelector.tsx
│   ├── CompanySelector.tsx
│   ├── BranchSelector.tsx
│   ├── WarehouseSelector.tsx
│   ├── NotificationCenter.tsx
│   ├── RefreshButton.tsx
│   └── SessionIndicator.tsx          # "آخر جلسة: HH:MM"
│
├── SystemStatusBar.tsx               # Bottom bar + session duration
│
└── __tests__/
    ├── Zone1_ImmediateDecisions.test.ts
    ├── Zone2_OperationalProblems.test.ts
    ├── Zone3_BusinessChanges.test.ts
    ├── Zone4_BusinessHealth.test.ts
    ├── sessionPersistence.test.ts
    └── commandCenterStore.test.ts
```

---

## 22. Implementation Plan (V3)

**Mandatory rule**: Each phase requires PO approval before the next phase begins. No phase may be merged with another.

### Phase 0 — Desktop Shell Finalization
**Scope**: Final layout, Sidebar, GlobalCommandToolbar, Workspace Host, StatusBar
1. `GlobalCommandToolbar.tsx` — context-aware (global layer + workspace commands layer)
2. `DateRangeSelector.tsx` — 10 presets (Today, Yesterday, This Week, Last Week, This Month, Last Month, Current Quarter, Current Year, Custom Range)
3. `CompanySelector.tsx` + `BranchSelector.tsx` + `WarehouseSelector.tsx` — cascading selectors
4. `Sidebar.tsx` — update NavMenu order (Home → Sales → Customers → Collections → Inventory → Warehouse → Shipping → Attendance → Reports → Administration → Settings). **Command Center is always first, pinned, cannot be closed**
5. `WorkspaceManager.tsx` — enforce Command Center as HOME (pinned, index 0, no close, no duplicate)
6. `StatusBar.tsx` — split into Business Status + Technical Status
7. `WorkspacePersistence.ts` — per-workspace memory (filters, columns, sort, scroll, selection)
8. Global filter inheritance — all workspaces automatically receive company/branch/warehouse/date
9. 3-level refresh — Current, Visible, All
10. `FutureReservedArea.tsx` — hidden strip
11. PO Review: screenshots + runtime verification + UX verification

### Phase 1 — Session Persistence + Zone 1 (Immediate Decisions)
1. `sessionPersistence.ts` — save/restore session state
2. `commandCenterStore.ts` — Zustand store with session integration
3. `Zone1_ImmediateDecisions.tsx` + `DecisionCard.tsx`
4. Wire to `salesOrder.searchOrders()` for pending approvals
5. Wire click → workspace navigation
6. PO Review

### Phase 2 — Zone 2 (Operational Problems)
1. `Zone2_OperationalProblems.tsx` + `ProblemCard.tsx`
2. Wire each problem card to its provider method
3. Implement auto-hide for 0-item cards
4. PO Review

### Phase 3 — Zone 3 (Business Changes)
1. `Zone3_BusinessChanges.tsx` + `ChangesSummaryBar` + `ChangeEntry`
2. Implement change detection against last login timestamp
3. Wire click → workspace navigation
4. PO Review

### Phase 4 — Zone 4 (Business Health)
1. `Zone4_BusinessHealth.tsx` — collapsible container
2. `ExecutiveKpiCard.tsx` with provenance tooltip
3. Wire 8 KPIs to provider methods
4. PO Review

### Phase 5 — Charts, Comparisons, Forecasts
1. Sales trend chart (7-day / 30-day)
2. Orders by status chart
3. Comparison period calculations
4. PO Review

### Phase 6 — Integration
1. Wire `sessionPersistence` to login/logout lifecycle
2. Replace old DesktopDashboard in workspace registry
3. Build and test EXE
4. PO Review

---

## 23. Acceptance Criteria (V3 — FINAL)

### Phase 0 Shell Checks (Desktop Shell Finalization)

- [ ] GlobalCommandToolbar: context-aware — shows global layer always, workspace commands layer dynamically
- [ ] DateRangeSelector: supports all 10 presets (Today, Yesterday, This Week, Last Week, This Month, Last Month, Current Quarter, Current Year, Custom Range)
- [ ] Company/Branch/Warehouse: cascade correctly — selecting company filters branch options
- [ ] Sidebar: NavMenu order follows business workflow (Home → Sales → Customers → Collections → Inventory → Warehouse → Shipping → Attendance → Reports → Administration → Settings)
- [ ] Command Center: pinned, cannot be closed, cannot be duplicated, always first in tab bar, opens after login
- [ ] StatusBar: split into Business Status (pending/blocked/late/attendance) + Technical Status (online/DB/sync/user/clock)
- [ ] Global filter inheritance: all open workspaces receive filter changes automatically
- [ ] 3-level refresh: Ctrl+R (current), Ctrl+Shift+R (visible), Ctrl+Alt+R (all)
- [ ] Per-workspace memory: filters, columns, sort, scroll, selection restored on return
- [ ] FutureReservedArea: space allocated, hidden when empty

### The 5-Second Test

The Product Owner will verify:

- [ ] **Q1: What requires my approval now?** → Zone 1 shows pending approvals with count and details
- [ ] **Q2: What is blocked?** → Zone 2 shows blocked warehouse, delayed shipping, inventory shortages
- [ ] **Q3: What changed since my last session?** → Zone 3 shows changes with timestamp and actor
- [ ] **Q4: Where is the biggest operational risk?** → Severity colors + count badges draw eye to critical items
- [ ] **Q5: Can I reach affected records in one click?** → Every row + button opens workspace → filtered records

### Structural Checks

- [ ] Zones are ordered: Immediate Decisions → Problems → Changes → Health
- [ ] Zone 4 (Business Health) is COLLAPSED BY DEFAULT
- [ ] Cards with 0 items are automatically hidden
- [ ] Session state persists across application restarts
- [ ] Last company, branch, warehouse, date range are restored on login
- [ ] Future reserved area has allocated space in the layout
- [ ] Every KPI has provenance tooltip (source, RPC, definition, filters, formula, records)
- [ ] Every number is clickable (zero dead ends)
- [ ] Empty state displays when all zones have no items

### UX Display Rules

- [ ] All dates use Gregorian calendar with centralized formatter (no Hijri, no ISO 8601, no timestamps)
- [ ] Empty states display contextual Arabic messages ("لا توجد طلبات بانتظار الموافقة"), not generic "No data"
- [ ] Active filters always visible as removable chips — user never wonders "what am I looking at"
- [ ] Information density respected: compact tables (36-40px rows), 180-280px KPI cards, no oversized elements
- [ ] No UUIDs, GUIDs, database IDs, or technical keys appear in any rendered element
- [ ] All entity references use business names (customer name, employee name, product name)
- [ ] Only business workflow codes displayed: `ORD-`, `INV-`, `CHK-`, `EMP-` (not internal IDs)
- [ ] All table column headers and labels use business terminology (not database field names)
- [ ] Detail views include all required fields per entity type (order, customer, product, collection, employee)
- [ ] Date filters show explicit `من:` and `إلى:` labels with Gregorian dates
- [ ] Passes the "No-IT" test: a business user can understand every displayed value without ask
- [ ] Error states are per-card (no cascade failures)
- [ ] 260 tests pass (existing) + new Command Center tests
- [ ] Desktop tsc: 0 errors from `desktop/tsconfig.json`
