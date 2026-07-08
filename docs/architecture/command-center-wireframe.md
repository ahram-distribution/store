# Executive Command Center — Wireframe & Information Architecture (V3)

**Version**: 3.0 — FINAL  
**Layout**: 4 operational zones + future reserved area + session persistence  

---

## 1. Full-Screen Wireframe (≥1400px)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ///// GLOBAL TOOLBAR (48px) — Layer 1: Global ///////////////////////////////////////// │
│                                                                                              │
│  ⌕ بحث سريع  │  [📅 07/07/2026 ▼]  │  [🏢 الكل ▼]  │  [📍 الكل ▼]  │  [🏭 الكل ▼]  │   │
│  ─────────────────────────────────────────────────────────────────────────────────────────────── │
│  🔄 [Ctrl+R ▼]  │  🔔 3  │  👤 REP-001  │  ▼  │  ⏱️ آخر جلسة: 08:30                        │
│                                                                                              │
│  ///// GLOBAL TOOLBAR — Layer 2: Workspace Commands (shown when workspace active) ///////// │
│  ─────────────────────────────────────────────────────────────────────────────────────────────── │
│  [📋 طلب جديد]  [✅ اعتماد]  [❌ رفض]  [📥 تصدير Excel]  [🖨️ طباعة]                         │
│                                                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│  ZONE 1 — IMMEDIATE DECISIONS                                       "What needs my decision?"  │
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                                │
│  ┌──────────────────────────────────────────────┬──────────────────────────────────────────────┐│
│  │  ⚡ PENDING APPROVALS                     7 │  │  ↩️ RETURNED / CANCELLED                3 ││
│  │  Orders awaiting your decision              │  │  Orders returned / cancelled              ││
│  │                                              │  │                                            ││
│  │  ORD│ Customer         │ Amount │ Days      │  │  ORD│ Customer         │ Amount │ Reason   ││
│  │  ───┼──────────────────┼────────┼─────      │  │  ───┼──────────────────┼────────┼───────── ││
│  │  191│ مكة سوهاج        │124,500 │  2 ▲      │  │  155│ النور            │ 87,200 │ عميل رفض ││
│  │  192│ النور للتوريدات  │ 87,200 │  1        │  │  158│ الإسكندرية       │256,000 │ مخزون    ││
│  │  193│ الإسكندرية       │256,000 │  5h       │  │  023│ أمر توريد        │ 43,100 │ إذن مطلوب││
│  │  194│ الدلتا           │ 43,100 │  5 ⚠️     │  │      │ (طلب)           │        │         ││
│  │  +3 more                                     │  │                                            ││
│  │                                              │  │                                            ││
│  │  [📋 Review All Decisions →]                 │  │  [🔍 Review Returned →]                   ││
│  └──────────────────────────────────────────────┴──────────────────────────────────────────────┘│
│                                                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│  ZONE 2 — OPERATIONAL PROBLEMS                                      "What is broken?"          │
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                                │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐          │
│  │ 🔧 BLOCKED      │ │ 📦 DELAYED      │ │ ⚠️ INVENTORY    │ │ 💳 CREDIT       │          │
│  │ Warehouse    4  │ │ Shipping     5  │ │ Shortage     12 │ │ Exceeded     8  │          │
│  │ ───────────────── │ ───────────────── │ ───────────────── │ ───────────────── │          │
│  │ ORD-185  مكة     │ │ ORD-175  النور   │ │ موز صنف 7: 0   │ │ النور: +45,000  │          │
│  │   3 ساعات        │ │   2 أيام        │ │ سكر صنف 12: 2  │ │ سوهاج: +32,000  │          │
│  │ ORD-186  الأهرام │ │ ORD-178  مكة    │ │ أرز صنف 3: 5   │ │ الدلتا: +28,000  │          │
│  │   2.5 ساعات      │ │   1 يوم         │ │ زيت صنف 9: 8   │ │ +5 أكثر          │          │
│  │ +2 أكثر          │ │ +3 أكثر         │ │ +9 أكثر        │ │                  │          │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘          │
│                                                                                                │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐                              │
│  │ 💳 RETURNED     │ │ 👤 ATTENDANCE   │ │ 📍 GPS          │                              │
│  │ Checks       3  │ │ Exceptions   5  │ │ Anomalies    2  │                              │
│  │ ───────────────── │ ───────────────── │ ───────────────── │                              │
│  │ CHK-045  بنك مصر │ │ EMP-022  محمد   │ │ Truck-07: خارج │                              │
│  │   1,240,000 ج.م  │ │   بدون عذر     │ │   المسار        │                              │
│  │ CHK-046  بنك مصر │ │ EMP-015  أحمد   │ │ Truck-12: توقف │                              │
│  │   800,000 ج.م    │ │   تأخير ساعة    │ │   غير مبرر     │                              │
│  │ CHK-047  الأهلي  │ │ +3 أكثر         │ │                  │                              │
│  │   500,000 ج.م    │ │                  │ │                  │                              │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘                              │
│                                                                                                │
│  [عرض كل المشكلات التشغيلية →]  (opens consolidated view — future)                            │
│                                                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│  ZONE 3 — BUSINESS CHANGES (since 08:30 today)                        "What happened?"        │
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  SUMMARY:                                                                                │ │
│  │  🆕 Orders: +3    ✅ Collections: +2    🚚 Delivered: +5    👥 New Customers: +1         │ │
│  │  📦 Inventory: -3    💰 Price Updates: 2    📋 Status Changes: 12    🔄 Total: 28        │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────── │ │
│  │                                                                                         │ │
│  │   🔴  10:15 ←  ORD-191 → "قيد المراجعة"                    — أحمد حسن                   │ │
│  │   🔴  10:08 ←  Check #CHK-045 returned (بنك مصر) — 1,240,000 ج.م                       │ │
│  │   🟠  09:55 ←  New order ORD-196 created (مكة التجارية) — 43,100 ج.م                    │ │
│  │   🔴  09:30 ←  Customer credit limit exceeded — النور للتوريدات (+45,000)               │ │
│  │   🟠  09:15 ←  EMP-022 absent without notice — محمد علي                                  │ │
│  │   🔵  09:00 ←  ORD-188 status changed → "جاهز للتوصيل"                                   │ │
│  │   🔵  08:45 ←  New customer created — شركة النور للتجارة                                  │ │
│  │   🟠  08:30 ←  Inventory alert — موز صنف 7 reached zero                                  │ │
│  │                                                                                         │ │
│  │  [+6 more — عرض كل النشاطات →]                                                          │ │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│  ZONE 4 — BUSINESS HEALTH  [📊 Business Health ▼]                              (collapsible)  │
│  ═════════════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                        │
│  │ ▲12% ▲  │ │ ▲8% ▲   │ │ ⚠️+133%▲│ │ ▼-3% ▼  │                                        │
│  │ مبيعات   │ │ طلبات    │ │ بانتظار   │ │ تحصيلات   │                                        │
│  │ اليوم    │ │ هذا      │ │ الموافقة │ │ مستحقة   │                                        │
│  │ 125,430  │ │ الأسبوع  │ │ 7 طلبات  │ │ 890,500  │                                        │
│  │ أمس:112k │ │ 34 طلب  │ │ أمس:3    │ │ ج.م      │                                        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                        │
│  │ ▲50% ▲  │ │ ▲2% ▲   │ │ ⚠️+150%▲│ │ ⚠️+166%▲│                                        │
│  │ مخزون    │ │ نسبة     │ │ توصيلات   │ │ مخالفات   │                                        │
│  │ حرج      │ │ الحضور   │ │ متأخرة   │ │ الائتمان │                                        │
│  │ 12 صنف   │ │ 98%      │ │ 5        │ │ 8 عملاء  │                                        │
│  │ أمس:8    │ │ أمس:96%  │ │ أمس:2    │ │ أمس:3    │                                        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                                        │
│                                                                                                │
│  ┌──────────────────────┐  ┌──────────────────────┐                                          │
│  │  📈 Sales Trend      │  │  📊 Orders by Status │                                          │
│  │  (7-day chart)       │  │  (pie chart)         │                                          │
│  │  [future]            │  │  [future]            │                                          │
│  └──────────────────────┘  └──────────────────────┘                                          │
│                                                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  FUTURE RESERVED AREA (16px, hidden when empty)                                              │
│  [⎔ Local DB] [⟳ Sync] [📴 Offline] [🤖 AI] [🗄️ DB Health] [⬆️ Updates] [🧩 Plugins]    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  STATUS BAR (32px) — two parts                                                               │
│  [BUSINESS] 🟡 الموافقات: 7  |  🔴 المحظور: 4  |  🟠 المتأخر: 5  |  👤 الغياب: 2          │
│  [TECH] 🟢 متصل  |  🗄️ DB: جيد  |  🔄 متزامن  |  👤 REP-001  |  🕒 10:32:15  |  2h 15m    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Collapsed State (Default — Zone 4 Hidden)

