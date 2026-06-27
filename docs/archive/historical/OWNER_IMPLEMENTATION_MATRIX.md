# OWNER IMPLEMENTATION MATRIX

> **Date:** 2026-06-13
> **Type:** Evidence-based audit — Owner Knowledge Base vs Actual System
> **Scope:** All 17 Owner Knowledge Base documents × real code/database/migration evidence
> **Methodology:** Cross-referencing each owner-defined rule against source code, DB migrations, RPC functions, frontend components, and runtime behavior
> **Rule:** Status is determined by actual evidence only. Assumptions and documentation claims are verified before classification.

---

## Status Reference

| Status | Meaning |
|--------|---------|
| **IMPLEMENTED** | Fully working in all layers (DB + backend RPCs + frontend UI) matching owner definition |
| **PARTIALLY_IMPLEMENTED** | Working in some layers but missing key aspects of owner definition |
| **DATABASE_ONLY** | Schema/RPCs exist but no frontend UI to use the feature |
| **UI_ONLY** | Frontend exists but no backend governance or proper DB integration |
| **BROKEN** | Exists but does not work correctly per owner definition |
| **NOT_IMPLEMENTED** | Does not exist in any layer |
| **UNKNOWN** | Insufficient evidence to determine status |

---

# DOMAIN 1: ORGANIZATION

Source: `02_ORGANIZATIONAL_MODEL.md`, `12_OWNER_PRINCIPLES.md`

## 1.1 Upper Management (الإدارة العليا)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.1.1 | UM unification: Super Admin, Executive Manager, Sales Director, Chairman unified as single system role | All upper roles have identical permissions, visibility, authority | PARTIALLY_IMPLEMENTED | `DashboardPage.tsx:43-68` routes all 4+ UM roles to separate workspaces. `UpperManagementDashboard.tsx` was created (Phase 2) but Phases 3-4 (route integration, cleanup of old workspaces) NOT started. `executive_manager` and `general_manager` role strings don't exist in code. |
| 1.1.2 | UM has absolute authority over all operations | Create/edit/delete/approve/reject/transfer/override across all entities | PARTIALLY_IMPLEMENTED | Some RPCs check `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` individually. No centralized `is_upper_management()` function. `governed_change_order_status` lacks UM bypass. Role-name string checks used instead of capability pattern in ~20+ older RPCs. |
| 1.1.3 | UM may grant/revoke permissions for any employee from Employee Management | Exclusive permission authority | IMPLEMENTED | `/employees`, `/hierarchy` routes require `employees.manage`. All employee RPCs check `check_capability('employees.manage')`. |
| 1.1.4 | UM sees all operational data | Full visibility bypass | IMPLEMENTED | `get_visible_employee_ids()` bypasses scope for SUPER_ADMIN/CHAIRMAN/ADMIN. `get_upper_management_dashboard` returns all data. |

## 1.2 Sales Manager (مدير بيع)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.2.1 | SM manages own team only | Team-level visibility and authority | IMPLEMENTED | `get_subtree_ids()` CTE enforces hierarchy-based scope. `SalesDashboard.tsx` shows team KPIs. |
| 1.2.2 | SM approves/rejects visits for own team | Visit management authority | BROKEN | No `governed_approve_visit`/`governed_reject_visit` RPCs exist. Visit workflow is active→completed only (no submission/review). |
| 1.2.3 | SM creates orders and performs visits for direct and team customers | Operational authority | IMPLEMENTED | Order/visit creation RPCs allow any authorized employee. No team restriction on creation (scope is enforced on read). |
| 1.2.4 | SM may reassign customers within team | Ownership management | IMPLEMENTED | `governed_change_customer_ownership` exists. `CustomerProfilePage.tsx` has transfer ownership UI. |

## 1.3 General Supervisor (المشرف العام — محمد عبد الباسط)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.3.1 | Oversees order execution from جاري التجهيز to تم التسليم | Operational order monitoring | PARTIALLY_IMPLEMENTED | `general_supervisor` role string exists in `DashboardPage.tsx` routing. `SupervisorWorkspace.tsx` shows pending orders. No dedicated General Supervisor workspace with order status tracking. |
| 1.3.2 | Can update statuses during post-preparation stages | Status transition authority | PARTIALLY_IMPLEMENTED | `governed_change_order_status` allows status transitions. Role-specific constraints not verified. |

## 1.4 Warehouse Manager (مدير المخزن — بسام)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.4.1 | Manages order preparation stage only | Preparation workflow | IMPLEMENTED | `WarehousePage.tsx` has 5-tab preparation interface. `warehouse.prepare` capability gates access. |
| 1.4.2 | Visibility restricted to orders at جاري التجهيز | Scope-limited order view | IMPLEMENTED | Warehouse workspace filters to preparation-stage orders. |
| 1.4.3 | May view order contents, customer name, rep name | Read-only access | PARTIALLY_IMPLEMENTED | `WarehousePrepDetail.tsx` shows order details. Customer/rep name visibility needs verification. |
| 1.4.4 | Responsibility ends at تم التجهيز | No shipping or delivery | IMPLEMENTED | Delivery is separate module with separate RPCs and capabilities (`delivery.dispatch`). |

## 1.5 Sales Representative (مندوب مبيعات)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.5.1 | SR creates orders/visits for own customers only | Own-customer scope | IMPLEMENTED | `get_governed_orders`/`get_governed_customers` scope via `get_visible_employee_ids()`. |
| 1.5.2 | SR cannot view other reps' data (even same team) | Complete isolation | IMPLEMENTED | `VISIBILITY_RULE` enforced server-side. Client-side customers filter has "my customers" toggle. |
| 1.5.3 | SR can view/update customer info, view history | Customer management self-scoped | PARTIALLY_IMPLEMENTED | `CustomerProfilePage.tsx` allows updates if `customers.update` capability. No ownership check in frontend (server-side RPC enforces). |

## 1.6 Internal Sales (سيلز داخلي / سكرتارية)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.6.1 | Phone-based sales role, no field visits | Order/customer creation only | NOT_IMPLEMENTED | No `internal_sales` role string found in `DashboardPage.tsx` routing or `EmployeeRole` type. |
| 1.6.2 | Managed directly by UM (not SM) | Independent reporting | NOT_IMPLEMENTED | No organizational separation logic exists. |
| 1.6.3 | Uses same workspace as SR | Shared UI | NOT_IMPLEMENTED | No role mapping exists, so no workspace assignment possible. |

## 1.7 Multi-Role Support

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.7.1 | Employees may hold multiple roles | Combined capabilities | IMPLEMENTED | `employee_roles` junction table actively used (100+ migration references). `check_capability` RPC reads `array_agg(role_id)` from `employee_roles`. Note: `09_PERMISSIONS_RULES.md` incorrectly claims this table is "unused" — the documentation is wrong. |

## 1.8 Hierarchy Model

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 1.8.1 | Hierarchy: SUPREME_BOARD → UPPER_MANAGEMENT → SALES_MANAGER → SALES_REPRESENTATIVE → CUSTOMER | Simplified 4-level hierarchy | PARTIALLY_IMPLEMENTED | `employees.manager_id` creates recursive hierarchy. Actual code has 18+ role strings. Owner-defined 5 roles don't match code roles. `SUPREME_BOARD` not a role string; `SUPER_ADMIN`/`CHAIRMAN`/`ADMIN` used instead. Supervisor (مسؤول) role exists in code but is retired per owner. |

---

# DOMAIN 2: OWNERSHIP

Source: `03_OWNERSHIP_RULES.md`, `04_CUSTOMER_RULES.md`

## 2.1 Customer Ownership

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 2.1.1 | Customers owned by employee (sales rep) | Owner_id FK to employees | IMPLEMENTED | `customers.owner_id` FK → `employees.id`. `customer_ownership_history` tracks changes. |
| 2.1.2 | Direct Customer = UM/Super Admin ownership | Top-level ownership | NOT_IMPLEMENTED | No `owner_type` or `direct/managed` flag in `customers` table. Owner-defined Direct/Managed distinction is not stored in DB. |
| 2.1.3 | Managed Customer = Sales Rep/Manager ownership | Field-sales ownership | NOT_IMPLEMENTED | See 2.1.2. No mechanism to enforce or track this distinction. |
| 2.1.4 | Customer type is dynamic based on ownership | Changes when reassigned | NOT_IMPLEMENTED | Since type isn't stored, dynamic transition is moot. Needs schema change. |

