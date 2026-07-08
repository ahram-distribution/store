# Executive Command Center — Interaction Flow & UX Prototype (V3)

**Version**: 3.0 — FINAL  
**Core concept**: Operating room interactions. Business flow cycles. Session continuity.

---

## 1. The Five-Question Scan (Detailed Walkthrough)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│  SCENARIO: Executive Supervisor logs in at 10:30. Last session: 08:30.    │
│                                                                           │
│  ── SECOND 1 ──                                                            │
│                                                                           │
│  Screen appears. First visual focus: ZONE 1 at top of viewport.          │
│                                                                           │
│  ⚡ PENDING APPROVALS [7]  — orange card, visible immediately            │
│  ↩️ RETURNED/CANCELLED [3] — orange card, visible immediately           │
│                                                                           │
│  ── SECOND 2 ──                                                            │
│                                                                           │
│  Eye moves to ZONE 2 (below Zone 1, still above fold):                   │
│                                                                           │
│  🔧 BLOCKED [4]    📦 DELAYED [5]    ⚠️ INVENTORY [12]   💳 CREDIT [8] │
│  💳 CHECKS [3]     👤 ATTENDANCE [5]                                    │
│                                                                           │
│  Brain processes: "12 inventory shortages + 8 credit violations = risks" │
│                                                                           │
│  ── SECOND 3 ──                                                            │
│                                                                           │
│  Eye moves to ZONE 3:                                                     │
│  "28 changes since 08:30 — checks returned, new orders, exceptions"      │
│  "10:08 CHK-045 returned — 1,240,000 ج.م — that's money losing NOW"    │
│                                                                           │
│  ── SECOND 4 ──                                                            │
│                                                                           │
│  Decision: "The biggest risk is the returned checks. 1.24 million ج.م  │
│  is too large to ignore."                                                 │
│                                                                           │
│  ── SECOND 5 ──                                                            │
│                                                                           │
│  Clicks CHK-045 row in Returned Checks card (Zone 2).                     │
│  CollectionsWorkspace opens with check selected.                           │
│  Executive can see customer, bank, amount, and take action.               │
│                                                                           │
│  ✅ PASS: The screen answered all 5 questions and drove action.          │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Business Flow Cycle

Every interaction follows this cycle:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│                    THE OPERATIONS CYCLE                                   │
│                                                                           │
│  1. SCAN  ──►  2. IDENTIFY   ──►  3. CLICK   ──►  4. ACT   ──►  5. RETURN │
│                                                                           │
│  SCAN:     Look at all 3 zones. Which items are critical? Which count    │
│            is highest? Which changed most recently?                       │
│                                                                           │
│  IDENTIFY: Choose the single most important item to address NOW.         │
│            (Severity color + count badge + recency = priority)           │
│                                                                           │
│  CLICK:    One click on the row or action button.                        │
│                                                                           │
│  ACT:      Workspace opens. Record is pre-selected. Filters are          │
│            pre-applied. Executive takes action (approve, reject, etc.)   │
│                                                                           │
│  RETURN:   Click Command Center tab. Next item. Next cycle.              │
│                                                                           │
│  REPEAT until Zone 1 = empty, Zone 2 = empty, Zone 3 = "all clear".     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Session Resume Flow

```
SCENARIO: Executive closes app at 10:30. Reopens at 14:00 same day.

CLOSE EVENT (10:30):
├── Session state serialized:
│   ├── lastLoginTimestamp: 08:30
│   ├── lastLogoutTimestamp: 10:30
│   ├── filters: company=all, branch=cairo, warehouse=all
│   ├── isKpiExpanded: false
│   ├── openWorkspaces: [SalesWorkspace(status=submitted), CustomersWorkspace]
│   ├── activeWorkspaceId: SalesWorkspace-abc123
│   └── recentDecisions: [approved ORD-191, rejected ORD-188]
└── Saved to localStorage: ahram_session_state

REOPEN EVENT (14:00):
├── DesktopShell mounts
├── Token exists → validate → OK
├── Read ahram_session_state from localStorage
│
├── RESTORE:
│   ├── GlobalToolbar: company=all, branch=cairo, warehouse=all
│   ├── WorkspaceManager: open SalesWorkspace + CustomersWorkspace tabs
│   ├── TabBar: SalesWorkspace is active
│   ├── Zone4: collapsed (as before)
│   └── Command Center loaded with restored filter context
│
├── ZONE 3:
│   ├── Last session: 08:30 → 10:30 (2h)
│   ├── Current time: 14:00
│   ├── Changes since 10:30 shown: "ماذا تغير منذ جلستك السابقة (10:30)؟"
│   ├── 12:15 → ORD-195 approved by مدير المبيعات
│   ├── 11:30 → CHK-047 cleared (بنك الأهلي)
│   ├── 10:45 → New order ORD-197 (الصعيد للتجارة)
│   └── ... 15 more changes
│
└── Executive scanned Zone 1-2-3 → identified new items since 10:30
    → resumed work cycle
```

---

## 4. Zone 1 — Immediate Decision Flow (Pending Approvals)

