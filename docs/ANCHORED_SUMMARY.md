# Anchored Summary — Targets & KPI System

## Goal
Complete Phase 0 (Target System Audit) → Phase 0.5 (Governance Repair Plan, final) → Begin implementation

## Status

| Component | Status | Date |
|-----------|--------|------|
| F1 KPI structure audit | ✅ COMPLETE | 2026-06-22 |
| F2 canonical KPI unification (get_work_hours_ledger) | ✅ COMPLETE | 2026-06-22 |
| F3 canonical KPI enforcement | ✅ COMPLETE | 2026-06-22 |
| F4-F5 canonical KPI alignment | ✅ COMPLETE | 2026-06-22 |
| Production bug: EmployeeWorkdayDetailPage crash | ✅ FIXED (get_work_hours_ledger join fix) | 2026-06-22 |
| Phase 0: Target System Audit | ✅ COMPLETE | 2026-06-22 |
| Phase 0.5: Final Governance Repair Plan | ✅ COMPLETE & APPROVED | 2026-06-22 |

## Official Source of Truth (Approved)

### Standard Rep Targets
| KPI | Value |
|-----|-------|
| Sales | 5,000,000 EGP |
| Orders | 250 |
| Visits | 250 |
| New Customers | 30 |

### Weights
| KPI | Weight |
|-----|--------|
| Sales | 75% |
| Orders | 7.5% |
| Visits | 7.5% |
| New Customers | 10% |
| Collections | 0% (deferred) |
| **Total** | **100%** |

### Manager Rule
- **No independent target** — no row in `employee_monthly_targets`
- Target = `SUM(Active Team Members Targets)` — computed dynamically
- No coefficient (deferred, pending data review after 2-3 months)
- Auto-recalculate on any team composition change (new rep, transfer, activation, deactivation)

## Issues Found (Phase 0)

1. Collections_target regression in 6 RPCs (upsert, get, performance, drill-down ×2, dashboard)
2. Weight overrides ignored in get_governed_target_performance
3. No manager aggregation in EmployeeTargetsPage or any drill-down RPC
4. Role filter mismatch between page and RPC
5. Achievement recalc bug on edit save
6. Collections KPI missing from performance score (beyond regression — also empty in company_weight)

## Key Decisions
1. Collections excluded from score until Collections Governance review complete
2. Manager target = Sum(Active Team Members Targets), no storage, no manual entry
3. Weights adopted as 75/7.5/7.5/10 (hardcoded, not read from company_monthly_targets)
4. get_effective_weights() restored in performance RPC, scoped to 4 KPIs only
5. Performance_weights_config not used until annual review needed
6. Manager upsert blocked — FORBIDDEN for manager roles

## Execution Order (Approved — Start Phase 1)

```
Phase 1: Collections Pipeline Repair  ← CURRENT
  → Impact Analysis → Reality Validation → Verification Report
Phase 2: Weights Repair
  → Impact Analysis → Reality Validation → Verification Report
Phase 3: Manager Aggregation
  → Impact Analysis → Reality Validation → Verification Report
Phase 4: Role Alignment & Cleanup
  → Impact Analysis → Reality Validation → Verification Report
```

**Rule**: Stop immediately if any KPI/Target/Weight conflicts with approved Source of Truth.

## Files
- `docs/PHASE0_TARGET_SYSTEM_AUDIT.md` — Full Phase 0 audit + Phase 0.5 final governance plan (sections A-F)
- `docs/ANCHORED_SUMMARY.md` — This file