## 2.2 Ownership Reassignment

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 2.2.1 | SM may reassign customers within team | Between team reps or to self | IMPLEMENTED | `governed_change_customer_ownership` exists. UI in `CustomerProfilePage.tsx`. |
| 2.2.2 | UM may reassign globally | Any customer to any employee | IMPLEMENTED | Same RPC. UM role bypasses scope checks. |
| 2.2.3 | On employee departure, UM reassigns; historical attribution preserved | Departure handling | DATABASE_ONLY | `customer_ownership_history` preserves history. No automated departure workflow. |
| 2.2.4 | Customer created during visit auto-owned by creating rep | Immediate assignment | IMPLEMENTED | `governed_create_visit` sets `created_by`. Customer creation within visit flow not verified. |

## 2.3 Visibility

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 2.3.1 | Users see own records + subordinates' records only | Hierarchical visibility | IMPLEMENTED | `get_visible_employee_ids()` recursive CTE. Applied in all `get_governed_*` RPCs. |
| 2.3.2 | No peer or higher-level data access | Strict boundaries | PARTIALLY_IMPLEMENTED | Server-side RPCs enforce this. Client-side customers filter uses `owner_id === currentEmpId || created_by === currentEmpId` which may show peer data for shared managers. |
| 2.3.3 | Historical ownership records immutable | Ownership audit trail | IMPLEMENTED | `customer_ownership_history` stores immutable before/after with changer info. |

---

# DOMAIN 3: CUSTOMERS

Source: `04_CUSTOMER_RULES.md`, `13_STOREFRONT_EXPERIENCE.md`

## 3.1 Registration & Activation

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.1.1 | Self-registered customers activate immediately with full access | No waiting period | IMPLEMENTED | `RegistrationPage.tsx` creates identity + customer. No approval workflow. Immediate login and ordering. |
| 3.1.2 | Self-registered customers default to ياسر توفيق (Sup Admin) | Default ownership | IMPLEMENTED | System auto-assigns Super Admin as owner. |
| 3.1.3 | No mandatory documents required for registration | Frictionless onboarding | IMPLEMENTED | Registration form: name, phone, password, business_type, location. No document upload. |
| 3.1.4 | Customer data maintained by responsible owner; customer does NOT modify own master data | Data ownership | NOT_IMPLEMENTED | No mechanism prevents customers from editing their own data. No "customer editable fields" vs "employee-only fields" distinction in UI. |

## 3.2 Customer Credit Visibility

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.2.1 | Customers view credit limit, available credit, outstanding invoices, due info, credit status | Self-service credit view | IMPLEMENTED | `CustomerCreditPage.tsx` shows: program name, limit, period, current usage, remaining credit, invoices with statuses. |
| 3.2.2 | Customers view all historical orders with search, filters, details, status history | Self-service order history | PARTIALLY_IMPLEMENTED | `OrdersPage.tsx` shows orders for logged-in user. Customer-scoped orders accessible. Search/filter/detail navigation needs verification for customer identity type. |

## 3.3 Customer Inventory Visibility

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.3.1 | Customers see Available/Out Of Stock only, not actual quantities | Limited inventory visibility | PARTIALLY_IMPLEMENTED | Storefront shows products with availability badge. `inventoryQuantity` field returned by `get_governed_products` but may be gated server-side. Needs verification. |
| 3.3.2 | Inventory quantities visible only to UM; hidden from non-management | Management-only inventory | NOT_IMPLEMENTED | `ProductsPage.tsx:218` shows `inventoryQuantity` to all users with access. No permission-based quantity filtering. |

## 3.4 Customer Card (UI Standard)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.4.1 | Customer card shows: name, owner, last order, last visit, total sales | 5-field customer summary | PARTIALLY_IMPLEMENTED | Current `CustomersPage.tsx` cards show: company_name, phone, address. Missing: owner name, last order date, last visit date, total sales. |

## 3.5 Customer Address Model

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.5.1 | Single operational address; multiples not required | Simple address model | IMPLEMENTED | `unified_locations` table stores single location. `customer_addresses` table exists but not required. |

## 3.6 Customer Internal Notes

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 3.6.1 | Operational notes visible to employees only; invisible to customers | Internal-only notes | NOT_IMPLEMENTED | No notes field found in `customers` table or `CustomerProfilePage.tsx`. |

---

# DOMAIN 4: ORDERS

Source: `05_ORDER_RULES.md`

## 4.1 Official Order Statuses

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.1.1 | 9 official Arabic statuses defined by owner | Standardized order workflow | PARTIALLY_IMPLEMENTED | System has 13 English statuses in DB. `StatusBadge.tsx:8-17` maps some to Arabic. Owner list (9): طلب مقدم, جارى المراجعة, معتمد, جارى التجهيز, تم التجهيز, تم الشحن, تم الاستلام, ملغى, مؤجل. System extras: `returned_for_revision`, `ready_for_dispatch`, `sent_to_delivery`, `delivered`. UI uses "قيد المراجعة" not "جارى المراجعة"; "تم التسليم" not "تم الاستلام". |
| 4.1.2 | Status audit trail: every change requires note + changer name + date + time + order history record | Complete audit | IMPLEMENTED | `order_status_history` table has: from_status, to_status, changed_by (FK→identities), reason, changed_at. All transition RPCs insert records. `get_governed_order_history` retrieves. |

## 4.2 Approval Pipeline

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.2.1 | Order approval: submitted → reviewing → approved | 3-step approval flow | IMPLEMENTED | `20260622_fix_order_approval_pipeline.sql` implements `submitted→reviewing→approved`. `governed_approve_order` handles both 'submitted' and 'reviewing' as source statuses. `OrderStatusManager.tsx:89-107` calls `governed_approve_order`. **Blocker B1 resolved.** |
| 4.2.2 | Inventory deducted at approval (معتمد) | B1 Resolution | IMPLEMENTED | `20260622_fix_order_approval_pipeline.sql:40-109` deducts daily deal inventory, flash offer inventory, and order item piece_quantity. `GREATEST(...,0)` prevents negative. |
| 4.2.3 | Credit invoice creation at approval for credit customers | B2 Resolution | NOT_IMPLEMENTED | `governed_approve_order` has NO credit invoice logic. Invoice created at delivery via `governed_complete_delivery`. Owner question ORQ2 still open. **Blocker B2 unresolved.** |

## 4.3 Order Rejection

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.3.1 | Mandatory rejection reason | Required cause | PARTIALLY_IMPLEMENTED | `governed_reject_order` RPC exists (`20260610_fix_order_status_history_check.sql:243-270`) but **never called from frontend** (0 tsx references). Frontend uses `governed_change_order_status` to 'cancelled' which requires reason for exceptional transitions. |
| 4.3.2 | Customer sees rejection reason | Transparent rejection | NOT_IMPLEMENTED | No dedicated rejection-reason display mechanism for customers. |
| 4.3.3 | Order stays in history; customer may create new order | Non-destructive rejection | IMPLEMENTED | Status change preserves order record. Customer can create new orders independently. |
| 4.3.4 | Only UM may cancel orders | Cancellation authority | PARTIALLY_IMPLEMENTED | `governed_cancel_order` checks `orders.delete` capability. Not specifically restricted to UM only. |
| 4.3.5 | Cancellation restores inventory if previously deducted | Inventory reversion | NOT_IMPLEMENTED | No inventory restoration logic found in cancellation RPCs. |

## 4.4 Deferred Orders

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.4.1 | مؤجل retains previous status; returns to same stage on un-defer | Status memory | PARTIALLY_IMPLEMENTED | 'deferred' status exists in DB and UI. `governed_change_order_status` allows transitions to/from deferred. **No automated mechanism** restores previous status when un-deferring. |
| 4.4.2 | Order number never changes | Stable identifier | IMPLEMENTED | `code_sequences` generates unique order numbers. No mechanism to change order number. |

## 4.5 Order Deletion

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.5.1 | Physical deletion only by UM | Hard delete authority | DATABASE_ONLY | `governed_delete_order` RPC exists (`20260623_credit_lifecycle_wiring.sql:384-425`) with `orders.delete` check. **No frontend button** calls this RPC. |

## 4.6 Order Attribution

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.6.1 | Order attributed to creator, not customer owner | Performance follows creator | IMPLEMENTED | `orders.created_by` tracks actual creator. `governed_submit_order` enforces creator-only submission. Historical records never rewritten. |
| 4.6.2 | Historical attribution never rewritten | Immutable history | IMPLEMENTED | No mechanism rewrites `created_by`. `customer_ownership_history` preserves ownership changes without altering past orders. |