```
EXECUTIVE: Sees "7 orders awaiting decision" in Zone 1.
           Clicks "ORD-191" row (waiting 2 days, highest urgency).

SYSTEM:
│
1. workspaceStore.addWorkspace({
     type: 'sales',
     filters: { status: 'submitted,reviewing' },
     selectRecordId: 'ORD-191',
     title: 'ORD-191 — مكة سوهاج للإنشاءات',
   })
│
2. SalesWorkspace mounts
   ├── DataGrid loaded with submitted+reviewing orders
   ├── ORD-191 highlighted with detail panel open
   ├── Action buttons: [✅ اعتماد] [❌ رفض] [📋 تفاصيل]
│
3. Executive reviews:
   ├── Customer: مكة سوهاج للإنشاءات (phone: 0112 345 678)
   ├── Items: 5 أصناف
   ├── Total: 124,500 ج.م
   ├── Payment: شيك (CHK-045) ← THIS IS THE RETURNED CHECK!
   ├── Credit: 150,000 / limit 200,000
   └── Note from sales: "العميل يطلب السرعة"
│
4. Executive discovers: Order's payment check was returned at 10:08.
   ├── DECISION: Cannot approve while check is returned.
   ├── Action: Reject ORD-191 with reason "شيك مرتجع — انتظار تحصيل جديد"
   └── Decision saved to session.recentDecisions
│
5. Returns to Command Center tab.
   ├── Zone 1 count: now 6 pending (ORD-191 removed)
   ├── Zone 2: Returned Checks still shows CHK-045
   └── Next action: handle the returned check issue
```

---

## 5. Zone 2 — Problem Card Auto-Hide Flow

```
On initial load, ALL problem cards query their data source.

Scenario: No blocked orders, no delayed shipping, no GPS anomalies.

RESULTS:
├── Blocked Warehouse: 0 items → HIDDEN
├── Delayed Shipping: 0 items → HIDDEN
├── Inventory Shortage: 12 items → VISIBLE ⚠️
├── Credit Exceeded: 8 items → VISIBLE 🔴
├── Returned Checks: 3 items → VISIBLE 🔴
├── Attendance Exceptions: 5 items → VISIBLE 🟠
└── GPS Anomalies: 0 items → HIDDEN

ZONE 2 DISPLAY:
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ ⚠️ INVENTORY 12 │ │ 💳 CREDIT 8     │ │ 💳 CHECKS 3     │
├──────────────────┤ ├──────────────────┤ ├──────────────────┤
│ موز: 0          │ │ النور: +45k     │ │ CHK-045: 1.2M   │
│ سكر: 2          │ │ سوهاج: +32k     │ │ CHK-046: 800k   │
│ أرز: 5          │ │ الدلتا: +28k    │ │ CHK-047: 500k   │
│ +9 more         │ │ +5 more         │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
┌──────────────────┐
│ 👤 ATTENDANCE 5 │
├──────────────────┤
│ EMP-022: absent │
│ EMP-015: late   │
│ +3 more         │
└──────────────────┘

3 hidden cards. 4 visible cards. Grid reflows to fit.
```

---

## 6. Global Filter Change → Zone 3 Regeneration

```
EXECUTIVE: Changes company filter from "All" to "Company A"

SYSTEM:
│
1. commandCenterStore.setCompanyId('company-a')
│
2. All zones re-fetch:
   ├── Zone 1: Pending orders for Company A only
   ├── Zone 2: Problems scoped to Company A
   ├── Zone 3: Changes scoped to Company A
   └── Zone 4: KPIs for Company A
│
3. Zone 3 reloads with:
   ├── SUMMARY bar updates counts for Company A
   ├── Changes feed shows only Company A changes
   └── Session state updated: companyId='company-a'
│
4. (Session saved to localStorage for next resume)
```

---

## 7. Error Recovery (Per-Card)

```
Scenario: Inventory query fails (network timeout).

ZONE 2 DISPLAY:
┌──────────────────┐ ┌──────────────────┐
│ ⚠️ INVENTORY    │ │ 💳 CREDIT 8     │  ← Works normally
│    [❌ Error]   │ │                  │
│                  │ │                  │
│ [🔄 Retry]      │ │                  │
└──────────────────┘ └──────────────────┘

- Only INVENTORY card shows error
- CREDIT card remains loaded
- Clicking [🔄 Retry] re-fetches only INVENTORY
- On success → card shows data
- On failure → card stays in error state
```

---

## 8. Empty State (All Zones Clear)

```
All Zone 1 cards: 0 items → HIDDEN
All Zone 2 cards: 0 items → HIDDEN
Zone 3: No changes since last session

ZONE 1 DISPLAY:
┌────────────────────────────────────────────────────────────┐
│ ✅  لا توجد قرارات معلقة                                    │
│     جميع الطلبات تمت معالجتها.                               │
└────────────────────────────────────────────────────────────┘

ZONE 2 DISPLAY:
┌────────────────────────────────────────────────────────────┐
│ ✅  لا توجد مشكلات تشغيلية                                   │
│     جميع الأنظمة تعمل بشكل طبيعي.                           │
└────────────────────────────────────────────────────────────┘

ZONE 3 DISPLAY:
┌────────────────────────────────────────────────────────────┐
│ ✅  لا توجد تغييرات منذ جلستك السابقة                        │
│     كل شيء كما تركته.                                      │
└────────────────────────────────────────────────────────────┘

Entire screen shows green checkmarks.
Executive: "All clear. I can focus on strategic work."
```

