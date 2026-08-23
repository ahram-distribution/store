# AHRAM ⇄ سهل Parity — Implementation Status

Date: 2026-08-23. Scope: real سهل-style workspace inside AHRAM at `/sahl` (Supabase RPCs + React pages).
All DB work verified against the live Supabase project via transactional scripts (`scripts/tmp_apply_verify_sahl_g*.cjs`, all BEGIN…ROLLBACK). No commits/pushes; migrations applied locally to the dev database only.

## Legend
- ✅ **IMPLEMENTED + TECHNICALLY VERIFIED** — code + migration applied and exercised end-to-end via SQL/RPC test harness.
- 🖥️ **NEEDS OWNER BROWSER TEST** — UI built and typecheck-clean; visual/runtime confirmation by the owner pending.
- ⬜ NOT YET IMPLEMENTED.

## G1 — Foundations (stores / treasuries / settings) ✅ + 🖥️
- Migration `20260824_sahl_foundations_stores_treasuries.sql`: sahl_stores, sahl_treasuries, sahl_store_balances, sahl_store_moves, sahl_settings (+MAIN seeds), transfers RPC `sahl_transfer_treasury`.
- Verified: 21+ assertions in g1 script (guards: CODE_LOCKED, DUPLICATE_CODE, capability gates).
- Treasury page `/sahl/treasuries`; settings RPCs consumed by G7 screen. Owner browser test pending.

## G2 — POS product catalog ✅
- `sahl_get_pos_products(p_token)` — active products with unit pricing (قطعة/دستة/كرتونة), stock join, search-friendly shape.

## G3 — Sales core (invoices / quotes / reservations) ✅ + 🖥️
- Migration `20260825_sahl_sales_module.sql` (+`20260826b` open-credit seeding): sahl_invoices/items, numbering INV-/QUO-, posting core (inventory FIFO avg-cost, treasury legs cash/card, customer credit for آجل, quote stock reservation), void reversal, convert quote→invoice, browse/list RPCs. **Verified 36/36** incl. INSUFFICIENT_STOCK, PAID_EXCEEDS_TOTAL, CUSTOMER_REQUIRED_FOR_CREDIT, guard no-duplicate-move.
- UI: `SahlPosPage` (sale/quote toggle, quick customer add, unit auto-pricing, discount/additions/tax, cash+card split, print-after-save, F2/F9/F10), `SahlInvoicesPage` (filters, summary cards, detail dialog, طباعة/إلغاء/تحويل), `sahl-printing.ts` RTL builders (80mm roll + A4, hidden-iframe print). Routes `/sahl/pos`, `/sahl/invoices`. Owner browser test pending.

## G4 — Multi-store / multi-drawer wiring ✅ + 🖥️
- Migration `20260827_sahl_g4_store_drawer_params.sql`: helpers `sahl_resolve_store/sahl_resolve_treasury` (settings defaults, MAIN fallback); optional params on `sahl_post_receipt/expense/purchase/approve_sales_return/post_purchase_return`; exact `sahl_store_moves` journaling under store-guard; treasury attribution on transactions. **Verified 21/21**.
- UI: store/drawer selectors wired into Purchases, Receipts, Expenses, Returns pages (both call sites pass params). Typecheck clean; owner browser test pending.

## G5 — Installments ⇄ cheques linkage ✅ + 🖥️
- Migration `20260828_sahl_g5_installment_cheque_linkage.sql`: re-signed `sahl_receive_installment(token, plan, amount, method='cash', ref, notes, treasury, bank, due)`; cheque-method receipt defers treasury movement, registers linked incoming cheque (bank+number+due required), collection stays 'pending' → finalized to 'treasury_posted' on cheque clear; `sahl_cheque_action(+p_treasury_id)`; bounce/cancel reverses FIFO allocation, restores plan totals/status, adds outstanding back + ledger 'credit' row. **Verified 27/27**.
- UI: receive dialog gains drawer select; cheque method reveals bank + due-date fields with validation and new arg order; Cheques page has settlement-account select applied on clear. Owner browser test pending.

## G6 — Reports expansion ✅ + 🖥️
- Migration `20260829_sahl_g6_reports.sql`: `sahl_get_sales_report(from,to)` (totals + payment split + daily series + top items by revenue), `sahl_get_due_installments(days)` (due/overdue parts, active plans). **Verified 9/9**.
- UI: three new tabs in `/sahl/reports` — تحليل المبيعات (cards + daily table + revenue ranking), الاستحقاقات (installments due w/ overdue badges + open cheques sorted by due date), مخزون المخازن (per-store balances vs company total, carton breakdown).

## G7 — Settings screen 🖥️
- `/sahl/settings` page: preferences (default store/drawer codes, receipt paper width — persisted via `sahl_update_setting`), stores management (`sahl_upsert_store` add/edit), treasuries management (`sahl_upsert_treasury` add/edit with kind). Backend RPCs were already G1-verified; page is typecheck-clean, owner browser test pending.

## Cross-cutting notes
- All posting RPCs are idempotent-ish within guarded flows; store moves journal never duplicates external MAIN moves (verified).
- Ledger conventions: credit sale ↑outstanding = 'debit', reversals = 'credit'. Legacy receipt rows log 'debit' while reducing balance — pre-existing cosmetic issue, untouched.
- Known pre-existing quirk kept out of scope: legacy receipts ledger sign.
- Session forging for tests requires `identity_id` from employees; `app.session_roles` does not exist (capabilities derive from role).
- Test token used by verify scripts: `c3f2a4b5-1111-4b02-8e22-62a8d3c4e502`.

## Build
- `vite build` green after final group (PWA precache 50 entries).
- TypeScript project references clean for all `src/pages/sahl/**` and routes.

## Suggested owner test path (browser)
1. `/sahl` dashboard → new cards المبيعات / الفواتير والعروض / الإعدادات.
2. `/sahl/pos`: sell قطعة/دستة with cash+card split, then print; repeat as عرض أسعار with reserve.
3. `/sahl/invoices`: convert quote → invoice; void a posted invoice with reason.
4. Purchase into a non-default store; confirm `/sahl/reports` → مخزون المخازن reflects it.
5. Installment plan: receive by cheque → confirm no treasury move; clear cheque from `/sahl/cheques` choosing a drawer → confirm inflow + collection finalized; bounce another → confirm reversal.