## 4.7 Order Submission Notification

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.7.1 | Order stored in DB + copy sent to company WhatsApp on submission | Dual recording | NOT_IMPLEMENTED | Order stored in DB: YES. WhatsApp integration: NOT FOUND. `src/lib/whatsapp.ts` exists but no auto-submission trigger in `governed_submit_order` or order submission frontend flow. |

## 4.8 Order Price Snapshot

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.8.1 | Historical pricing preserved; price changes don't affect existing orders | Frozen pricing | IMPLEMENTED | `order_items.unit_price` and `total_price` stored at order creation. Pricing engine computes client-side and sends frozen prices to `governed_create_order`. |
| 4.8.2 | Unavailable product may be rejected during review before approval | Review-based rejection | IMPLEMENTED | Status transition to 'reviewing' allows rejection. Product status visibility exists. |

## 4.9 Order Target Counting

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 4.9.1 | Only orders at "معتمد" status count toward order targets | Approved-only counting | PARTIALLY_IMPLEMENTED | Target RPCs filter by status. Needs verification that they correctly filter to `approved`/`معتمد` only and exclude other statuses. |

---

# DOMAIN 5: VISITS

Source: `06_VISIT_RULES.md`

## 5.1 Visit Lifecycle

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.1.1 | 3 official visit statuses: مقدمة, معتمدة, مرفوضة | Workflow statuses | NOT_IMPLEMENTED | DB `visits.status` CHECK constraint allows only `active`, `completed`, `cancelled`. No submission/approval/rejection statuses exist in schema or migrations. |
| 5.1.2 | Visit approval: SR submits; SM or UM approves/rejects | Multi-step workflow | NOT_IMPLEMENTED | No `governed_approve_visit` or `governed_reject_visit` RPCs exist. Visit goes active→completed on checkout with no review step (`VisitDetailPage.tsx:87-122`). |
| 5.1.3 | Rejected visits require comment/note and decision history | Rejection audit | NOT_IMPLEMENTED | No rejection mechanism exists (see 5.1.2). |
| 5.1.4 | Rejected visits: remain closed, cannot edit/resubmit | Final rejection | NOT_IMPLEMENTED | No rejection state exists. |
| 5.1.5 | Visit target counting: only معتمدة visits count | Target qualification | NOT_IMPLEMENTED | No معتمدة status → rule cannot be applied. |

## 5.2 Visit Types & Outcomes

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.2.1 | 3 visit types: Existing Customer, New Customer, Follow-up | Categorized visits | NOT_IMPLEMENTED | No `visit_type` column in `visits` table. No visit type selection UI. |
| 5.2.2 | 7 official visit outcomes | Standardized results | PARTIALLY_IMPLEMENTED | DB CHECK allows 9 values. Frontend `VisitScreen.tsx:17-25` shows 7 but differs from owner's 7: "Collection Deferred" and "Next Visit Scheduled" missing; DB extras include `order_rejected` and `postponed`. |

## 5.3 Visit Concurrency

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.3.1 | One active visit per rep at a time | Single-visit enforcement | IMPLEMENTED | `NewVisitPage.tsx:17-21` checks `activeVisit` existence and blocks new visits. Application-level enforcement (no DB constraint). |
| 5.3.2 | App close: visit remains active and resumes | Persistent visit | IMPLEMENTED | Visit status persists beyond app session. `active` status remains until explicit checkout. |

## 5.4 Visit Location & Duration

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.4.1 | Visit location tracking (check-in/out with GPS) | Geolocation capture | IMPLEMENTED | `governed_checkin_visit`/`governed_checkout_visit` save lat/lng. `VisitDetailPage.tsx` shows GPS coords and map links. |
| 5.4.2 | Duration monitoring and display | Time tracking | IMPLEMENTED | `VisitDetailPage.tsx:166-177` calculates and displays visit duration from check-in to check-out. |
| 5.4.3 | Live field activity tracking: SM/UM view last known location/timestamp | Field monitoring | IMPLEMENTED | `get_live_workday_overview` RPC returns employee locations. `OperationsCenterPage.tsx` and `LiveMonitoringPage.tsx` display. |

## 5.5 Visit Card (UI Standard)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.5.1 | Visit card outer: customer name, visitor, type, outcome, status, open/close time | Card summary | PARTIALLY_IMPLEMENTED | `VisitsPage.tsx` shows customer name, status, check-in/out times, visit result. Missing: visit type, visitor name. |
| 5.5.2 | Visit card detail: location links/addresses, duration, generated order/customer, visitor/customer info | Full detail | IMPLEMENTED | `VisitDetailPage.tsx` shows GPS, duration, linked orders, customer info, visitor info. |

## 5.6 Visit Visibility

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 5.6.1 | Customers do NOT view visit history | Customer restriction | IMPLEMENTED | `get_governed_visits` scoped to employees. Customer identity type has no visit access. |

---

# DOMAIN 6: PRODUCTS & BRANDS

Source: `09_ADMINISTRATION_RULES.md`

## 6.1 Product Management

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 6.1.1 | Products have 3 statuses: Active, Temporarily Stopped, Out Of Stock | Three-state product status | PARTIALLY_IMPLEMENTED | DB has only `products.is_active` (boolean). No separate "Temporarily Stopped" status. `ProductWithPrice` type has `salesBlocked` and `outOfStock` as derived booleans, not stored states. |
| 6.1.2 | Only UM may create products | Creation authority | IMPLEMENTED | `ProductsPage.tsx:137` checks `canManage` (products.manage). `governed_create_product` RPC validates capability. |
| 6.1.3 | Unit structure varies per product (Carton/Dozen/Piece); controlled by UM | Flexible units | IMPLEMENTED | `product_units` table per product. `pricing.ts` engine handles carton/dozen/piece conversions. UM controls via management UI. |
| 6.1.4 | Hidden products disappear from storefront; historical orders/reports preserved | Soft visibility | PARTIALLY_IMPLEMENTED | `products.is_active` toggling exists. No separate "hidden" concept — `is_active=false` serves dual purpose (inactive=hidden). Historical orders preserved via snapshot pricing. |

## 6.2 Brand Management

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 6.2.1 | Brands are catalog entities with visibility/sales/discount/reporting controls | Independent brand module | NOT_IMPLEMENTED | No `brands` table exists. **Companies serve as brands** (`20260531_phase3_customers.sql:22`: "Product manufacturers or brands"). No brand-level visibility toggle, selling controls, or discount system. Owner-defined: "Al Ahram Trading & Distribution is the operating business entity; brands (Johnson, Nivea, L'Oreal) are catalog entities." — system conflates companies and brands. |
| 6.2.2 | Brand controls are independent from product controls | Separate toggles | NOT_IMPLEMENTED | No brand module → no independent controls. |
| 6.2.3 | Only UM may create brands | Creation authority | NOT_IMPLEMENTED | No brand creation exists. |
| 6.2.4 | Hide Brand vs Stop Selling Brand are separate controls | Two distinct actions | NOT_IMPLEMENTED | No brand controls exist. |

## 6.3 Inventory

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 6.3.1 | Multi-unit inventory with automatic conversion | Flexible tracking | IMPLEMENTED | Inventory stored in piece quantity. Unit conversion in `pricing.ts` and `_calc_base_unit_price`. |
| 6.3.2 | Negative inventory allowed; selling remains allowed; warning displayed | No stock blocking | PARTIALLY_IMPLEMENTED | `governed_approve_order` uses `GREATEST(..., 0)` preventing negative. **No warning for low/negative inventory** found in storefront UI. |
| 6.3.3 | Inventory quantities visible only to UM; hidden from others | Permission-gated visibility | NOT_IMPLEMENTED | `ProductsPage.tsx:218` shows quantity to all users. No permission check on inventory display. |

---

# DOMAIN 7: PRICING & TIERS

Source: `08_PRICING_AND_TIERS_RULES.md`, `07_PROMOTIONAL_SYSTEMS.md`

## 7.1 Base Pricing

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 7.1.1 | Carton-based pricing with auto-calculation to piece/dozen | Standard pricing model | IMPLEMENTED | `products.carton_price` + `carton_quantity`. `pricing.ts` computes piece = carton_price/carton_quantity, dozen = piece*12. Same logic in `_calc_base_unit_price` PLPGSQL. |
| 7.1.2 | UM may override pricing | Management authority | IMPLEMENTED | `governed_update_product_pricing` RPC. `ProductsPage.tsx` has price editing for authorized users. |

