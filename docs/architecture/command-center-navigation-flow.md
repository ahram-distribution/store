# Executive Command Center — Widget Map & Navigation Flow (V3)

**Version**: 3.0 — FINAL  
**Core concept**: 4 operational zones + session resume + business workflow navigation  

---

## 1. Complete Widget Map (V3)

```
ExecutiveCommandCenter
│
├── GlobalCommandToolbar
│   ├── GlobalSearchInput                  [Ctrl+K]     → QuickSearch
│   ├── SessionIndicator                              → "آخر جلسة: 08:30 — استئناف"
│   │   └── ResumeButton                              → Restore session state
│   ├── DateRangeSelector                             → commandCenterStore.filters
│   ├── CompanySelector                               → commandCenterStore.filters
│   ├── BranchSelector                                → commandCenterStore.filters
│   ├── WarehouseSelector                             → commandCenterStore.filters
│   ├── RefreshButton                    [Ctrl+R]     → refreshAll()
│   ├── NotificationCenter                            → Dropdown
│   └── UserMenu                                      → Dropdown
│
├── ZONE 1: Immediate Decisions
│   │
│   ├── DecisionCard_PendingApprovals              🟠 severity=warning
│   │   ├── rows[*].onClick   → SalesWorkspace + { status: submitted,reviewing } + recordId
│   │   └── actionBtn.onClick → SalesWorkspace + { status: submitted,reviewing }
│   │
│   └── DecisionCard_ReturnedCancelled             🔴 severity=critical
│       ├── rows[*].onClick   → SalesWorkspace + { status: returned } + recordId
│       └── actionBtn.onClick → SalesWorkspace + { status: returned, cancelled }
│
├── ZONE 2: Operational Problems
│   │
│   ├── ProblemCard_BlockedWarehouse              🔴 severity=critical
│   │   ├── rows[*].onClick   → SalesWorkspace + { status: preparing, blocked>2h } + recordId
│   │   └── actionBtn.onClick → SalesWorkspace + { status: preparing, blocked>2h }
│   │
│   ├── ProblemCard_DelayedShipping               🟠 severity=warning
│   │   ├── rows[*].onClick   → DeliveryWorkspace + { delayed: true } + recordId
│   │   └── actionBtn.onClick → DeliveryWorkspace + { delayed: true }
│   │
│   ├── ProblemCard_InventoryShortage             🟠 severity=warning
│   │   ├── rows[*].onClick   → ProductsWorkspace + { lowStock: true } + recordId
│   │   └── actionBtn.onClick → ProductsWorkspace + { lowStock: true }
│   │
│   ├── ProblemCard_CreditExceeded                🔴 severity=critical
│   │   ├── rows[*].onClick   → CustomersWorkspace + { creditViolation: true } + recordId
│   │   └── actionBtn.onClick → CustomersWorkspace + { creditViolation: true }
│   │
│   ├── ProblemCard_ReturnedChecks                🔴 severity=critical
│   │   ├── rows[*].onClick   → CollectionsWorkspace + { checkStatus: returned } + recordId
│   │   └── actionBtn.onClick → CollectionsWorkspace + { checkStatus: returned }
│   │
│   ├── ProblemCard_AttendanceExceptions          🟠 severity=warning
│   │   ├── rows[*].onClick   → AttendanceWorkspace + { date: today, status: absent } + recordId
│   │   └── actionBtn.onClick → AttendanceWorkspace + { date: today, status: absent }
│   │
│   └── ProblemCard_GpsAnomalies                  🟠 severity=warning  (FUTURE)
│       ├── rows[*].onClick   → FutureWorkspace
│       └── actionBtn.onClick → FutureWorkspace
│
├── ZONE 3: Business Changes
│   │
│   ├── ChangesSummaryBar
│   │   ├── OrdersCount      (+3)  → SalesWorkspace + { createdSince: lastLogin }
│   │   ├── CollectionsCount (+2)  → CollectionsWorkspace + { since: lastLogin }
│   │   ├── DeliveredCount   (+5)  → SalesWorkspace + { deliveredSince: lastLogin }
│   │   ├── CustomersCount   (+1)  → CustomersWorkspace + { createdSince: lastLogin }
│   │   ├── InventoryCount   (-3)  → ProductsWorkspace + { changedSince: lastLogin }
│   │   └── PriceUpdates     (+2)  → ProductsWorkspace + { priceChangedSince: lastLogin }
│   │
│   └── ChangeEntry[*].onClick → respective workspace + entityId
│       └── ViewAllLink        → ActivityLogWorkspace
│
├── ZONE 4: Business Health (collapsible)
│   │
│   ├── ToggleButton                          → toggleKpiSection()
│   │
│   ├── ExecutiveKpiCard (Sales Today)        → Click → SalesWorkspace + { date: today, status: delivered }
│   ├── ExecutiveKpiCard (New Orders)         → Click → SalesWorkspace + { date: thisWeek }
│   ├── ExecutiveKpiCard (Pending Approval)   → Click → SalesWorkspace + { status: pending }
│   ├── ExecutiveKpiCard (Collections)        → Click → CollectionsWorkspace + { status: unpaid }
│   ├── ExecutiveKpiCard (Critical Stock)     → Click → ProductsWorkspace + { lowStock: true }
│   ├── ExecutiveKpiCard (Attendance)         → Click → AttendanceWorkspace + { date: today }
│   ├── ExecutiveKpiCard (Delayed Delivery)   → Click → DeliveryWorkspace + { delayed: true }
│   └── ExecutiveKpiCard (Credit Violations)  → Click → CustomersWorkspace + { creditViolation: true }
│
├── FutureReservedArea
│   └── SystemIndicator[*]                    → Future (hidden when inactive)
│
└── SystemStatusBar
    ├── ConnectionStatus
    ├── DatabaseStatus
    ├── LastRefreshTimestamp
    └── SessionDuration
```