```
┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                       │
├──────────────────────────────────────────────────────────────┤
│ ZONE 1 — IMMEDIATE DECISIONS                (35% viewport)   │
│ ┌───────────────────┐ ┌───────────────────┐                  │
│ │ Pending (7)       │ │ Returned (3)      │                  │
│ └───────────────────┘ └───────────────────┘                  │
├──────────────────────────────────────────────────────────────┤
│ ZONE 2 — OPERATIONAL PROBLEMS               (35% viewport)   │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│ │Blckd│ │Dloyd│ │Invnt│ │Credt│ │Rtrn │ │Attnd│            │
│ │     │ │     │ │     │ │     │ │Chk  │ │     │            │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘            │
├──────────────────────────────────────────────────────────────┤
│ ZONE 3 — BUSINESS CHANGES                    (30% viewport)   │
│ SUMMARY: Orders+3  Collec+2  Delivered+5  Customers+1       │
│ ──────────────────────────────────────────────────────────   │
│ 10:15 ← ORD-191 → قيد المراجعة                               │
│ 10:08 ← CHK-045 returned                                     │
│ 09:55 ← New order ORD-196                                    │
│ ...                                                           │
├──────────────────────────────────────────────────────────────┤
│ [📊 Business Health ▼]                                       │
├──────────────────────────────────────────────────────────────┤
│ STATUS BAR                                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Empty State (No action items, no problems, nothing changed)

```
┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   ╔════════════════════════════════════════════════════════╗  │
│   ║                                                        ║  │
│   ║          ✅  System Normal — All Clear                ║  │
│   ║                                                        ║  │
│   ║     No pending decisions. No operational problems.     ║  │
│   ║     Nothing changed since your last session.           ║  │
│   ║                                                        ║  │
│   ║     Last session: 08:30 — 10:32 (2h 2m)               ║  │
│   ║     All systems operational.                           ║  │
│   ║                                                        ║  │
│   ╚════════════════════════════════════════════════════════╝  │
│                                                               │
│   → Use the sidebar to navigate to specific workspaces       │
│   → Press Ctrl+K to search                                    │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│ [📊 Business Health ▼]                                       │
├──────────────────────────────────────────────────────────────┤
│ STATUS BAR                                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Information Architecture — Page Tree (V3)