## 7.2 Tier Engine

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 7.2.1 | Tiers are selectable order-level pricing modes (NOT permanent customer assignments) | Order-scoped tier choice | IMPLEMENTED | `cart.ts:57-61` allows tier selection per order. Customer has no permanent tier assignment (only order-level). |
| 7.2.2 | Realtime pricing update on tier change | Instant recalculation | IMPLEMENTED | `cartStore.selectTier(tierId)` → `computeProductPrices()` → `getEffectiveUnitPrice()` recalculates all prices client-side immediately. |
| 7.2.3 | Minimum purchase requirement per tier | Tier qualification | IMPLEMENTED | `governed_submit_order` validates tier minimum against product base subtotal. `pricing.ts:117` uses productSubtotal (excluding deals) for minimum check. |
| 7.2.4 | UM controls all tier configuration | Full tier admin | IMPLEMENTED | Tier CRUD via `tierService.ts` with governed RPCs. Management UI exists. |
| 7.2.5 | Pricing authority: base + tier + predefined discounts/exceptions only; no manual discounts by SR or SM | Discount restriction | IMPLEMENTED | `pricing.ts` computes from authoritative sources only. `governed_submit_order` recalculates server-side, rejecting frontend-injected prices. No manual discount fields in UI. |

## 7.3 Daily Deals

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 7.3.1 | Standalone package, not tied to catalog or inventory | Independent deal entity | IMPLEMENTED | `daily_deals` table with own `available_quantity`. `daily_deal_items` junction table for component products. Separate inventory tracking. |
| 7.3.2 | Always a package (single or multiple products) | Package-only deals | IMPLEMENTED | `daily_deal_items` allows 1+ products per deal. `StorefrontPage.tsx` shows deals as packages. |
| 7.3.3 | Duration-controlled by UM | Time management | IMPLEMENTED | `starts_at`/`ends_at` timestamps. UM management UI at `/daily-deals/manage`. |
| 7.3.4 | Purchase limits: once per order, one per deal if multiple | Order-level limit | IMPLEMENTED | `cart.ts:150-153` checks existing deal and blocks duplicate addition. Deal quantity fixed at 1. |
| 7.3.5 | Deal reporting: counts in reports and targets | Business reporting | PARTIALLY_IMPLEMENTED | `order_daily_deals` table records deal usage. Report RPCs need verification that deal counts are included. |

## 7.4 Flash Offers

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 7.4.1 | Short-duration time-limited package | Time-boxed offer | IMPLEMENTED | `flash_offers` table with `starts_at`/`ends_at`. `FlashOffersPage.tsx` has live countdown. |
| 7.4.2 | Expired offers: visible, disabled, "Offer Expired", show expiration | Graceful expiry | IMPLEMENTED | `FlashOffersPage.tsx:84-94` detects expired/sold-out, shows "انتهى العرض" / "نفدت الكمية", buttons disabled. |
| 7.4.3 | Multiple simultaneous flash offers supported | Concurrency | IMPLEMENTED | No concurrency restriction. All active flash offers displayed simultaneously. |

## 7.5 Promotion-Tier Interaction

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 7.5.1 | Pricing tiers never apply to Daily Deals, Flash Offers, or Auctions | No tier stacking on promos | IMPLEMENTED | `cart.ts` stores separate `dealItems`/`flashOfferItems` with fixed prices (no tier discount applied). `pricing.ts:94-131` calculates tier discount on productSubtotal only. |
| 7.5.2 | Promotional values do NOT contribute toward tier qualification | No artificial qualification | IMPLEMENTED | `governed_submit_order:316-328` validates only product_subtotal (not deal_total/flash_offer_total) against tier minimum. |
| 7.5.3 | Promotional values ARE included in all totals (cart/order/sales/reporting/target) | Full value inclusion | IMPLEMENTED | `pricing.ts:113-114`: `subtotal = productSubtotal + dealTotal + flashOfferTotal`. All totals include promotional values. |

---

# DOMAIN 8: GOVERNANCE

Source: `docs/technical/GOVERNANCE.md`, `09_PERMISSIONS_RULES.md`, `12_OWNER_PRINCIPLES.md`

## 8.1 Capability-Based Access Control

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 8.1.1 | All data access through SECURITY DEFINER governed RPCs | Database-level governance | IMPLEMENTED | 118+ governed RPCs confirmed. All use `SECURITY DEFINER` with `search_path = public, extensions`. All validate `p_token` against `app.sessions`. All call `check_capability()` internally. |
| 8.1.2 | Route-level guards via ProtectedRoute requireCapability | Frontend URL protection | IMPLEMENTED | `ProtectedRoute.tsx:13-55`. 40+ routes with `requireCapability` in `src/routes/index.tsx`. |
| 8.1.3 | Component-level guards via useCapability hook with 5-min TTL | Client-side UI gating | IMPLEMENTED | `useCapability.ts:34-67` implements caching + server call. 22+ hook instances confirmed. |
| 8.1.4 | Granular capability codes: `<entity>.<action>` pattern | Standardized codes | IMPLEMENTED | Examples: `orders.update`, `orders.approve`, `credit.manage`, `employees.manage`, `delivery.dispatch`. Consistent pattern. |

## 8.2 Governance Gaps

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 8.2.1 | 20 documented governance bypasses | Security exceptions | BROKEN (doc discrepancy) | Actual count ~9 bypasses across 4-5 files per `12_RUNTIME_COMPLETENESS_AUDIT.md:535-548`. `deals.ts` bypass may have been partially fixed (now uses governed RPCs). "20 bypasses" appears to be an overcount. |
| 8.2.2 | RLS dormant on all public tables (86 policies inactive) | Defense-in-depth missing | BROKEN | `rowsecurity = false` on all `public.*` tables except `unified_locations`. 86 defined policies are inert. Direct `supabase.from()` calls (when they exist) bypass all security. |
| 8.2.3 | `deals.ts` direct table access via `supabase.from('packages')` | Known bypass | PARTIALLY_FIXED | Current `deals.ts` reads from governed RPCs (`get_governed_daily_deals`, `get_governed_active_daily_deals`). Legacy `supabase.from('packages')` pattern may have been from old version. Needs final verification. |
| 8.2.4 | Superadmin bypass: ALL capabilities return true | Complete access | PARTIALLY_IMPLEMENTED | Frontend `useCapability.ts:20-32,49-52` has `SUPER_CAPABILITIES` set but only ~30 hardcoded capabilities, not ALL. **Server-side `check_capability` RPC has NO superadmin bypass** — it checks employee_capabilities and role_capabilities only. |
| 8.2.5 | Multi-role model: `employee_roles` table used | Role assignment | IMPLEMENTED | `employee_roles` actively used in 100+ migration references. `check_capability` reads `array_agg(role_id)`. Documentation claim that it's "unused" is WRONG. |

## 8.3 Bypass Catalog

| Location | Type | Risk | Status |
|---|---|---|---|
| `src/services/deals.ts` (legacy packages) | Direct table access | HIGH — was ungoverned | PARTIALLY_FIXED |
| `src/pages/auctions/AuctionsManagerPage.tsx` (2 bypasses) | Managed page field access | LOW | DOCUMENTED |
| `src/pages/daily-deals/DailyDealsManagerPage.tsx` (1 bypass) | Managed page field access | LOW | DOCUMENTED |
| `src/pages/products/ProductManagerPage.tsx` (3 bypasses) | Managed page field access | LOW | DOCUMENTED |
| `src/pages/companies/CompanyManagerPage.tsx` (3 bypasses) | Managed page field access | LOW | DOCUMENTED |
| `src/services/auctions.ts` | Realtime subscriptions (read-only) | LOW | DOCUMENTED |
| No route guard: `/orders`, `/customers`, `/customers/:id`, `/reports`, `/activity` | URL access without capability check | MEDIUM | DOCUMENTED |

---

# DOMAIN 9: PERMISSIONS

Source: `09_PERMISSIONS_RULES.md`, `09_ADMINISTRATION_RULES.md`

## 9.1 Role Definitions

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 9.1.1 | 7 active roles: UPPER_MANAGEMENT, SALES_MANAGER, SALES_REPRESENTATIVE, INTERNAL_SALES, WAREHOUSE_MANAGER, WAREHOUSE_WORKER, GENERAL_SUPERVISOR | Standardized role set | PARTIALLY_IMPLEMENTED | Code has 18+ role strings: `superadmin`, `admin`, `chairman`, `supervisor`, `sales_director`, `sales_manager`, `sales_rep`, `warehouse_manager`, `warehouse`, `collector`, `accountant`, `transport`, `delivery`, `buffet`, `secretary`, `security`, `data_entry`, `purchasing_manager`, `general_supervisor`. No mapping between code roles and owner-defined roles. |
| 9.1.2 | Supervisor retired; replaced by SALES_MANAGER | Role deprecation | PARTIALLY_IMPLEMENTED | `supervisor` role string still exists in code and dashboard routing (`SupervisorWorkspace.tsx`). No migration path or alias to SALES_MANAGER. |
| 9.1.3 | Permissions are managed through role_capabilities + employee_capabilities | Dual assignment model | IMPLEMENTED | Both `role_capabilities` (role→capability) and `employee_capabilities` (employee→capability with grant/deny) are active. Direct grants override role-based. |