---

## 2. Primary User Flow — The Operating Room Experience

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                  │
│  SESSION START                                                                                   │
│  ─────────────                                                                                   │
│                                                                                                  │
│  1. Application launches                                                                        │
│     ├── Token exists → validate → restore session state                                         │
│     ├── Session state found → restore filters + open workspaces + active tab                    │
│     └── No session state → fresh start, Command Center as default tab                           │
│                                                                                                  │
│  2. Command Center renders (all zones load in parallel)                                         │
│     ├── Zone 1: Decision cards (skeleton → data)                                               │
│     ├── Zone 2: Problem cards (skeleton → data, 0-item cards hide)                              │
│     ├── Zone 3: Changes feed (skeleton → data, filtered since last session)                     │
│     └── Zone 4: Collapsed (toggle available, KPIs hidden)                                       │
│                                                                                                  │
│  3. Executive scans the 5 questions:                                                             │
│     ├── "Any decisions waiting?"  → Zone 1                                                      │
│     ├── "Any problems?"           → Zone 2                                                      │
│     ├── "What changed?"           → Zone 3                                                      │
│     ├── "Biggest risk?"           → Severity colors + counts                                    │
│     └── "First action?"           → Click the most urgent item                                  │
│                                                                                                  │
│  4. Click → Workspace opens (new tab, CC stays pinned)                                          │
│     ├── Take action (approve, reject, assign, resolve)                                          │
│     └── Return to Command Center tab → next action                                              │
│                                                                                                  │
│  5. Session continues...                                                                        │
│     ├── Each workspace opened → saved to session state                                          │
│     ├── Each decision made → saved to recent decisions                                          │
│     └── Each filter change → saved to session state                                             │
│                                                                                                  │
│  6. Close / Logout                                                                              │
│     ├── Full session state serialized to localStorage                                           │
│     ├── Timestamp saved (used as "last login" on next start)                                   │
│     └── Token cleared on logout                                                                 │
│                                                                                                  │
│  NEXT START:                                                                                    │
│     ├── Session restored → filters, workspaces, decisions all back                              │
│     ├── Zone 3: "What changed since your last session (08:30 yesterday)?"                       │
│     └── Executive resumes exactly where they left off                                          │
│                                                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Navigation Decision Matrix (V3)

