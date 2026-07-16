# Release Gate Standard — Identity Integrity Verification

**Date:** 2026-07-14  
**Purpose:** Make identity verification a permanent part of the deployment process. Any deployment that touches identity-related columns, RPCs, or views is not considered successful unless verification passes.

---

## 1. The Rule

> **No deployment is complete until `scripts/verify_identity_integrity.mjs` returns ALL PASS against production.**

This applies to any deployment that modifies:
- `orders.owner_id`, `orders.created_by`, `orders.changed_by`
- `collections.owner_id`, `returns.owner_id`
- `employees.id`, `employees.identity_id`
- Any RPC or view that joins on these columns
- Any trigger, FK, or constraint on the above

---

## 2. Verification Scripts

| Script | When to Run | What It Checks |
|--------|-------------|----------------|
| `scripts/verify_identity_integrity.mjs` | Every deployment | Contaminated rows, orphaned rows, new-order validity, cross-table FK integrity |
| `scripts/observation_monitor.sql` | Every 6h for 48h post-deploy | 5 checks: contamination, orphaned, FK integrity, new-order validity, KPI match |
| `scripts/full_regression_suite.mjs` | Major schema changes | 18-test suite (requires logged-in session token) |

---

## 3. Gate Checklist

**Pre-deployment:**
- [ ] Run verify_identity_integrity.mjs — save output as baseline
- [ ] Verify baseline shows 0 contaminated, 0 orphaned
- [ ] If baseline is non-zero: STOP. Root cause analysis required before deploy

**Post-deployment:**
- [ ] Run verify_identity_integrity.mjs against production
- [ ] Compare against baseline — diff must be EXACTLY zero (no new contamination, no data loss)
- [ ] If diff exists: rollback or hotfix immediately (do not leave contaminated data for next sprint)

**48-hour monitoring:**
- [ ] Run observation_monitor.sql every 6h
- [ ] All 5 checks must return clean for 48 consecutive hours
- [ ] If any check fails: incident response per POST_INCIDENT_REPORT_20260714.md

---

## 4. Ownership

| Role | Responsibility |
|------|----------------|
| **Deploying engineer** | Runs verification, signs off gate checklist |
| **Code reviewer** | Verifies gate checklist is complete before approving merge |
| **Tech lead** | Reviews any non-zero result before deploy proceeds |

---

## 5. Enforcement Automation (Future)

Long-term, these checks should be automated:

1. **GitHub Actions / CI step** — Run `verify_identity_integrity.mjs` against staging after migration:
   ```yaml
   - name: Identity Integrity Check
     run: node scripts/verify_identity_integrity.mjs
     env:
       SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
       SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
   ```

2. **Pre-commit hook** — Check that no new `identity_id` assignments to `owner_id` fields are introduced:
   ```bash
   # .githooks/pre-commit
   # Reject patterns like: owner_id.*identity_id or .owner_id = .*identity_id
   ```

3. **Cron-based monitoring** — Run `observation_monitor.sql` on a schedule and alert on failure

---

## 6. Escalation

If any verification step fails:

1. **Is it a false positive?** — Check the verification script logic and the raw data
2. **Is it a new contamination?** — Follow POST_INCIDENT_REPORT_20260714.md: snapshot, fix, verify, document
3. **Is it an orphan?** — Determine source: migrated order without employee? Deleted employee? Fix data or add FK
4. **Is it a KPI mismatch?** — The direct count and team activity must match. If not, there's a duplicate or missing row

---

## 7. Appendix: Quick Reference

```bash
# Pre/post deploy verification
node scripts/verify_identity_integrity.mjs

# 48-hour monitoring (run every 6h)
psql "$SUPABASE_URL" -f scripts/observation_monitor.sql

# Full regression (needs session token from logged-in browser)
node scripts/full_regression_suite.mjs
```