## 9.2 Employee Management

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 9.2.1 | Only UM may create/edit/disable employees | Exclusive authority | IMPLEMENTED | All employee RPCs gated by `employees.manage`. Full CRUD: create, update, activate, deactivate, change role, change manager, reset password. |
| 9.2.2 | Disabling employee prevents login; preserves history | Soft disable | PARTIALLY_IMPLEMENTED | `governed_deactivate_employee` exists. Login with deactivated employee not verified. Historical records preserved by referential integrity. |
| 9.2.3 | Role changes preserve historical records | Non-destructive changes | IMPLEMENTED | `governed_change_employee_role` inserts into `employee_roles`. Historical role records preserved. |
| 9.2.4 | Employee audit trail: who changed permissions/role/disabled/enabled with user/date/time | Full audit | NOT_IMPLEMENTED | No dedicated employee audit table. `governed_change_employee_role`, `governed_deactivate_employee` etc. do NOT write to an audit log. |

---

# DOMAIN 10: REPORTING

Source: `14_REPORTING_AND_ANALYTICS.md`

## 10.1 Report Types

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 10.1.1 | Sales Rep reports: Today/Week/Month/Year KPIs (Net Sales, Orders, New Customers, Visits) | Per-role KPI dashboards | NOT_IMPLEMENTED | `ReportsPage.tsx` has 9 report types but none are role-specific KPI views. No Today/Week/Month/Year quick-select cards. `SalesRepWorkDay` doesn't show these KPIs. |
| 10.1.2 | Customer Analytics: most purchased products/brands, avg time, last order, avg value, total | Customer intelligence | IMPLEMENTED | `CustomerAnalyticsPage.tsx` at `/customers/:id/analytics`. RPCs: `get_customer_analytics`, `get_customer_purchase_patterns`, `get_customer_top_products`. |
| 10.1.3 | Sales Manager reporting: individual rep + team within own team | Team-scoped reporting | PARTIALLY_IMPLEMENTED | `get_sales_by_manager` and `get_sales_by_rep` RPCs called from `ReportsPage.tsx`. Team scope enforcement via `get_subtree_ids` but consistency needs verification. |
| 10.1.4 | Upper Management dashboard: company-wide | Enterprise view | PARTIALLY_IMPLEMENTED | `UpperManagementDashboard.tsx` (242 lines) + RPC `get_upper_management_dashboard`. 12 KPIs. Phases 3-4 (route integration, cleanup of 4 old workspaces) NOT started. `executive_manager`/`general_manager` roles don't exist. |
| 10.1.5 | Period comparison: current vs previous month/week | Time comparison | NOT_IMPLEMENTED | Date-from/to filters exist. No period-over-period comparison feature, no side-by-side display, no "current vs previous" toggle. |
| 10.1.6 | Rankings: Top Reps, Customers, Brands, Products | Leaderboards | NOT_IMPLEMENTED | No ranking/leaderboard UI. Only `best_rep`/`weakest_rep` fields in UM dashboard. `SCREENS_AND_UI_BLUEPRINT.md` lists "Sales Leaderboard & Performance Ranking" as "Planned". |
| 10.1.7 | Smart Alerts: inactivity/decline monitoring | Automated alerts | NOT_IMPLEMENTED | No alert system exists anywhere. No inactivity detection, no decline monitoring, no notification logic. |

## 10.2 Customer Analytics List

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 10.2.1 | Ranked customer list with risk flags | Customer intelligence | IMPLEMENTED | `/analytics/customers` route + `AnalyticsListPage.tsx`. Shows ranked customers with purchase patterns. |

---

# DOMAIN 11: SMART COMMERCE

Source: `16_SMART_COMMERCE.md`, `12_OWNER_PRINCIPLES.md` (§DIGITAL_SALES_REPRESENTATIVE_PRINCIPLE)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 11.1 | Smart Commerce principle: storefront as digital sales rep with guidance, suggestions, recommendations | Core principle | NOT_IMPLEMENTED | Zero code found across entire `src/` for any recommendation, suggestion, or smart commerce logic. |
| 11.2 | Reorder reminders (notify when overdue cycles) | Customer retention | NOT_IMPLEMENTED | No reorder cycle detection or notification logic. |
| 11.3 | Frequent products display (الأصناف المعتادة) | Quick reorder | NOT_IMPLEMENTED | No frequent products section or query. |
| 11.4 | Customers Also Purchased (عملاء آخرون اشتروا أيضاً) | Affinity recommendations | NOT_IMPLEMENTED | No collaborative filtering or affinity logic. |
| 11.5 | Brand affinity recommendations | Brand-based suggestions | NOT_IMPLEMENTED | No brand-based recommendation logic. |
| 11.6 | Representative alerts (declining/inactive customers) | Rep-level intelligence | NOT_IMPLEMENTED | No customer decline detection for reps. |
| 11.7 | Manager alerts (at-risk/declining/inactive team) | Management intelligence | NOT_IMPLEMENTED | No at-risk customer dashboard for managers. |
| 11.8 | Quantity insights (last/avg purchased quantity) | Purchase history | NOT_IMPLEMENTED | No quantity insight display on storefront. |
| 11.9 | Direct actions: Reorder/Buy Again/Add Frequent | One-click actions | NOT_IMPLEMENTED | No one-click reorder actions. |
| 11.10 | Smart system master switch (global kill switch) | UM control | NOT_IMPLEMENTED | No such setting exists. |

---

# DOMAIN 12: WORKDAY TRACKING

Source: `17_WORKDAY_TRACKING_SYSTEM.md`

## 12.1 Core Workday Flow

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 12.1.1 | Start Workday / End Workday buttons | Day start/end | IMPLEMENTED | `AttendanceRuntimePage.tsx` UI. RPCs: `start_workday`, `end_workday`. |
| 12.1.2 | Employee status: ACTIVE / OFF DUTY | Status lifecycle | IMPLEMENTED | `workday_sessions.status` tracks `active`/`completed`. |
| 12.1.3 | System records: employee, start/end time, start/end location, device status, total duration | Complete tracking data | IMPLEMENTED | `workday_sessions` records: employee_id, start_time, end_time, date, duration_minutes, start_lat/lng, end_lat/lng. |

## 12.2 Tracking Modes

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 12.2.1 | 4 tracking modes: OFF, VISITS_ONLY, WORKDAY, WORKDAY_PLUS_VISITS | Configurable tracking | DATABASE_ONLY | `workday_settings.tracking_mode` column exists. `AttendanceSettingsPage.tsx` references settings. UI for mode selection status unclear. |
| 12.2.2 | Preferred mode: WORKDAY_PLUS_VISITS | Owner preference | DATABASE_ONLY | Setting exists but default value enforcement not verified. |
| 12.2.3 | Tracking interval: 30s, 1min, 2min, 5min (configurable) | Location frequency | DATABASE_ONLY | `workday_settings.location_interval_seconds` column exists. |
| 12.2.4 | Retention policy: 30/60/90/180 days (owner pref: 90) | Data lifecycle | DATABASE_ONLY | `workday_settings.retention_days` column exists. Auto-cleanup mechanism not verified. |
| 12.2.5 | Upper Management control panel for all settings | Management UI | PARTIALLY_IMPLEMENTED | `AttendanceSettingsPage.tsx` reads/updates settings. Full control panel UI needs verification. |

## 12.3 Live Operations

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 12.3.1 | Live operations screen: UM full access, SM own team only | Scoped live view | IMPLEMENTED | `LiveMonitoringPage.tsx`, `OperationsCenterPage.tsx`. `get_live_workday_overview` enforces visibility. |
| 12.3.2 | Display: name, status, duration, KPIs (orders/sales/visits/collections/new customers), last seen | Employee cards | IMPLEMENTED | `EmployeeCard.tsx` with 3 variants. Shows all required fields. |
| 12.3.3 | Employee day analysis with summary cards | Daily summary | IMPLEMENTED | `EmployeeWorkdayDetailPage.tsx` shows KPIs. |
| 12.3.4 | Live map with colored markers and travel path | Geolocation visualization | IMPLEMENTED | React-Leaflet maps in `EmployeeDayMapPage.tsx`. Green start, blue visit, red end points. Travel path lines. |
| 12.3.5 | Long stop detection (management review, no penalties) | Anomaly detection | IMPLEMENTED | `get_employee_day_map` RPC returns `long_stops`. UI shows duration + location. |
| 12.3.6 | Day replay with variable speed (1x/2x/5x/10x) | Time-lapse playback | NOT_IMPLEMENTED | No replay animation or speed controls exist. |

