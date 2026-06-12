# V1 → V2 Delta Summary

**Source:** `DESIGN_WORKDAY_TRACKING.md` → `DESIGN_WORKDAY_TRACKING_V2.md`  
**Date:** 2026-06-11  
**Type:** Architectural Alignment (no foundations rebuilt)

---

## What Changed

### 1. Governance Model (Section 13 — Replaced)

**V1:** Role-based access table using Arabic role names (`سوبر أدمن`, `رئيس مجلس الإدارة`, `أدمن`, `مدير مبيعات/مدير البيع`, `مشرف`).

**V2:** Capability-based governance using `check_capability(p_token, 'attendance.*')` codes.

**Why:** The project uses capability-based governance everywhere (orders, customers, visits, etc.). Attendance was the only module using role-name checks, which is inconsistent, non-composable, and breaks when role names change.

**Impact:** 10 management RPCs need governance migration from:
```sql
r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
```
To:
```sql
public.check_capability(p_token, 'attendance.live_monitor')
```

---

### 2. Ownership Visibility (Section 13 — Replaced)

**V1:** No clear ownership model. Manager filtering used an ad-hoc `manager_id` UNION that doesn't recurse the full subtree.

**V2:** Uses `app.get_subtree_ids(v_session.employee_id)` — the same recursive CTE used by orders, customers, visits, and all other governed entities.

**Why:** Managers must see only their team, directors see their branches, board sees all. This is the project-wide standard.

**Impact:** 9 management RPCs need a scoping filter added. The hierarchy (corrected per business governance decision):

```
الإدارة العليا (ياسر توفيق, محمد سعيد, علي سعيد, محمود سعيد — all identical)
  → مدير البيع (خالد سعيد, REP001)
    → سوبر فايزر
      → مندوب
        → عميل تابع
```

**Key changes from V1 hierarchy:**
1. الإدارة العليا are unified — no distinction between them in visibility, dashboards, reports, or permissions
2. Single title `مدير البيع` replaces the duplicated `مدير المبيعات`/`مدير مبيعات`
3. Customer ownership is NOT restricted to مندوب — مدير البيع and سوبر فايزر may also own customers directly
4. All four upper management members have identical capabilities (`all attendance.*`), the same ownership scope bypass (`attendance.view_all`), and the same full access

---

### 3. Operational Productivity (Sections 10.2, 10.3, 10.5, 10.7 — Extended)

**V1:** Every management screen shows only: location, start time, attendance status, connection status.

**V2:** Every management screen ALSO shows: visit count, order count, collection count, new customer count.

**Why:** The primary question is "what did the employee accomplish?" not "where is the employee?"

**Impact per screen:**

| Screen | V1 Fields | V2 Additions |
|--------|-----------|-------------|
| Live Monitoring (10.2) | location, time, connection status | visit_count, order_count, collection_count, new_customer_count, net_minutes |
| Timeline (10.3) | GPS, breaks, visits | orders, collections, customers |
| Reports (10.5) | time, breaks, visits | orders, collections, customers, compliance |
| Team Map (10.7) | location, status | full productivity card |

---

### 4. Unified Operational Timeline (Section 10.3 — Replaced)

**V1:** Timeline supports: start/end workday, breaks, visits, GPS points.

**V2:** Timeline also supports: order created, collection taken, new customer created. Management can replay the employee day as an operational story.

**Why:** Attendance-only timeline describes movement but not productivity. Management needs to see the full operational picture in one scroll.

**Impact:** RPC `get_employee_day_timeline` must join `orders` (WHERE created_by = employee AND date = session.date), `collections`, and `customers`. Timeline UI must render these new event types with distinct icons and cross-module navigation.

---

### 5. Team Map Expansion (Section 10.7 — Extended)

**V1:** Employee marker shows: name, status, location.

**V2:** Employee card (on marker click) shows: name, status, connection, duration, net work, breaks, visits, orders, collections, new customers, last activity type + time.

**Why:** A manager needs to understand team productivity without opening multiple screens.

**Impact:** `get_team_map` RPC must return per-employee productivity counts. Frontend must render the expanded card.

---

### 6. Command Center Counters (Section 10.9 — Extended)

**V1:** 5 counters: active, on_visit, on_break, not_started, connection_loss.

**V2:** 9 counters: + zero_visits_today, zero_orders_today, inactive_over_2h, avg_net_hours_today.

**Why:** Command Center needs productivity signals, not just presence signals.

**Impact:** `get_command_center` RPC must compute additional counters from attendance data.

---

### 7. Operational Questions (Section 10.8 — Extended)

**V1:** 6 questions (who works, who hasn't started, who's on visit, who's on break, where are they, any problems).

**V2:** 10 questions (+ orders per rep, collections per rep, new customers per rep, productive time).

**Why:** Operations needs to know what the field force is producing, not just where they are.

---

## What Stayed the Same

| Section | Status | Reason |
|---------|--------|--------|
| 1-3 Database Schema & Tables | **Unchanged** | Existing schema is correct and supports all extensions |
| 4 RPC List (employee-facing) | **Unchanged** | 6 employee RPCs are correct |
| 5-6 Sync & Offline Model | **Unchanged** | Sync architecture is correct |
| 7-8 Storage & Battery | **Unchanged** | Estimates are correct |
| 9 Mobile UI Flow | **Unchanged** | Employee simplicity is preserved |
| 10.1 Settings | **Governance only** | UI is correct, only governance changes |
| 10.6 Alerts | **Extended** | Added zero_orders alert type, changed governance |
| 11-12 Retention & Cleanup | **Unchanged** | Correct as-is |
| 13 Employee Self-Access | **Unchanged** | Rep can only see self |
| Appendix A (Net Work Hours) | **Unchanged** | Still the official KPI |
| Appendix B-D | **Unchanged** | Navigation, registration, future-ready |

---

## Migration Cost Estimate

| Change | Files Affected | Effort |
|--------|---------------|--------|
| Register 9 capability codes | 1 SQL migration | Low |
| Replace role checks with check_capability() in 10 RPCs | 10 RPCs in 1 migration | Medium |
| Add ownership scoping (app.get_subtree_ids) to 9 RPCs | 9 RPCs | Medium |
| Add order_count/collection_count/new_customer_count to 4 RPCs | 4 RPCs + migration | Medium |
| Update LiveMonitoringPage to show productivity fields | 1 frontend file | Medium |
| Update TeamMapPage to show productivity card | 1 frontend file | Medium |
| Update TimelinePage to render unified events | 1 frontend file | High |
| Update ReportsPage to add new metrics | 1 frontend file | Medium |
| Update AlertsPage for governance | 1 frontend file | Low |
| Update Command Center counters | 1 RPC + 1 frontend | Low |
| **Total** | **~20 files** | **~3-4 days** |

---

## Key Principle

> Attendance is not a GPS tracking module that happens to know employee names.
> Attendance is an **operational productivity module** that uses workday and location data as one input among many (visits, orders, collections, customers) to answer the question:
> **"What did the field force accomplish today?"**