### Zone 1: Decisions

| Source | Click Target | Navigation Action | Filter | Record |
|---|---|---|---|---|
| Pending Approvals — row | Order review | SalesWorkspace | `status=submitted,reviewing` | `orderId` |
| Pending Approvals — button | Review all | SalesWorkspace | `status=submitted,reviewing` | — |
| Returned/Cancelled — row | Return review | SalesWorkspace | `status=returned` | `orderId` |
| Returned/Cancelled — button | Review all | SalesWorkspace | `status=returned,cancelled` | — |

### Zone 2: Problems

| Source | Click Target | Navigation Action | Filter | Record |
|---|---|---|---|---|
| Blocked Warehouse — row | Resolve blockage | SalesWorkspace | `status=preparing,blocked>2h` | `orderId` |
| Blocked Warehouse — button | View blocked | SalesWorkspace | `status=preparing,blocked>2h` | — |
| Delayed Shipping — row | Track delivery | DeliveryWorkspace | `delayed=true` | `orderId` |
| Delayed Shipping — button | View delayed | DeliveryWorkspace | `delayed=true` | — |
| Inventory Shortage — row | Review product | ProductsWorkspace | `lowStock=true` | `productId` |
| Inventory Shortage — button | View all low stock | ProductsWorkspace | `lowStock=true` | — |
| Credit Exceeded — row | Review customer | CustomersWorkspace | `creditViolation=true` | `customerId` |
| Credit Exceeded — button | View all violations | CustomersWorkspace | `creditViolation=true` | — |
| Returned Checks — row | Handle check | CollectionsWorkspace | `checkStatus=returned` | `checkId` |
| Returned Checks — button | View all | CollectionsWorkspace | `checkStatus=returned` | — |
| Attendance — row | View employee | AttendanceWorkspace | `date=today, status=absent` | `employeeId` |
| Attendance — button | View all | AttendanceWorkspace | `date=today, status=absent` | — |

### Zone 3: Changes

| Source | Click Target | Navigation Action | Filter | Record |
|---|---|---|---|---|
| Summary: Orders +3 | New orders | SalesWorkspace | `createdSince=lastLogin` | — |
| Summary: Collections +2 | New collections | CollectionsWorkspace | `since=lastLogin` | — |
| Summary: Delivered +5 | Recent deliveries | SalesWorkspace | `deliveredSince=lastLogin` | — |
| Summary: Customers +1 | New customers | CustomersWorkspace | `createdSince=lastLogin` | — |
| Change entry | Specific change | Entity workspace | `entityId` | `entityId` |
| View All | Full log | ActivityLogWorkspace | `since=lastLogin` | — |

### Zone 4: Health

| Source | Click Target | Navigation Action | Filter |
|---|---|---|---|
| Any KPI | Trend drill-down | Respective workspace | KPI-specific filter |

---

## 4. Session Resume Flow — Detailed

```
START: Application launches
│
1. Read ahram_session_state from localStorage
   │
   ├── KEY NOT FOUND:
   │     └── Create fresh session → default filters → empty workspace list
   │
   └── KEY FOUND:
         │
         ├── Parse JSON
         │
         ├── VALIDATION:
         │     ├── lastLoginTimestamp exists? → YES → use for Zone 3
         │     ├── filters have valid shape? → YES → restore
         │     └── workspaces array valid?   → YES → restore
         │
         ├── RESTORE:
         │     ├── GlobalToolbar: set company/branch/warehouse/date
         │     ├── WorkspaceManager: restore all open workspaces
         │     ├── TabBar: set active tab to previous active
         │     ├── Zone4: set expanded/collapsed state
         │     └── Command Center: load data with restored filters
         │
         └── ZONE 3:
               ├── "التغييرات منذ جلستك السابقة (08:30)"
               └── Changes feed populated since lastLoginTimestamp
```