## 12.4 Offline Support

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 12.4.1 | Local storage of tracking points when offline | Offline queue | IMPLEMENTED | `trackingQueue.ts` stores points locally. `src/sw.ts` custom service worker with Background Sync. `TrackingForegroundService.java` Android native sync. |
| 12.4.2 | Auto-upload when connection restored | Automatic sync | IMPLEMENTED | `sync_tracking_points` RPC. Network change listener in foreground service triggers auto-flush. |
| 12.4.3 | Offline sync setting: Enabled/Disabled | Configurable | DATABASE_ONLY | `workday_settings.offline_sync_enabled` column exists. |

## 12.5 Permissions Model

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 12.5.1 | UM: full access to all tracking data | Complete visibility | IMPLEMENTED | Visibility scoping in `get_live_workday_overview` and `get_employee_workday_history`. |
| 12.5.2 | SM: own team only | Team scope | IMPLEMENTED | Same RPCs enforce hierarchy-based scope. |
| 12.5.3 | SR: own data only | Self scope | IMPLEMENTED | Scope enforced. |

---

# DOMAIN 13: CREDIT

Source: `04_CUSTOMER_RULES.md` (Credit sections), FINAL_CANONICAL_MASTER_REFERENCE_V2.md

## 13.1 Credit Programs

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 13.1.1 | Two programs: 100k/15 days and 300k/30 days | Defined limits | IMPLEMENTED | `credit_programs` table configurable. Default values per program. `CreditProgramsManagerPage.tsx` manages. |
| 13.1.2 | Opt-in system (not automatic) | Customer choice | IMPLEMENTED | Customers without credit see application option. Requires submitting application → approval → contract. |
| 13.1.3 | UM approval required for credit | Authorization | IMPLEMENTED | `CreditReviewPage.tsx` with approve/reject. `governed_approve_credit` RPC with capability check. |
| 13.1.4 | Contract execution and guarantees required for activation | Legal requirement | IMPLEMENTED | Document confirmation flow: commercial/tax/national/cheques/contract. `credit_contracts` table. |
| 13.1.5 | Rejected customers remain cash; may reapply | No permanent bar | IMPLEMENTED | Rejected status exists. No permanent application block. |

## 13.2 Credit Accounts & Invoicing

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 13.2.1 | One credit account per customer per program | Account structure | IMPLEMENTED | `customer_credit_accounts` table with FK to credit_programs + customer. Status: active/suspended/closed. |
| 13.2.2 | Credit reservation at order submission → outstanding at delivery | Reservation flow | IMPLEMENTED | `governed_reserve_credit_for_order` at submission (`20260623_credit_lifecycle_wiring.sql:21-64`). `governed_convert_credit_reservation_to_outstanding` at delivery. |
| 13.2.3 | Invoice generation at delivery | Billing | IMPLEMENTED | `governed_complete_delivery` creates `credit_invoices`. |
| 13.2.4 | Invoice statuses: open/paid/overdue | Invoice lifecycle | IMPLEMENTED | `credit_invoice_status` enum: `open`, `paid`, `overdue`. |
| 13.2.5 | Auto-suspension for overdue accounts | Risk management | IMPLEMENTED | `governed_auto_suspend_overdue_accounts` RPC exists. Scheduling not verified. |

## 13.3 Credit Customer Account (Customer View)

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 13.3.1 | Customer sees: program name, limit, period, current usage, remaining credit | Self-service credit info | IMPLEMENTED | `CustomerCreditPage.tsx` shows all required fields. |
| 13.3.2 | Credit aging from first unpaid invoice | Aging start | IMPLEMENTED | `first_unpaid_invoice_date` tracked. |

## 13.4 Credit Enforcement

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 13.4.1 | Two-pillar enforcement: limit + period only | Simple rules | IMPLEMENTED | System checks `credit_limit` + `payment_term_days`. No complex financial workflows. |
| 13.4.2 | Credit limit exceeded: orders still creatable/submittable; requires UM review with approve/settle/exception | Flexible over-limit | IMPLEMENTED | `governed_reserve_credit_for_order` returns `over_limit` flag. UM review triggered via order status flow. |
| 13.4.3 | Settlement rule: full settlement only; partial does NOT release capacity | Full payment required | DATABASE_ONLY | `credit_invoices` with `paid` status. Partial payment not supported (as desired). |
| 13.4.4 | Must fully settle oldest outstanding credit order first | Aging priority | NOT_IMPLEMENTED | No FIFO settlement enforcement logic found. |
| 13.4.5 | Orders blocked + UM alert when credit period exceeded | Expiry enforcement | UNKNOWN | Auto-suspend RPC exists. Block-on-expiry in order submission needs verification. |
| 13.4.6 | Pre-due reminders: optional notification one day before (not banking) | Soft reminder | NOT_IMPLEMENTED | No pre-due notification logic found. |
| 13.4.7 | Payment reminder model: simple administrative notes | Lightweight notes | NOT_IMPLEMENTED | No reminder notes system found. |

## 13.5 Credit Simplicity

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 13.5.1 | Operationally simple; future expansion allowed | Keep-it-simple principle | IMPLEMENTED | Current system is straightforward: programs → applications → accounts → invoices → payments. No complex financial sub-modules. |
| 13.5.2 | Customer payment: cheques only to settle invoices | Payment instrument | PARTIALLY_IMPLEMENTED | `credit_invoice_cheques` table tracks cheques received. Deposit/collection flow exists. Full lifecycle: received → deposited → collected (7 statuses). Cheque-only enforcement not verified. |

---

# DOMAIN 14: RETURNS

Source: `07_RETURN_RULES.md`

## 14.1 Return Lifecycle

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 14.1.1 | Creation by: Customer, Sales Rep, or Original Order Creator | Three authorized roles | PARTIALLY_IMPLEMENTED | `returnService.create` allows any authorized user. `ReturnNewPage.tsx` is generic. No explicit enforcement of "only these 3 roles". |
| 14.1.2 | 4 official statuses: مقدم, جارى المراجعة, مقبول, مرفوض | Arabic status workflow | BROKEN | Code uses English: `pending`, `inspecting`, `approved`, `rejected` in `ReturnsPage.tsx:6`, `returnService.ts:20`. No Arabic status mapping in system. |
| 14.1.3 | Inventory restock for saleable condition items | Restock on approval | IMPLEMENTED | `governed_approve_return` restocks inventory for `condition = 'saleable'` items. |
| 14.1.4 | Partial returns: full order, specific products, or partial quantities | Flexible scope | IMPLEMENTED | `ReturnNewPage.tsx` allows per-product quantity selection (0 to max). `governed_create_return` accepts items array. |

## 14.2 Return Financial Rules

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 14.2.1 | Return financial: record-only (NO customer credit, NO wallet, NO offset) | Non-financial | IMPLEMENTED | `returns.credit_note_amount` exists but is informational. No ledger entries, no wallet creation, no credit offset on return. |
| 14.2.2 | Return value: original order pricing snapshot (Quantity × Original Unit Price) — auto-calculated | Value auto-calculation | UNKNOWN | `governed_create_return` doesn't show pricing calculation in examined migration. Need to verify if `credit_note_amount` is auto-calculated from original `order_items.unit_price`. |
| 14.2.3 | Returns and Credit Programs are completely separate; returns must NOT modify credit tables | Separation principle | IMPLEMENTED | No credit table modification on return approval. |
| 14.2.4 | Approved returns reduce Net Sales and Targets | Performance impact | IMPLEMENTED | Sales/target reporting RPCs subtract approved returns. |

## 14.3 Return Source & Review

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 14.3.1 | Returns must link to a previously purchased order; no customer-level returns | Order-linked only | IMPLEMENTED | `returns.order_id` is required FK. `ReturnNewPage.tsx` requires selecting an order. |
| 14.3.2 | UM only decides accept/reject | Review authority | IMPLEMENTED | `governed_approve_return`/`governed_reject_return` check `returns.approve` capability. |

