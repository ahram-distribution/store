# Ahram ERP Desktop — Architecture Reference

**Last updated**: 07 Jul 2026  
**Status**: Final — Architecture frozen. Implementation ready.

---

## Architecture Documents

| # | Document | Covers |
|---|---|---|
| 1 | `executive-command-center-spec.md` | Full specification: 4 zones, session persistence, future area, widget map, data flow, file structure, implementation plan, acceptance criteria |
| 2 | `ux-display-rules-addendum.md` | 11 mandatory UX rules: calendar, display identity, UUID policy, business language, number context, empty states, filter visibility, density, No-IT test, 5-second test |
| 3 | `command-center-wireframe.md` | ASCII wireframes for all 4 zones at 4 breakpoints, card anatomy, empty/error/loading states, file structure visual tree |
| 4 | `command-center-navigation-flow.md` | Complete widget map, navigation decision matrix, session resume flow, keyboard shortcuts, widget-to-provider mapping |
| 5 | `command-center-interaction-flow.md` | 12 interaction flows: 5-second walkthrough, operations cycle, session resume, zone flows, error recovery, empty/loading states |

---

## Architecture Decisions Summary

### 4 Operational Zones (Priority Order)

| Zone | Content | Viewport |
|---|---|---|
| **Zone 1** — Immediate Decisions | Pending approvals, returned/cancelled orders, authorization requests | 35% |
| **Zone 2** — Operational Problems | Blocked warehouse, delayed shipping, inventory shortage, credit exceeded, returned checks, attendance exceptions, GPS anomalies | 25% |
| **Zone 3** — Business Changes | Summary bar + change feed since last session | 20% |
| **Zone 4** — Business Health | 8 KPIs with provenance, 2 charts (future), COLLAPSED BY DEFAULT | 20% |

### Session Persistence

| Item | Storage |
|---|---|
| Last login/logout timestamps | `ahram_session_state` in localStorage |
| Global filters (company, branch, warehouse, date) | `ahram_session_state` |
| Open workspaces + active tab | `ahram_session_state` |
| Recent decisions | `ahram_session_state` |
| KPI expand state | `ahram_session_state` |

### Future Reserved Area

7 system slots: Local PostgreSQL, Sync Engine, Offline Queue, AI Assistant, Database Health, Update Manager, Plugin Center. Space allocated in layout (16px), hidden until activated.

---

## 20 Mandatory UX Rules

| # | Rule | Summary |
|---|---|---|
| 1 | **Calendar Standard** | Gregorian only. Centralized formatter. |
| 2 | **Display Identity** | Business names, not IDs. |
| 3 | **Technical Information** | Never display UUID, RPC names, DB keys. |
| 4 | **Display Priority** | Name → Code → Status → Amount → Dates → Location. |
| 5 | **Business Language** | Business terminology only. No DB field names. |
| 6 | **Numbers with Context** | Every number has meaning, period, comparison, trend, drill-down. |
| 7 | **Empty States** | Contextual Arabic messages, not generic "No data". |
| 8 | **Filter Visibility** | Active filters always visible as removable chips. |
| 9 | **Information Density** | Compact tables, no oversized cards, no mobile spacing. |
| 10 | **No-IT Test** | Business user understands every value in <3s without IT. |
| 11 | **5-Second Executive Test** | Decision, delay, blockage, change, risk — all visible in 5s. |
| 12 | **Workspace Memory** | Every workspace remembers filters, columns, sort, scroll, selection independently. |
| 13 | **Global Filter Inheritance** | All workspaces automatically inherit company/branch/warehouse/date from toolbar. |
| 14 | **Context-Aware Toolbar** | Toolbar has 2 layers: global (always) + workspace commands (dynamic). |
| 15 | **User Profile Driven UI** | Desktop adapts to the logged-in employee's role. Home screen is role-driven. |
| 16 | **No Empty Modules** | If a user cannot access a menu item, hide it completely. Never disable. |
| 17 | **Role Aware Commands** | Toolbar, context menu, actions change by workspace + role + selection. |
| 18 | **Grid First** | Desktop is built around DataGrids. Cards are secondary. |
| 19 | **Action Over Display** | Every displayed item must be actionable. Minimize read-only information. |
| 20 | **Company Scale** | Support multiple companies, branches, warehouses, regions without redesign. |

---

## Implementation Order

| Phase | Scope | PO Review Required |
|---|---|---|
| **Phase 0** | Desktop Shell Finalization: toolbar, sidebar, status bar, workspace host, filter inheritance, per-workspace memory, 3-level refresh, future area | ✅ Yes |
| **Phase 1** | Session persistence + Zone 1 (Immediate Decisions) | ✅ Yes |
| **Phase 2** | Zone 2 (Operational Problems) | ✅ Yes |
| **Phase 3** | Zone 3 (Business Changes) | ✅ Yes |
| **Phase 4** | Zone 4 (Business Health — collapsible KPIs) | ✅ Yes |
| **Phase 5** | Charts, comparisons, forecasts | ✅ Yes |
| **Phase 6** | Integration: replace old Dashboard, build EXE | ✅ Yes |

Each phase must pass all 14 UX rules before the next phase begins. No phase may be merged with another.

---

## Key Constraints

- **No implementation code** until architecture is approved (current status)
- **260 existing tests** must continue to pass
- **Desktop tsc**: 0 errors from `desktop/tsconfig.json`
- **Pre-existing Playwright E2E failures** ignored per prior agreement
- **Provider contracts and mappers** are frozen for Phase 3B+
- **Runtime mode** selected through configuration only (mock/legacy/supabase/desktop)