---

## 5. Zone Interaction Contracts

### DecisionCard Props

```typescript
interface DecisionCardProps {
  severity: 'critical' | 'warning'
  icon: string
  title: string
  description: string
  count: number
  columns: { key: string; label: string; width?: string }[]
  items: DecisionItem[]
  isLoading: boolean
  isError: boolean
  actionButtonLabel: string
  onRowClick: (item: DecisionItem) => void
  onActionButtonClick: () => void
  onRetry: () => void
}

interface DecisionItem {
  id: string
  values: string[]
  urgencyLevel: number  // 0=normal, 1=warning, 2=critical
  targetWorkspace: string
  targetFilters: Record<string, string>
  targetRecordId: string
}
```

### ProblemCard Props

```typescript
interface ProblemCardProps {
  severity: 'critical' | 'warning'
  icon: string
  title: string
  description: string
  count: number
  items: ProblemItem[]
  isLoading: boolean
  isError: boolean
  onRowClick: (item: ProblemItem) => void
  onActionButtonClick: () => void
  onRetry: () => void
}

interface ProblemItem {
  id: string
  label: string    // Primary display (e.g., "ORD-185  مكة")
  detail: string   // Secondary display (e.g., "3 ساعات")
  severity: number
  targetWorkspace: string
  targetFilters: Record<string, string>
  targetRecordId: string
}
```

### ChangeEntry Props

```typescript
interface ChangeEntryProps {
  severity: 'critical' | 'warning' | 'info'
  icon: string
  timestamp: Date
  description: string
  actorName: string | null
  targetWorkspace: string
  targetFilters: Record<string, string>
  targetRecordId: string | null
  onClick: () => void
}
```

---

## 6. Session State Schema

```typescript
// Stored in localStorage under key 'ahram_session_state'
interface SessionState {
  version: 1
  // Timestamps
  lastLoginTimestamp: string      // ISO
  lastLogoutTimestamp: string     // ISO
  sessionCount: number            // Incremented each login

  // Global filters
  filters: {
    dateRange: { preset: string; start: string | null; end: string | null }
    companyId: string | null
    branchId: string | null
    warehouseId: string | null
  }

  // UI state
  isKpiExpanded: boolean
  activeWorkspaceId: string | null

  // Open workspaces
  openWorkspaces: Array<{
    id: string
    type: string
    filters: Record<string, string>
    title: string
    selectRecordId: string | null
  }>

  // History (for Zone 3 context)
  recentDecisions: Array<{
    type: string       // 'approve' | 'reject' | 'resolve'
    entityType: string // 'order' | 'customer'
    entityId: string
    timestamp: string
  }>
}
```

---

## 7. Tab Behavior (V3)

```
The Command Center tab:
- Is ALWAYS first in the tab list
- Is PINNED (cannot be closed)
- Re-opens to same state after session restore

Navigating from CC:
- Row click → opens workspace in NEW tab → CC stays
- Action button → opens workspace in NEW tab → CC stays
- KPI click → opens workspace in NEW tab → CC stays
- Summary bar click → opens workspace in NEW tab → CC stays

Deduplication:
- If same workspace type + same filter combination already exists,
  switch to that tab instead of creating a duplicate
```

---

## 8. Keyboard Shortcuts (V3)

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Global Search |
| `Ctrl+R` | Refresh All |
| `Alt+1` | Focus Zone 1 (Immediate Decisions) |
| `Alt+2` | Focus Zone 2 (Operational Problems) |
| `Alt+3` | Focus Zone 3 (Business Changes) |
| `Alt+4` | Toggle Zone 4 (Business Health) |
| `Ctrl+S` | Save current session (manual) |
| `Escape` | Close dropdown / modal |
| `Enter` | Activate focused item |