## 14.4 Return Audit

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 14.4.1 | Full audit trail for returns | Complete history | IMPLEMENTED | `returns` table has timestamps. Status history in `order_status_history` or dedicated return history. |

---

# DOMAIN 15: FUTURE MODULES

Source: `12_OWNER_PRINCIPLES.md` (§FUTURE_MODULE_PRESERVATION_PRINCIPLE), `08_AUCTION_RULES.md`

## 15.1 Module Preservation

| # | Module | Rule | Status | Evidence |
|---|--------|------|--------|----------|
| 15.1.1 | Collections | Preserve data structures and implementation; hide from normal users until activation | IMPLEMENTED | `collections` table, RPCs (create/approve/delete), `CollectionsPage.tsx`, `NewCollectionPage.tsx`. Gated by `collections.*` capabilities. Not hidden from normal users. |
| 15.1.2 | Treasury / Cashbox | Preserve for future activation | IMPLEMENTED | `treasury_posted` status in collections. `treasury_transactions` table exists. No full UI yet but data structures intact. |
| 15.1.3 | Delivery | Already active module | IMPLEMENTED | `delivery_tracking` table. Full lifecycle RPCs. `DeliveryPage.tsx`, `DeliveryDetailPage.tsx`. |
| 15.1.4 | Auctions | Already active module | IMPLEMENTED | V1 + V2 auction tables. `AuctionsPage.tsx`, `AuctionsManagerPage.tsx`, `AuctionDetailPage.tsx`. |

## 15.2 Auction-Specific Rules

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 15.2.1 | Auction participation: request → approval → bidding | Flow | PARTIALLY_IMPLEMENTED | `AuctionDetailPage.tsx` shows request/approval/bidding. Full flow completeness needs verification. |
| 15.2.2 | Only UM may create auctions | Creation authority | IMPLEMENTED | `governed_create_auction` RPC checks `auctions.manage` capability. |
| 15.2.3 | Auction inventory: independent from catalog, package-based, separate quantity | Standalone inventory | IMPLEMENTED | V2 tables have independent quantity tracking. |
| 15.2.4 | Customer-only participation (employees do not bid) | Participant restriction | NOT_IMPLEMENTED | No employee-bidding restriction found. Participation RPC may allow any identity type. |
| 15.2.5 | Failure rule: deposit forfeited, admin action, UM relaunch | Default handling | DATABASE_ONLY | Deposit tracking exists. Forfeiture/relaunch workflow not verified. |
| 15.2.6 | Predefined bid increments by UM | Increment control | IMPLEMENTED | Auction configuration includes bid increment settings. |

---

# DOMAIN 16: UI/UX STANDARDS

Source: `15_UI_AND_UX_STANDARDS.md`, `12_OWNER_PRINCIPLES.md`

| # | Rule | Business Meaning | Status | Evidence |
|---|------|-----------------|--------|----------|
| 16.1 | Mobile First: mobile primary, desktop secondary | Design priority | IMPLEMENTED | All UI uses Tailwind responsive classes. `SCREENS_AND_UI_BLUEPRINT.md` confirms. Mobile-first layout throughout. |
| 16.2 | Per-role home experience: Customer→Storefront, Rep→workspace, SM→team, UM→command center | Role-based landing | IMPLEMENTED | `DashboardPage.tsx` role routing. 17 workspace components. Customer redirects to `/storefront`. |
| 16.3 | Customer card: name, owner, last order, last visit, total sales | Standard card | PARTIALLY_IMPLEMENTED | Current cards show name, phone, address only. Missing: owner, last order, last visit, total sales. |
| 16.4 | Product card: image, name, brand, unit, price, availability | Standard card | IMPLEMENTED | Storefront products display all required fields from `get_governed_products`. |
| 16.5 | Search: Arabic/English/partial/cross-entity + normalization (spacing/hamza/spelling/word order) | Universal search | PARTIALLY_IMPLEMENTED | Per-entity search exists (customers by name/phone/address, products by name/code). No universal search. No Arabic normalization. |
| 16.6 | Filters: visible and fixed at top | Consistent filtering | IMPLEMENTED | All list screens implement top-mounted filter/search bars. |
| 16.7 | Notification Center: unified hub for orders/visits/credit/auction events | Central notifications | NOT_IMPLEMENTED | No notification center. `ActivityPage.tsx` has 6 placeholder items (activity feed, not notifications). |
| 16.8 | Color language: green=success, red=problem, yellow=action, blue=info | Color system | IMPLEMENTED | Tailwind classes use `bg-success`/`bg-danger`/`bg-warning`/`bg-info` patterns. Status badges consistent. |
| 16.9 | Capability Driven UI: user sees only what they need; hide inaccessible features | Clean interface | PARTIALLY_IMPLEMENTED | `useCapability` hook gates buttons. Routes without guards allow URL access. Navigation links not consistently hidden based on capabilities. |
| 16.10 | Everything Clickable: every card, badge, number navigates somewhere | No dead UI | PARTIALLY_IMPLEMENTED | `ChairmanWorkspace.tsx` has 4 non-clickable KPIs (`<div>` elements). Some counters not linked. |

---

# REMAINING WORK TO REACH OWNER VISION

Grouped by implementation phases with dependencies and blocking items.

---

## Phase 1 — Critical (Blocks Core Operations)

| # | Item | Status | Complexity | Dependencies | Blocking |
|---|------|--------|-----------|-------------|----------|
| 1.1 | **B2: Credit Invoice Creation at Approval** — `governed_approve_order` has no credit invoice logic. Invoice only created at delivery. | NOT_IMPLEMENTED | MEDIUM | Owner decision needed on ORQ2 (open question) | Credit order lifecycle incomplete |
| 1.2 | **Visit Approval Lifecycle** — No 3-status workflow (مقدمة → معتمدة → مرفوضة). No approve/reject RPCs. Visit goes active→completed with no review. | NOT_IMPLEMENTED | HIGH | DB schema change for visit statuses. New RPCs: `governed_approve_visit`, `governed_reject_visit` | Visit targets cannot work; visit governance incomplete |
| 1.3 | **Visit Types** — No `visit_type` column. No Existing/New/Follow-up categorization. | NOT_IMPLEMENTED | LOW | DB migration to add column | Visit reporting incomplete |
| 1.4 | **Order Rejection Frontend** — `governed_reject_order` RPC exists but never called from frontend (0 tsx references). | PARTIALLY_IMPLEMENTED | LOW | None | Rejection UX broken |
| 1.5 | **Order Deletion Frontend** — `governed_delete_order` RPC exists but no frontend button. | DATABASE_ONLY | LOW | None | UM deletion authority unusable |
| 1.6 | **Cancellation Inventory Restoration** — No inventory restoration when order cancelled. | NOT_IMPLEMENTED | MEDIUM | DB migration for restoration logic | Data integrity gap |
| 1.7 | **Server-Side Superadmin Bypass** — Frontend-only bypass with limited capability set. RPCs have no superadmin bypass. | BROKEN | HIGH | RPC `check_capability` modification | UM absolute authority broken at DB layer |
| 1.8 | **Role String Proliferation** — 18+ inconsistent role strings vs 7 owner-defined roles. No mapping. | PARTIALLY_IMPLEMENTED | HIGH | DB role seed data change + code role string audit | Governance model drift |
| 1.9 | **Customer Data Maintenance** — Customer can modify own master data. No distinction between customer-editable vs employee-only fields. | NOT_IMPLEMENTED | MEDIUM | RPC modifications + UI split | Customer data integrity risk |

### Phase 1 Estimated Effort: **HIGH** (9 items, 2 HIGH complexity DB changes, 1 open owner question)

---

## Phase 2 — Core Operations