```
DesktopShell
└── DesktopLayout
    ├── Sidebar (NavMenu — business workflow order)
    │   └── 🏠 المركز التنفيذي (pinned, always first)
    │   └── 📋 المبيعات
    │   └── 👥 العملاء
    │   └── 💰 التحصيلات
    │   └── 📦 المخزون
    │   └── 🏭 المخازن
    │   └── 🚚 الشحن
    │   └── 👤 الحضور
    │   └── 📊 التقارير
    │   └── ⚙️ الإدارة
    │   └── 🔧 الإعدادات
    │
    ├── GlobalToolbar
    │   ├── GlobalSearch [Ctrl+K]
    │   ├── SessionIndicator (آخر جلسة: HH:MM)
    │   ├── CompanySelector
    │   ├── BranchSelector
    │   ├── WarehouseSelector
    │   ├── RefreshButton
    │   ├── NotificationCenter
    │   └── UserMenu
    │
    ├── WorkspaceContainer
    │   ├── ExecutiveCommandCenter (DEFAULT — ALWAYS PINNED)
    │   │   ├── Zone1_ImmediateDecisions
    │   │   │   ├── DecisionCard_PendingApprovals
    │   │   │   └── DecisionCard_ReturnedCancelled
    │   │   ├── Zone2_OperationalProblems
    │   │   │   ├── ProblemCard_BlockedWarehouse
    │   │   │   ├── ProblemCard_DelayedShipping
    │   │   │   ├── ProblemCard_InventoryShortage
    │   │   │   ├── ProblemCard_CreditExceeded
    │   │   │   ├── ProblemCard_ReturnedChecks
    │   │   │   ├── ProblemCard_AttendanceExceptions
    │   │   │   └── ProblemCard_GpsAnomalies (future)
    │   │   ├── Zone3_BusinessChanges
    │   │   │   ├── ChangesSummaryBar
    │   │   │   └── ChangeEntry[*]
    │   │   ├── Zone4_BusinessHealth (collapsible)
    │   │   │   ├── ExecutiveKpiCard[*]
    │   │   │   ├── Chart_SalesTrend (future)
    │   │   │   └── Chart_OrdersByStatus (future)
    │   │   ├── FutureReservedArea
    │   │   └── SystemStatusBar
    │   │
    │   ├── SalesWorkspace (opened from Zone 1/2/4 clicks)
    │   ├── CustomersWorkspace (opened from Zone 2/4 clicks)
    │   ├── ProductsWorkspace (opened from Zone 2/4 clicks)
    │   ├── CollectionsWorkspace (opened from Zone 2/4 clicks)
    │   ├── AttendanceWorkspace (opened from Zone 2/4 clicks)
    │   └── ActivityLogWorkspace (opened from Zone 3 click)
    │
    └── StatusBar
```