---

## 9. Future Reserved Area — Activation Flow

```
NOT YET IMPLEMENTED:
┌──────────────────────────────────────────────────────────────┐
│ FUTURE RESERVED AREA (hidden, 0px height)                     │
│ [Space allocated in layout, zero visual footprint]            │
└──────────────────────────────────────────────────────────────┘

WHEN SYNC ENGINE IS IMPLEMENTED:
┌──────────────────────────────────────────────────────────────┐
│ FUTURE RESERVED AREA (16px)                                  │
│ [⎔ Local DB: Online] [⟳ Sync: 2m behind] [📴 Offline: 0]    │
└──────────────────────────────────────────────────────────────┘

WHEN AI ASSISTANT IS ADDED:
┌──────────────────────────────────────────────────────────────┐
│ [⎔ Local DB] [⟳ Sync: Live] [📴 Offline: 0] [🤖 AI: Active] │
│ [🗄️ DB Health: 98%] [⬆️ Update: v1.2.0] [🧩 Plugins: 3]    │
└──────────────────────────────────────────────────────────────┘

Architectural rule:
- Adding a new system = 1 config entry + 1 component
- No layout changes needed
- Space already reserved
```

---

## 10. Animation Specs (V3)

| Element | Animation | Duration |
|---|---|---|
| Zone 1 cards mount | Slide up + fade | 300ms, staggered 100ms |
| Zone 2 cards mount | Fade in (left to right) | 250ms, staggered 80ms |
| Zone 3 entries mount | Fade in (top to bottom) | 200ms, staggered 50ms |
| Zone 4 expand/collapse | Height transition | 300ms ease-out |
| Card hide (0 items) | Fade out + collapse | 200ms ease-in |
| Card error → retry | Shake | 300ms |
| Session restore | Instant (no animation) | 0ms |
| Filter change | Data shimmer on changed widgets | as needed |
| Refresh | Button spin + card shimmer | 500ms |
| Context toolbar commands | Slide down from toolbar | 200ms ease-out |

---

## 11. Context-Aware Toolbar Flow

```
SCENARIO: User clicks a workspace tab. The toolbar adapts.

1. User opens SalesWorkspace (via NavMenu or Command Center click)

2. workspaceStore.setActiveTab('sales-abc123')

3. GlobalCommandToolbar detects active workspace type
   ├── Layer 1 (Global): remains unchanged
   └── Layer 2 (Commands): appears with Sales-specific actions:
       [📋 New Order] [✅ Approve] [❌ Reject] [📥 Export] [🖨️ Print]

4. User clicks [✅ Approve]
   ├── Approve action triggered in active SalesWorkspace
   └── Selected order (if any) is approved

5. User switches to CustomersWorkspace
   ├── Layer 2 changes to Customer-specific commands:
       [👤 New Customer] [📊 Statement] [📋 Visit History] [💰 Collections]
   └── Sales commands disappear

IMPLEMENTATION:
- WorkspaceDefinition includes optional `commands: ToolbarCommand[]`
- ToolbarCommand = { id, label, icon, shortcut?, onClick, disabled? }
- When workspace tab activated → read commands from definition → render
- Global layer (Layer 1) is always rendered
```

---

## 12. Workspace Memory Flow

```
SCENARIO: User is working in SalesWorkspace. Has set filters, sorted columns,
selected row 3. Switches to another tab. Returns.

1. SalesWorkspace is active
   ├── User sets filter: status='submitted'
   ├── User sorts by amount (descending)
   ├── User scrolls to row 15
   └── User selects row 17

2. User clicks CustomersWorkspace tab
   ├── workspaceStore.setActiveTab('customers-xyz')
   ├── Before deactivating SalesWorkspace:
   │   └── workspaceStore.updateWorkspaceState('sales-abc123', {
   │         filters: { status: 'submitted' },
   │         sortKey: 'amount',
   │         sortDirection: 'desc',
   │         scrollPosition: { top: 450, left: 0 },
   │         selectedRowId: 'ORD-197',
   │       })
   └── SalesWorkspace becomes inactive (display:none)

3. User clicks back on SalesWorkspace tab ('sales-abc123')
   ├── workspaceStore.setActiveTab('sales-abc123')
   ├── Before rendering:
   │   └── Read saved state from sales-abc123
   ├── DataGrid restored:
   │   ├── Filter: status='submitted'
   │   ├── Sort: amount desc
   │   ├── Scroll: row 15 visible
   │   └── Selection: row 17 highlighted
   └── User resumes exactly where they left off

SAVE TRIGGERS:
- Filter change → save immediately
- Column resize/reorder → save immediately
- Sort change → save immediately
- Row selection → save immediately
- Tab switch → save before deactivate
- Debounced: scroll position (500ms)