---

## 9. Widget-to-Provider Mapping

| Widget | Provider Method | Parameters |
|---|---|---|
| Pending Approvals | `salesOrder.searchOrders()` | `{ status: 'submitted,reviewing', limit: 6, ...globalFilters }` |
| Returned/Cancelled | `salesOrder.searchOrders()` | `{ status: 'returned,cancelled', limit: 6, ...globalFilters }` |
| Blocked Warehouse | `salesOrder.searchOrders()` | `{ status: 'preparing', blockedHours: '>2', limit: 6, ...globalFilters }` |
| Delayed Shipping | `salesOrder.searchOrders()` | `{ delayed: true, limit: 6, ...globalFilters }` |
| Inventory Shortage | `productCatalog.searchProducts()` | `{ lowStock: true, limit: 6, ...globalFilters }` |
| Credit Exceeded | `customer.searchCustomers()` | `{ creditViolation: true, limit: 6, ...globalFilters }` |
| Returned Checks | `collection.searchCollections()` | `{ checkStatus: 'returned', limit: 6, ...globalFilters }` |
| Attendance | `attendance.searchAttendance()` | `{ date: today, status: 'absent,late', limit: 6, ...globalFilters }` |
| GPS Anomalies | Future | Future |
| Business Changes | `salesOrder.searchOrders()` + `customer.searchCustomers()` + `productCatalog.searchProducts()` + `collection.searchCollections()` | `{ updatedSince: lastLoginTimestamp }` |

> **Note**: `globalFilters` is automatically injected from `commandCenterStore.filters` — includes companyId, branchId, warehouseId, dateFrom, dateTo.

---

## 10. Sidebar Navigation Order

The sidebar follows business workflow priority, not module name alphabetical order:

```
🏠  المركز التنفيذي       (HOME — pinned, always first)
📋  المبيعات              (Sales — revenue generation)
👥  العملاء               (Customers — relationship management)
💰  التحصيلات             (Collections — cash flow)
📦  المخزون               (Inventory — stock management)
🏭  المخازن               (Warehouse — physical storage)
🚚  الشحن                 (Shipping — logistics)
👤  الحضور                (Attendance — workforce)
📊  التقارير              (Reports — analysis)
⚙️  الإدارة               (Administration — control)
🔧  الإعدادات             (Settings — configuration)
```

---

## 11. 3-Level Refresh

| Level | Shortcut | Behavior |
|---|---|---|
| **Current Workspace** | `Ctrl+R` | Re-fetches only the active workspace. Other workspaces + CC unchanged. |
| **Visible Content** | `Ctrl+Shift+R` | Re-fetches active workspace + all visible Command Center zones. |
| **Everything** | `Ctrl+Alt+R` | Re-fetches ALL open workspaces + CC. Full sync without losing state. |

Refresh button shows a dropdown menu:
```
[🔄 Refresh ▼]
├── 🔄 Current Workspace    (Ctrl+R)
├── 🔄 Visible Content     (Ctrl+Shift+R)
└── 🔄 Everything          (Ctrl+Alt+R)
```

---

## 12. Global Filter Inheritance

Every workspace automatically inherits:
- `companyId` — from CompanySelector
- `branchId` — from BranchSelector  
- `warehouseId` — from WarehouseSelector
- `dateFrom`, `dateTo` — from DateRangeSelector

### Implementation

```typescript
// Each workspace receives merged filters:
function useWorkspaceFilters(localFilters: Record<string, string>) {
  const globalFilters = useCommandCenterStore(s => s.filters)
  
  return {
    ...globalFilters,  // automatic inheritance
    ...localFilters,    // workspace-specific overrides
  }
}
```

Workspaces do NOT need to implement their own company/branch/warehouse selectors. The global toolbar handles all of them.

---

## 13. Keyboard Shortcuts