---

## 5. Zone 2 — Horizontal Scroll Behavior

```
When >4 problem cards have active items:

┌──────────────────────────────────────────────────────────────────────────────┐
│ ← [🔧 Blocked] [📦 Delayed] [⚠️ Inventory] [💳 Credit] [💳 Checks]  →     │
│                                                                              │
│ ← scroll indicator                  visible cards                  scroll → │
└──────────────────────────────────────────────────────────────────────────────┘

- 4 cards visible at once (at ≥1400px)
- Scroll arrows appear when hidden cards exist
- Smooth scroll, snap to card boundaries
- Wheel scroll (horizontal) supported
```

---

## 6. Zone 4 — Expanded with Charts (Future State)

```
┌──────────────────────────────────────────────────────────────┐
│ ZONE 4 — BUSINESS HEALTH  [📊 إخفاء المؤشرات ▲]              │
├──────────────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│ │Sales │ │Orders│ │Pendng│ │Collec│                         │
│ │▲12%  │ │▲8%   │ │▲133% │ │▼-3%  │                         │
│ └──────┘ └──────┘ └──────┘ └──────┘                         │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│ │Stock │ │Attend│ │Deloyd│ │Credit│                         │
│ │▲50%  │ │▲2%   │ │▲150% │ │▲166% │                         │
│ └──────┘ └──────┘ └──────┘ └──────┘                         │
│                                                              │
│ ┌────────────────────────┐ ┌────────────────────────┐       │
│ │  Sales Trend (7 days)  │ │  Orders by Status      │       │
│ │                        │ │                        │       │
│ │  ▲                     │ │        ┌───┐           │       │
│ │  │    ██               │ │        │███│ Delivered  │       │
│ │  │  ██████             │ │        │███│ Submitted  │       │
│ │  │██████████           │ │        │███│ Preparing  │       │
│ │  └───┬──┬──┬──┬──┬──  │ │        └───┘           │       │
│ │     M T W T F S S      │ │                        │       │
│ └────────────────────────┘ └────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Decision Card — Row States

```
NORMAL ROW:
┌──────┬──────────────────────────┬────────────┬──────────┐
│ORD   │ مكة سوهاج للإنشاءات       │ 124,500    │ 2 أيام   │
│-191  │ (0112 345 678)            │ ج.م        │          │
└──────┴──────────────────────────┴────────────┴──────────┘

HOVER:
┌──────┬──────────────────────────┬────────────┬──────────┐
│ORD   │ مكة سوهاج للإنشاءات       │ 124,500    │ 2 أيام   │  ← bg: #334155
│-191  │ (0112 345 678)            │ ج.م        │          │
└──────┴──────────────────────────┴────────────┴──────────┘

URGENT ROW (>3 days waiting):
┌──────┬──────────────────────────┬────────────┬──────────┐
│ORD   │ الدلتا للاستيراد          │ 43,100     │ 5 أيام   │  ← bg: #7F1D1D
│-194  │ (0155 667 788)            │ ج.م        │ ⚠️       │  ← right border: #DC2626
└──────┴──────────────────────────┴────────────┴──────────┘
```

---

## 8. Session State — Visual Indicator

```
In the toolbar:

