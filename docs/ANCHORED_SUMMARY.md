# Anchored Summary — Tracking & Attendance System

## Goal
Complete and close Tracking V1 (Phase A) + Phase B Lite with final operational/security/Arabic audit.

## Final Status

| Component | Status | Date |
|---|---|---|
| Phase A (connection_status fix) | ✅ APPROVED & CLOSED | 2026-06-19 |
| Phase B (full Event Platform) | 📋 DESIGN APPROVED — ON HOLD | 2026-06-19 |
| Phase B Lite (life signals via touch_session_activity) | ✅ IMPLEMENTED | 2026-06-21 |
| trackingInterval bug fix (300→900) | ✅ COMMITTED | 2026-06-22 |
| Operational audit (7 screens, 21 files) | ✅ COMPLETE | 2026-06-22 |
| Arabic language audit (15 files) | ✅ COMPLETE | 2026-06-22 |
| Information overload audit (5,460 lines) | ✅ COMPLETE | 2026-06-22 |
| Final executive report | 🏁 CREATED | 2026-06-22 |

## Key Changes Made
- `src/services/lifeSignalService.ts` — NEW: central signal service (app_open, app_resume, business)
- `src/services/trackingQueue.ts` — MODIFIED: addSignal/getSignals/flushSignals added
- `src/services/trackingEngine.ts` — MODIFIED: GPS 300s→900s, exposed sessionId/employeeId
- `src/App.tsx` — MODIFIED: app_open on mount, visibilitychange for app_resume
- 9 business page files — MODIFIED: lifeSignalService.notifyBusiness() added
- `src/pages/attendance/runtime/AttendanceRuntimePage.tsx` — FIXED: trackingInterval 300→900
- `docs/PHASE_A_VERIFICATION_REPORT.md` — Phase A closed
- `docs/phase_b_design.md` — Phase B on hold
- `docs/PHASE_B_LITE_DESIGN_DELTA.md` — Phase B Lite design delta

## Audit Results Summary

### Security
- `touch_session_activity(p_session_id)` — takes only UUID, no token validation
- Risk: authenticated user could reset another session's timer if UUID guessed
- Mitigation: UUIDs are unguessable; practical risk is low
- Recommendation: wrap in token-validating RPC in future migration

### Spam/Flood
- `visibilitychange` handler has no debounce — but `touch_session_activity` is an idempotent UPDATE
- Negligible practical impact

### GPS Data Growth
- Business signals (visit/order/collection/customer) call only `touch_session_activity()` — zero tracking_points
- GPS points only from `trackingEngine` at 900s intervals: ~96 pts/day/employee max
- With 45-day retention + 1000 employees: ~4.3M rows steady-state

### Operational Value (7 screens)
- **OperationsCenterPage** — Well-designed, alerts drive action
- **EmployeeWorkdayDetailPage** — Over-engineered, 4 noise items (tracking points ×4)
- **SalesManagerCCPage** — Scope creep (5 embedded forms), 1211 lines, biggest offender
- **UpperManagementDashboard** — Used as navigation menu, no strategic trends
- **MapTab/TeamMapPage** — Duplicate maps, need clustering

### Arabic Audit
- All connection_status values properly localized (متصل/متأخر/منقطع)
- "GPS" is mixed English/Arabic in 15+ strings — acceptable as loanword
- Fallback risk: raw English could display for unknown status values

### Info Overhaul
- P0: Remove forms from SalesManagerCC, merge maps, trim EmployeeDetailPage
- P0: Remove KPI duplicates, tracking points table, long stops from detail page
- P1: Add call/WhatsApp buttons, merge GlobalCounters+ProductivityArea
- P2: Move HistoricalPerformancePanel out of OpCenter

## Files
- `docs/FINAL_EXECUTIVE_REPORT.md` — Full final report with all findings
- `docs/ANCHORED_SUMMARY.md` — This file (per-session context)
