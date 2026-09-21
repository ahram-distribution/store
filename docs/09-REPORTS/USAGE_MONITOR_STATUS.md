# USAGE MONITOR — STATUS REPORT

**Date:** 2026-09-21
**Project ref:** `fpsepeuykcioelcmkuup`
**Status:** Live (edge function `usage-monitor` v13 deployed, UI active at `/system/usage`)

---

## 1. Current Implementation State

The system automatically retrieves and displays real Supabase usage data inside the ERP:

| Area | Source | Method |
|------|--------|--------|
| Database storage usage | Postgres stats (`pg_database_size`, `pg_tablespace_size`) | Management API, server-side |
| Storage bucket usage | `storage.objects` aggregation | Management API, server-side |
| Edge Function invocations | `analytics/endpoints/usage.api-requests-count` + edge logs classification | Management API, server-side |
| REST API request counts (24h / 7d / 30d) | `usage.api-counts` / `analytics/endpoints/metrics` | Management API, server-side |
| Top REST endpoints | Analytics query | Management API, server-side |
| Org plan + derived Egress quota | `GET /v1/organizations/{slug}` + official plan table | Management API, server-side |
| Health status | API response checks | Management API, server-side |

The UI (`/system/usage`) renders: storage, sources, request counts, top endpoints, hot-ops, history, optimizations, and health alerts. A period selector supports 24h / 7d / 30d. Deployed edge function version: **v13**.

## 2. Confirmed Egress Limitation (Supabase official)

- **Real Egress usage is visible in the Supabase Dashboard** (org Usage page) only.
- **No supported, machine-readable official Egress endpoint is currently available.** Verified against the complete Management API OpenAPI specifications (v1 = 115 paths, v2 = 32 paths), plus live probes of all plausible org/project usage, billing, invoices, meters, metrics, and observability routes (all 404), the Prometheus metrics scrape (no egress series; NIC/pooler counters are not billable egress), the logs endpoints (docs: logs do not include response byte data), the CLI (no usage commands), and the official Supabase MCP (no egress tool). The org plan + derived quota (Free = 5 GB / 5 GB cached) IS retrievable via the documented API.
- **No manual Egress input was implemented.** The owner is not asked to paste values.
- **No Dashboard session/cookie workaround was implemented.** No private platform API, session reuse, or scraping is used.
- **The system is prepared for a future supported Egress API:** the quota/plan data already flows server-side, and the screen is structured so that when Supabase exposes a supported machine-readable Egress endpoint, real used/cached/cycle figures can be wired in without manual input.

## 3. Files

- `supabase/functions/usage-monitor/index.ts` — edge function (server-side aggregation)
- `src/services/usageMonitor.ts` — client service
- `src/pages/usage/UsageMonitorPage.tsx` — UI screen at `/system/usage`

---

> This report reflects the currently approved, published implementation state. No manual egress input and no dashboard-session workaround exist by design.