[⏱️  الجلسة السابقة: 08:30 — 2h 15m  |  استئناف الجلسة السابقة]

- Shows last login time and session duration
- "استئناف الجلسة السابقة" button appears if session was interrupted
- On click: restores previous filters, workspaces, active tab

In the status bar:

[مدة الجلسة الحالية: 2h 15m — منذ 08:30]
```

---

## 9. Responsive Layout (V3)

### Wide (≥1400px) — Full layout

```
┌──────────────────────────────────────────────┐
│ TOOLBAR                                       │
├──────────────────────────────────────────────┤
│ ZONE 1: 2-column (Pending + Returned)        │
├──────────────────────────────────────────────┤
│ ZONE 2: Scrollable 6-7 cards per row         │
├──────────────────────────────────────────────┤
│ ZONE 3: Full-width summary + feed             │
├──────────────────────────────────────────────┤
│ ZONE 4: 4-col KPI + 2-col charts (expanded)  │
├──────────────────────────────────────────────┤
│ FUTURE + STATUS                               │
└──────────────────────────────────────────────┘
```

### Medium (1100-1399px)

```
┌──────────────────────────────────────────────┐
│ TOOLBAR (compact)                             │
├──────────────────────────────────────────────┤
│ ZONE 1: 2-column (smaller cards)             │
├──────────────────────────────────────────────┤
│ ZONE 2: 3-4 visible cards, scroll rest       │
├──────────────────────────────────────────────┤
│ ZONE 3: Summary (compact) + 5 entries        │
├──────────────────────────────────────────────┤
│ ZONE 4: 4-col KPI (collapsed default)        │
├──────────────────────────────────────────────┤
│ FUTURE + STATUS                               │
└──────────────────────────────────────────────┘
```

### Narrow (800-1099px)

```
┌──────────────────────────────────────────────┐
│ TOOLBAR (hamburger)                           │
├──────────────────────────────────────────────┤
│ ZONE 1: 2-column or stacked                  │
├──────────────────────────────────────────────┤
│ ZONE 2: 2 visible cards, horizontal scroll   │
├──────────────────────────────────────────────┤
│ ZONE 3: Compact (3 entries)                  │
├──────────────────────────────────────────────┤
│ ZONE 4: 2-col KPI (collapsed default)        │
├──────────────────────────────────────────────┤
│ STATUS                                        │
└──────────────────────────────────────────────┘
```

---

## 10. File Structure (V3) — Visual Tree

```
commandcenter/
│
├── ExecutiveCommandCenter.tsx          ← Layout orchestrator
│   ├── GlobalCommandToolbar.tsx        ← Fixed top bar
│   ├── Zone1_ImmediateDecisions.tsx    ← Decision queue
│   │   └── DecisionCard.tsx            ← Reusable card
│   ├── Zone2_OperationalProblems.tsx   ← Problem strip
│   │   └── ProblemCard.tsx            ← Reusable card
│   ├── Zone3_BusinessChanges.tsx       ← Activity feed
│   │   ├── ChangesSummaryBar.tsx      ← Counts row
│   │   └── ChangeEntry.tsx            ← Single row
│   ├── Zone4_BusinessHealth.tsx       ← Collapsible
│   │   └── ExecutiveKpiCard.tsx       ← KPI + provenance
│   ├── FutureReservedArea.tsx         ← Hidden strip
│   └── SystemStatusBar.tsx            ← Bottom bar
│
├── commandCenterStore.ts               ← Zustand + session
├── commandCenterTypes.ts               ← All interfaces
├── sessionPersistence.ts               ← Save/restore
├── useCommandCenterData.ts             ← Data hook
│
├── DecisionCardConfig.ts               ← Card definitions
├── ProblemCardConfig.ts                ← Problem definitions
├── KpiConfig.ts                        ← KPI definitions
│
└── __tests__/
    ├── ExecutiveCommandCenter.test.ts
    ├── Zone1.test.ts
    ├── Zone2.test.ts
    ├── Zone3.test.ts
    ├── Zone4.test.ts
    ├── sessionPersistence.test.ts
    └── commandCenterStore.test.ts
```