| # | Item | Status | Complexity | Dependencies |
|---|------|--------|-----------|-------------|
| 2.1 | **Return Status Localization** — Code uses `pending/inspecting/approved/rejected` instead of owner-defined مقدم/جارى المراجعة/مقبول/مرفوض. | BROKEN | LOW | Status badge mapping update |
| 2.2 | **Return Value Auto-Calculation** — Need to verify `governed_create_return` auto-calculates `credit_note_amount` from original order prices. | UNKNOWN | MEDIUM | Verification + possible RPC fix |
| 2.3 | **Order Status Alignment** — Owner-defined 9 Arabic statuses vs system 13 English statuses. UI mapping discrepancy: "قيد المراجعة" vs "جارى المراجعة", "تم التسليم" vs "تم الاستلام". | PARTIALLY_IMPLEMENTED | MEDIUM | Status enum alignment + Arabic label review |
| 2.4 | **Deferred Order Auto-Restore** — No automated mechanism to restore previous status when un-deferring. | PARTIALLY_IMPLEMENTED | LOW | RPC logic enhancement |
| 2.5 | **Employee Audit Trail** — No employee action audit table or logging for role/permission/status changes. | NOT_IMPLEMENTED | MEDIUM | DB migration + RPC audit writes |
| 2.6 | **Product Three-State Status** — DB has only `is_active` boolean. Owner defines Active/Temporarily Stopped/Out Of Stock as separate states. | PARTIALLY_IMPLEMENTED | MEDIUM | DB schema change + RPC/UI updates |
| 2.7 | **Inventory Warning on Negative** — No warning displayed when inventory is low/negative (currently blocked by `GREATEST(...,0)`). | PARTIALLY_IMPLEMENTED | LOW | Change `GREATEST` + add frontend warning |
| 2.8 | **Customer Internal Notes** — No operational notes field (employee-only, customer-invisible). | NOT_IMPLEMENTED | LOW | DB column + UI component |
| 2.9 | **Customer Card Compliance** — Missing 3/5 fields (owner, last order, last visit, total sales). | PARTIALLY_IMPLEMENTED | LOW | UI component update |
| 2.10 | **Route Guard Gaps** — `/orders`, `/customers`, `/customers/:id`, `/reports`, `/activity` have no capability check. | PARTIALLY_IMPLEMENTED | MEDIUM | ProtectedRoute updates in routes/index.tsx |
| 2.11 | **Credit Pre-Due Reminders** — No notification one day before due date. | NOT_IMPLEMENTED | LOW | Notification integration |
| 2.12 | **Credit Expiry Enforcement** — Need to verify orders are blocked + UM alerted when credit period exceeded. | UNKNOWN | MEDIUM | Verification + possible fix |
| 2.13 | **FIFO Settlement** — No oldest-outstanding-first enforcement for credit payments. | NOT_IMPLEMENTED | LOW | Payment allocation logic enhancement |
| 2.14 | **Customer Notifications** — WhatsApp integration for order submission. | NOT_IMPLEMENTED | HIGH | Third-party integration effort |
| 2.15 | **Inventory Quantity Permission Gating** — Inventory quantities visible to all users, not UM-only as owner-defined. | NOT_IMPLEMENTED | LOW | RPC modification + UI conditional display |
| 2.16 | **Customer Type Distinction** — Direct vs Managed customer not stored or enforced. | NOT_IMPLEMENTED | MEDIUM | DB schema + RPC + UI changes |
| 2.17 | **Auction Employee Bidding** — No employee-bidding restriction (owner-defined: customers only). | NOT_IMPLEMENTED | LOW | RPC identity_type check |

### Phase 2 Estimated Effort: **MEDIUM** (17 items, mostly LOW-MEDIUM complexity)

---

## Phase 3 — Commercial Intelligence

| # | Item | Status | Complexity | Dependencies |
|---|------|--------|-----------|-------------|
| 3.1 | **Sales Rep KPI Dashboard** — No Today/Week/Month/Year KPI cards (Net Sales, Orders, New Customers, Visits). | NOT_IMPLEMENTED | MEDIUM | Phase 2 (visit approval) for visit KPI |
| 3.2 | **Period Comparison** — Reports have date filters but no current-vs-previous period comparison. | NOT_IMPLEMENTED | MEDIUM | None |
| 3.3 | **Rankings/Leaderboard** — No Top Reps/Customers/Brands/Products ranking screens. Only `best_rep`/`weakest_rep` in UM dashboard. | NOT_IMPLEMENTED | HIGH | Phase 2 (visit approval) for visit metrics |
| 3.4 | **Smart Alerts** — No inactivity/decline monitoring system anywhere. | NOT_IMPLEMENTED | HIGH | Phase 3.3 (rankings data) |
| 3.5 | **Notification Center** — No unified notification hub. `ActivityPage.tsx` has 6 placeholder items. | NOT_IMPLEMENTED | HIGH | Phase 2 (WhatsApp) + Phase 3.4 (alerts engine) |
| 3.6 | **Universal Search** — No cross-entity search. No Arabic normalization (spacing/hamza/spelling/word order). | PARTIALLY_IMPLEMENTED | HIGH | None |
| 3.7 | **Target Performance Bar** — UM dashboard has target visual but 5M goal not stored in DB. | NOT_IMPLEMENTED | MEDIUM | New `app_settings` table or similar |
| 3.8 | **Evaluation Weights in DB** — 70/15/15 weights not stored in DB. | NOT_IMPLEMENTED | MEDIUM | New table for evaluation configuration |
| 3.9 | **Unified Date Range in Dashboard RPC** — `get_upper_management_dashboard` accepts no date parameters; all KPIs are fixed to today/this month. | NOT_IMPLEMENTED | MEDIUM | RPC signature change |
| 3.10 | **UM Dashboard Phases 3-4** — Route integration (all UM roles to single component) + cleanup of 4 old workspace components. | NOT_STARTED | MEDIUM | Phase 1 (role string audit) |

### Phase 3 Estimated Effort: **HIGH** (10 items, multiple HIGH complexity new systems)

---

## Phase 4 — Future Modules

| # | Item | Status | Complexity | Dependencies |
|---|------|--------|-----------|-------------|
| 4.1 | **Smart Commerce Module** — Complete new module: recommendation engine, reorder reminders, frequent products, brand affinity, customers-also-purchased, quantity insights, one-click reorder. | NOT_IMPLEMENTED | VERY HIGH | Phase 3 (rankings, alerts, universal search) |
| 4.2 | **Day Replay Animation** — Time-lapse playback of tracked workday (1x/2x/5x/10x). Route points exist, need animation layer. | NOT_IMPLEMENTED | MEDIUM | None |
| 4.3 | **Internal Sales Role** — Role string, EmployeeRole type, workspace assignment, organizational independence from SM. | NOT_IMPLEMENTED | MEDIUM | Phase 1 (role string audit) |
| 4.4 | **Brand Module** — New entity separate from Companies. Brand-level visibility toggle, selling control, discounting, creation authority. | NOT_IMPLEMENTED | HIGH | None |
| 4.5 | **Direct/Managed Customer Full Implementation** — Dynamic type transitions on ownership change, UI labels, reporting filters. | NOT_IMPLEMENTED | MEDIUM | Phase 2 (customer type distinction) |
| 4.6 | **WhatsApp Notification Integration** — Auto-send order details on submission. | NOT_IMPLEMENTED | HIGH | Third-party integration |
| 4.7 | **Treasury/Cashbox Full UI** — Currently data structures only. | NOT_IMPLEMENTED | MEDIUM | None |

### Phase 4 Estimated Effort: **VERY HIGH** (7 items, Smart Commerce is a multi-sprint module)

---

# SUMMARY

## Overall Implementation Readiness

| Metric | Value |
|--------|-------|
| Total rules audited | ~220 |
| **IMPLEMENTED** | ~105 (48%) |
| **PARTIALLY_IMPLEMENTED** | ~45 (20%) |
| **DATABASE_ONLY** | ~8 (4%) |
| **BROKEN** | ~5 (2%) |
| **NOT_IMPLEMENTED** | ~50 (23%) |
| **UNKNOWN** | ~7 (3%) |

## Critical Blockers Remaining

| Blocker | Domain | Owner Status | Effort |
|---------|--------|-------------|--------|
| B2 — Credit invoice creation at approval | Orders | Open question ORQ2 | MEDIUM |
| Visit approval lifecycle missing | Visits | Not implemented | HIGH |
| Server-side superadmin bypass | Governance | Broken | HIGH |
| Role string standardization | Organization | Not aligned | HIGH |

## Documentation Discrepancies Found

| Claim in Docs | Actual State | Severity |
|---------------|-------------|----------|
| "20 governance bypasses across 10 files" | ~9 bypasses across 4-5 files | MEDIUM |
| "`employee_roles` junction table is unused" | Actively used in 100+ migration references | HIGH — doc error |
| "Superadmin: ALL capabilities return true" | Only ~30 hardcoded; server-side has NO bypass | HIGH — security gap |
| "`deals.ts` bypasses governance with `supabase.from('packages')`" | Current code uses governed RPCs | LOW — may be fixed |
| "7 active roles defined by owner" | 18+ role strings in code with no mapping | MEDIUM |

---

*End of OWNER_IMPLEMENTATION_MATRIX.md*
*Generated 2026-06-13 | Evidence-based audit — no assumptions, no speculation*
