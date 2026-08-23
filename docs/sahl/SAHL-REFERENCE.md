# SAHL Reference Knowledge Base

> **Purpose:** Internal reference document for the JOKER project.
> This document preserves all verified findings about the SAHL software
> to support future JOKER planning and design decisions.
>
> **This document does NOT imply that JOKER should replicate SAHL.**
> It is a study reference only. Decisions about what JOKER should keep,
> remove, improve, or redesign are separate tasks.

---

## 1. SAHL Overview

| Field | Value |
|-------|-------|
| Product Name | سهل للمخازن والمحلات (SAHL for Warehouses and Shops) |
| Full Name | سهل لإدارة الأعمال (SAHL for Business Management) |
| Installed Version | 17.0.0.70 |
| Manufacturer | JUSTAGAIN (Cairo, Egypt) |
| Website | https://getsahl.com |
| Purpose | Local desktop inventory, sales, purchases, and accounting system |
| License Model | Monthly subscription (100 EGP), yearly (1000 EGP), or purchase (3500 EGP) |
| E-Invoicing | Officially approved by ZATCA (Saudi Arabia) for Phase 1 and Phase 2 electronic invoicing |

### Runtime Model

SAHL is a **local desktop application**. It runs entirely on the user's computer with no internet requirement for daily operation.

- **Application:** `Sahl.exe` (6.6 MB Windows executable)
- **Database:** MySQL 5.7.33 running as a local Windows Service
- **Both run on the same machine**
- **No web server, no cloud dependency for core operation**
- Auto-updates from the internet when available

**Confidence: VERIFIED** — File sizes, versions, service name, and paths verified from installed files.

---

## 2. Business Scope

SAHL is a **complete business management system** for inventory-based businesses (spare parts, electrical appliances, home goods, telecom/mobile, toys, sanitary tools, supplies, etc.).

### What SAHL Covers

| Domain | Covered |
|--------|---------|
| Product catalog (items, codes, barcodes, units, prices) | Yes |
| Inventory management (multiple warehouses) | Yes |
| Sales (invoices, quotations, returns) | Yes |
| Purchases (invoices, returns) | Yes |
| Customer accounts | Yes |
| Supplier accounts | Yes |
| Salesman accounts | Yes |
| Cash registers / Treasury | Yes |
| Financial movements (receipts, payments, expenses) | Yes |
| Installments | Yes |
| Cheques | Yes |
| Inventory counting (stock-taking) | Yes |
| Inventory adjustments | Yes |
| Warehouse transfers | Yes |
| Delivery tracking | Yes |
| Serial number tracking | Yes |
| Barcode printing | Yes |
| Report printing (thermal, A4, A5, dot matrix) | Yes |
| User management with granular permissions | Yes |
| E-invoicing (ZATCA compliance) | Yes |
| Auto-backup | Yes |
| Multi-warehouse with per-store inventory | Yes |
| Multiple selling price lists | Yes |
| Tax (VAT) support | Yes |
| Expense tracking and analysis | Yes |
| Touch screen support | Yes |

**Confidence: VERIFIED** — All items confirmed from database schema, report templates, binary analysis, and official website.

---

## 3. Products

### 3.1 Product Identity

Each product (`items` table) has:

| Field | Description | Confidence |
|-------|-------------|------------|
| `code1` | Primary product code | Verified |
| `code2` | Secondary code | Verified |
| `title` | Product name | Verified |
| `barcode` | Main barcode | Verified |
| `barcodes` | Multiple barcodes (stored as structured data) | Verified |

### 3.2 Multiple Barcodes

SAHL supports **multiple barcodes per product**. Each unit of a product can have its own barcode. The `items.barcodes` field and `items_units.barcodes` field both store barcode collections.

**Confidence: VERIFIED** — Both fields exist in the database schema.

### 3.3 Units of Measure

SAHL supports **multiple units per product** with automatic conversion.

The `items_units` table links each product to its available units:

| Field | Description |
|-------|-------------|
| `item_id` | Parent product |
| `unit` | Unit name (e.g., "piece", "box", "carton") |
| `uqty1`, `uqty2` | Conversion quantities between units |
| `price1` through `price4` | Selling prices per unit |
| `barcode` | Unit-specific barcode |
| `barcodes` | Unit-specific multiple barcodes |
| `unit_default_sale` | Is this the default unit for sales? |
| `unit_default_purchase` | Is this the default unit for purchases? |
| `unit_default_others` | Default for other operations |

A product can be sold as individual pieces or in boxes/cartons with different prices and barcodes.

**Confidence: VERIFIED** — Schema confirmed from .frm file.

### 3.4 Selling Prices

SAHL supports **four selling price levels** per product:

| Price | Intended Use (configurable) |
|-------|-----------------------------|
| `price1` | e.g., Retail |
| `price2` | e.g., Wholesale |
| `price3` | e.g., Special |
| `price4` | e.g., Custom |

Each price level has a configurable name (set in `options.price1_title` through `price4_title`).

There is also `price_min` — the minimum allowed selling price per product.

During sale, the user can select which price level to use.

**Confidence: VERIFIED** — Schema and options confirmed.

### 3.5 Product Pricing per Unit

Each unit of a product has its own prices (`items_units.price1` through `price4`). This means a product sold as "piece" and as "box" can have different prices at all four levels.

**Confidence: VERIFIED** — Schema confirmed.

### 3.6 Costing

| Field | Description |
|-------|-------------|
| `avg_cost` | Weighted average cost (recalculated on every purchase) |
| `last_cost` | Last purchase cost |
| `last_net_cost` | Last net cost after discounts |

Cost is recalculated on every purchase transaction using weighted average method. The `last_purchased` field tracks the date of the last purchase.

**Confidence: VERIFIED** — Fields confirmed in schema. Weighted average method confirmed from official website description.

### 3.7 Categories

SAHL supports **six levels of category hierarchy**:

| Field | Description |
|-------|-------------|
| `category1` through `category6` | Six hierarchy levels |

Each category level has a customizable name (set in `options.category2title` through `category6title`). For example, a business might name them: Sector, Group, Type, Subtype, Brand, Other.

**Confidence: VERIFIED** — Schema confirmed.

### 3.8 Product Status Flags

| Field | Description |
|-------|-------------|
| `starred` | Favorite/starred product |
| `dead` | Deleted or deactivated (soft delete) |
| `service` | Is this a service item (not physical stock)? |

**Confidence: VERIFIED** — Schema confirmed.

### 3.9 Expiration

| Field | Description |
|-------|-------------|
| `expirable` | Whether this product has expiry tracking |
| `expire_after_days` | Shelf life in days |
| `expire_alert_days` | Days before expiry to alert |

Global defaults can be set in options: `items_expire_after_days`, `items_expire_alert_days`.

**Confidence: VERIFIED** — Fields confirmed in schema and options.

### 3.10 Tax on Products

| Field | Description |
|-------|-------------|
| `itax1_apply` | Whether tax applies to this product |
| `itax1_per` | Tax percentage for this product |
| `price_include_tax1` | Whether the listed price includes tax |

**Confidence: VERIFIED** — Schema confirmed.

### 3.11 Product Photo

The `photo` field stores a product photo reference.

**Confidence: VERIFIED** — Field exists in schema.

### 3.12 E-Invoicing Product Fields

| Field | Description |
|-------|-------------|
| `einvoicing_itemType` | ZATCA item type classification |
| `einvoicing_itemCode` | ZATCA item code |

**Confidence: VERIFIED** — Schema confirmed.

### 3.13 Reorder Level

| Field | Description |
|-------|-------------|
| `reorder_qty` | Minimum stock level that triggers reorder alert |
| `qty` | Current total quantity (likely calculated across warehouses) |

**Confidence: VERIFIED** — Fields exist in schema. Whether `qty` is the sum of all warehouse quantities or a cached value is not verified.

---

## 4. Inventory

### 4.1 Warehouse/Store Structure

SAHL has a `stores` table:

| Field | Description |
|-------|-------------|
| `title` | Warehouse name |
| `active` | Whether active or not |

Multiple warehouses can exist. Each warehouse tracks its own inventory.

**Confidence: VERIFIED** — Schema confirmed.

### 4.2 Stock Balances

The `stores_items` table stores per-warehouse inventory:

| Field | Description |
|-------|-------------|
| `store_id` | Which warehouse |
| `item_id` | Which product |
| `qty` | Quantity in that warehouse |

This is the core inventory balance table. Every product's quantity is tracked **per warehouse**.

**Confidence: VERIFIED** — Schema confirmed.

### 4.3 Stock Movement via Invoices

All inventory movement flows through the `invoices` and `invoices_items` tables. Every invoice records:
- `store_id` — which warehouse is affected
- For transfers: `store_to_id` — destination warehouse

Each line item in `invoices_items` records:
- `qty`, `qty_in`, `qty_out` — quantity movement
- `unit` — which unit was used
- `unit_qty_in` / `unit_qty_out` — unit-level quantities

**Confidence: VERIFIED** — Schema confirmed.

### 4.4 Sales Effect on Inventory

When a sales invoice is saved:
1. Stock is **decreased** in the specified warehouse (`store_id`)
2. `qty_out` is recorded on the invoice line items
3. The item's `qty` field is updated

**Confidence: INFERRED** — Based on schema design. Direct observation not possible without running the application.

### 4.5 Purchase Effect on Inventory

When a purchase invoice is saved:
1. Stock is **increased** in the specified warehouse (`store_id`)
2. `qty_in` is recorded
3. The item's `avg_cost` is **recalculated** (weighted average)
4. `last_cost` and `last_net_cost` are updated
5. `last_purchased` date is updated

**Confidence: INFERRED** — Based on schema fields (avg_cost, last_cost, last_purchased) and official website description. Cost recalculation on purchase confirmed from website marketing.

### 4.6 Returns

Sales returns (`RETURNSALE`) and purchase returns (`RETURNPUR`) reverse their respective transactions:
- Sales returns increase stock back
- Purchase returns decrease stock and reverse cost impact

Both use the same `invoices` table with a different `kind` value.

**Confidence: INFERRED** — Based on schema design and report templates (form-returnsale, form-returnpur).

### 4.7 Inventory Adjustments

The `ADJUST` invoice type handles manual inventory adjustments.

**Confidence: VERIFIED** — Report templates exist (form-adjust: 80mm, A4).

### 4.8 Inventory Counting (Stock-Taking)

The `INVENT` invoice type handles physical stock counting / inventory audit.

Report templates exist: `form-invent-0010 - 80mm` and `form-invent-0020 - A4`.

**Confidence: VERIFIED** — Report templates confirmed.

### 4.9 Warehouse Transfers

The `TRANSFER` invoice type moves stock between warehouses:
- `store_id` — source warehouse
- `store_to_id` — destination warehouse

Report templates: `form-transfer-0010 - 80mm` and `form-transfer-0020 - A4`.

**Confidence: VERIFIED** — Schema field and report templates confirmed.

### 4.10 Delivery Tracking

The `invoices_delivery` table tracks partial deliveries:

| Field | Description |
|-------|-------------|
| `kind` | Invoice type |
| `item_pk` | Invoice item primary key |
| `item_id` | Product ID |
| `delivery_on` | Delivery date |
| `delivery_by_id` | Who delivered |
| `delivery_qty` | Quantity delivered |

The `invoices` table has `qty_delivered` for tracking delivery progress.

Settings: `delivery_sales_auto`, `delivery_transfers_auto`.

**Confidence: VERIFIED** — Schema confirmed.

---

## 5. Sales

### 5.1 Invoice Types Related to Sales

| Type | Database `kind` Value | Description |
|------|----------------------|-------------|
| Sales Invoice | `SALE` | Regular sale |
| Sales Return | `RETURNSALE` | Return from customer |
| Sales Quotation | `SALEQUOTE` | Price quote / reservation |

### 5.2 Sales Invoice Data

**Header fields (invoices table):**

| Field | Purpose |
|-------|---------|
| `date1` / `time1` | Date and time |
| `account_id` | Customer |
| `store_id` | Source warehouse |
| `salesman_id` | Salesman |
| `custom1` through `custom5` | User-defined fields |
| `payment_type` | Payment method |
| `payment_status` | PAID, CREDIT, PARTIAL |
| `due_date` | Due date for credit sales |
| `reference` | Reference text |
| `more` | Notes |
| `createdby_id` / `createdon` | Created by / when |
| `editedby_id` / `editedon` | Edited by / when |

**Amount fields:**

| Field | Purpose |
|-------|---------|
| `qty` | Total items count |
| `total` | Subtotal |
| `total_inc_tax` | Total including tax |
| `total_cost` | Total cost |
| `total_price` | Total selling price |
| `discount1_per` / `discount1` | First discount (percentage and amount) |
| `discount2_per` / `discount2` | Second discount |
| `addition1_per` through `addition3` | Additional charges (3 levels) |
| `tax1_per` / `tax1` | First tax (e.g., VAT) |
| `tax2_per` / `tax2` | Second tax |
| `grand_total` | Final amount |
| `customer_pay` | Amount paid by customer |
| `customer_change` | Change given |
| `profit` | Calculated profit |
| `net_cost`, `net_price`, `net_total` | Net amounts after discounts |
| `real_net_cost` | Actual net cost |

**Payment fields (multiple methods per invoice):**

| Field | Purpose |
|-------|---------|
| `cash` | Cash amount |
| `cheques` | Cheque amount |
| `credit` | Credit amount |
| `cashbox1_id` / `cashbox2_id` | Cash register(s) |
| `cashbox1` / `cashbox2` | Cash register amounts |
| `cashbox_fees` | Payment gateway fees |
| `expense1` | Related expense |

### 5.3 Line Items (invoices_items)

Each line item records:

| Field | Purpose |
|-------|---------|
| `item_id` | Product |
| `store_id` | Warehouse |
| `qty` | Quantity |
| `unit` | Unit of measure |
| `uqty1` / `uqty2` | Unit conversion factors |
| `unit_qty_in` / `unit_qty_out` | Stock movement quantities |
| `unit_cost` | Cost at time of sale |
| `unit_price` | Selling price |
| `total_cost` / `total_price` | Line totals |
| `discount1_per` / `discount1` | Line discount |
| `tax1_per` / `tax1` | Line tax |
| `grand_total` | Line final total |
| `profit` | Line profit |
| `real_cost` | Actual cost |
| `serials` | Serial numbers |
| `expire_date` | Expiry date |
| `cargo` | Cargo/shipping reference |
| `custom1` through `custom3` | Line-level custom fields |
| `return_pk` | Link to returned invoice line |

### 5.4 Invoice Status

| Field | Values |
|-------|--------|
| `status_kind` | OPEN |
| `status` | Values seen: OPEN, CLOSED (for quotations) |
| `payment_status` | CREDIT, NOT PAID, PAID, PARTIAL |
| `reference_kind` | Reference type |

### 5.5 Sales Workflow (Inferred)

1. User opens a new sales invoice
2. User selects a customer (or walk-in)
3. User selects a warehouse
4. Optionally selects a salesman
5. User adds products by barcode scan, code, or search
6. System applies unit conversion automatically
7. User selects selling price level (1-4)
8. User can apply line-level or invoice-level discounts
9. System applies configured taxes automatically
10. User selects payment method (cash, credit, mixed)
11. User saves the invoice
12. System: decreases stock in warehouse
13. System: updates customer account (for credit)
14. System: records cash register movement (for cash)
15. System: recalculates profit
16. User can print the invoice

**Confidence: INFERRED** — Based on schema fields and tutorial page structure. Not verified through actual UI operation.

### 5.6 Sales Quotations

Quotations (SALEQUOTE) can be:
- Created and saved
- Printed
- Converted to actual sales later
- Status tracked: OPEN / CLOSED

**Confidence: INFERRED** — Based on kind value and status field. Conversion workflow not directly verified.

### 5.7 Price Modification During Sale

Settings include:
- `sale_modify_prices` — permission to modify prices
- `sale_price_below_min_price` — permission to sell below minimum
- `sale_price_below_cost` — permission to sell below cost
- `sale_discount` — permission to apply discounts
- `sale_max_discount_per` / `sale_max_discount_amount` — discount limits

**Confidence: VERIFIED** — Permission fields confirmed in users table.

---

## 6. Purchases

### 6.1 Invoice Types Related to Purchases

| Type | Database `kind` Value | Description |
|------|----------------------|-------------|
| Purchase Invoice | `PURCHASE` | Regular purchase from supplier |
| Purchase Return | `RETURNPUR` | Return to supplier |

### 6.2 Purchase Invoice Data

Purchases use the same `invoices` and `invoices_items` tables as sales, with `kind = PURCHASE`.

Key differences:
- `account_id` links to a **supplier** account
- `store_id` is the **destination** warehouse (stock goes in)
- `reference` stores the purchase reference number
- `total_cost` / `real_net_cost` track purchase costs

### 6.3 Purchase Workflow (Inferred)

1. User opens a new purchase invoice
2. User selects a supplier
3. User selects a destination warehouse
4. User adds products with quantities
5. User enters unit cost (purchase price)
6. System records the cost per unit
7. User saves the invoice
8. System: increases stock in warehouse
9. System: updates supplier account (for credit purchases)
10. System: **recalculates weighted average cost** for each purchased item
11. System: updates `last_cost` and `last_net_cost` on each item
12. System: records cash register movement (for cash purchases)
13. User can print the purchase invoice

**Confidence: INFERRED** — Based on schema design, field names, and official website description of cost recalculation.

### 6.4 Purchase Returns

Purchase returns (RETURNPUR) reverse the purchase:
- Stock decreases in the warehouse
- Supplier account is credited
- Cost may be recalculated

Report templates: 6 variations (80mm, A4, A5, ArEn).

**Confidence: INFERRED** — Based on report template existence and schema symmetry.

---

## 7. Customers / Suppliers / Salesmen

### 7.1 Unified Account Model

**KEY DESIGN FACT:** Customers, suppliers, salesmen, and other parties all live in the **same `accounts` table**.

The `kind` field distinguishes them:

| `kind` Value | Entity Type |
|-------------|-------------|
| `customer` | Customer |
| `supplier` | Supplier |
| `salesman` | Salesman |
| `other` | Other party |

**Confidence: VERIFIED** — The .frm file literally contains the string: "customer - supplier - salesman - other".

### 7.2 Account Fields

| Field | Description |
|-------|-------------|
| `title` | Name |
| `code` | Account code |
| `phone` | Phone number |
| `email` | Email |
| `address`, `address2` | Addresses |
| `tax_id` | Tax/VAT registration number |
| `kind` | customer / supplier / salesman / other |
| `balance_in` | Opening debit balance |
| `balance_out` | Opening credit balance |
| `max_balance_out` | Credit limit |
| `sales_price_list` | Which price list (1-4) for this customer |
| `sales_discount_per` | Default discount percentage for this customer |
| `reminder_date` | Last reminder date |
| `more` | Additional notes |
| `dead` | Deleted/deactivated |
| `acc_custom1` through `acc_custom6` | User-defined custom fields |

**Tracking fields:**
| Field | Description |
|-------|-------------|
| `last_sale_date` | Last sale date |
| `last_sale_total` | Last sale total |
| `last_sale_id` | Last sale ID |
| `last_receipt_date` | Last receipt date |
| `last_receipt_amount` | Last receipt amount |
| `last_receipt_id` | Last receipt ID |
| `instal_receipts` | Total installment receipts received |
| `instal_payments` | Total installment payments made |

### 7.3 Customer-Specific Behavior

- Each customer can have a **default price list** (`sales_price_list`)
- Each customer can have a **default discount** (`sales_discount_per`)
- Credit limit per customer (`max_balance_out`)
- Custom fields for additional data (`acc_custom1` through `acc_custom6`)

**Confidence: VERIFIED** — All fields confirmed in schema.

---

## 8. Cash / Treasury

### 8.1 Cash Registers

SAHL supports **multiple cash registers** (cashboxes). The `banks` table defines payment methods:

| Field | Description |
|-------|-------------|
| `cashbox_title` | Display name |
| `payment_method` | Type |
| `active` | Whether active |
| `gateway` | Payment gateway |
| `fees_per` | Fee percentage |
| `fees_min` | Minimum fee |
| `fees_fixed` | Fixed fee |

Users are assigned to specific cash registers via the `users.cashboxes` field.

**Confidence: VERIFIED** — Schema confirmed.

### 8.2 Financial Transactions (money table)

The `money` table is the core financial ledger:

| Field | Description |
|-------|-------------|
| `kind` | Transaction type |
| `kind_id` | Transaction ID |
| `parent_kind` / `parent_id` | Link to related document (invoice, etc.) |
| `date1` / `time1` | Transaction date/time |
| `cashbox_id` | Which cash register |
| `account_id` | Which account (customer/supplier) |
| `amount` | Transaction amount |
| `money_in` | Cash received |
| `money_out` | Cash paid |
| `cashbox_in` / `cashbox_out` | Cash register in/out |
| `cashbox_fees` | Payment gateway fees |
| `category1` / `category2` | Expense categories |
| `reference` | Reference text |
| `is_cheque` | Is this a cheque? |
| `cheque_no` / `cheque_bank` | Cheque details |
| `due_date` | Due date (for cheques/credit) |
| `is_liquid` | Is it liquidated (cleared)? |
| `liquid_date` | When it was liquidated |
| `is_closed` | Is it closed? |
| `account_date` | Date on customer/supplier account |
| `account_time` | Time on account |
| `tax1_per` / `tax1` | Tax on this transaction |
| `amount_taxed` | Taxed amount |
| `transfer_id` | Cash transfer ID |
| `createdby_id` / `createdon` | Audit: who/when created |
| `editedby_id` / `editedon` | Audit: who/when edited |

### 8.3 Money-Invoice Linking

The `money_invoices` table links financial transactions to invoices:

| Field | Description |
|-------|-------------|
| `m_kind` / `m_id` | Money transaction reference |
| `i_kind` / `i_id` | Invoice reference |
| `amount` | Amount applied |

This enables tracking which payments apply to which invoices.

**Confidence: VERIFIED** — Schema confirmed.

### 8.4 Receipts and Payments

- **Receipts** (المقبوضات): Money received from customers
- **Payments** (المدفوعات): Money paid to suppliers or expenses
- Both tracked in the `money` table

Permissions: separate permissions for listing, adding, editing, and deleting both receipts and payments.

**Confidence: VERIFIED** — Permission fields and report templates confirmed.

### 8.5 Expenses

Expenses are tracked through the `money` table with:
- `category1` / `category2` — expense categories
- Report: "تحليل النفقات" (Expense Analysis)

**Confidence: INFERRED** — Fields exist, report mentioned on website. Exact expense workflow not directly observed.

### 8.6 Cash Transfers

Transfers between cash registers are supported:
- Report templates: `form-cashtransfer-0010 - 80mm` and `form-cashtransfer-0020 - A4`
- Permissions: `money_transfer_add`, `money_transfer_edit`, `money_transfer_del`
- Users have `cashbox_transfer_to` field specifying allowed target registers

**Confidence: VERIFIED** — Templates and permissions confirmed.

### 8.7 Cheques

Cheques are tracked through:
- `money.is_cheque` — flag
- `money.cheque_no` — cheque number
- `money.cheque_bank` — issuing bank
- `money.due_date` — due date
- `money.is_liquid` — whether the cheque has been collected/cleared

**Confidence: VERIFIED** — Schema fields confirmed.

### 8.8 Daily Report

The daily report shows all cash movement for the current day:
- Sales totals
- Purchase totals
- Returns totals
- Receipts
- Payments
- Expenses
- Cash register balance (opening, in, out, closing)

Report templates: `report-daily-0010 - 80mm` and `report-daily-0020 - A4`.

**Confidence: INFERRED** — Based on template names and official website description. Exact report content not directly observed.

---

## 9. Installments

### 9.1 Installment Plans

The `installments` table:

| Field | Description |
|-------|-------------|
| `account_id` | Customer |
| `title` | Description |
| `total` | Total amount |
| `paid` | Amount paid so far |
| `unpaid` | Remaining amount |
| `parts` | Number of installments |
| `part_amount` | Regular installment amount |
| `last_part_amount` | Final (possibly different) amount |
| `date1` | Start date |
| `dead` | Cancelled/deactivated |

### 9.2 Installment Payments

The `installments_parts` table tracks individual payments:

| Field | Description |
|-------|-------------|
| `installment_id` | Parent installment plan |
| `date1` | Due date |
| `total` | Amount due |
| `paid` | Amount paid |
| `unpaid` | Remaining |
| `more` | Notes |

### 9.3 Installment Workflow (Inferred)

1. An invoice is created for a customer
2. The invoice amount is split into installments
3. Each installment has a due date
4. Customer makes partial payments over time
5. Each payment is recorded against specific installment parts
6. Progress is tracked (paid/unpaid per part and overall)

**Confidence: INFERRED** — Schema structure clearly supports this workflow. Tutorial page exists (learn/instals). Actual UI behavior not observed.

### 9.4 Installment Reports

- Account statement shows installment activity
- `instal_receipts` and `instal_payments` on accounts track totals
- Permissions: `instal_list`, `instal_add`, `installment_list/add/edit/del`, `installment_due_parts`, `installment_receipt`

**Confidence: VERIFIED** — Permission fields confirmed.

---

## 10. Reports

### 10.1 Report Template System

SAHL uses **Microsoft Excel (XLSX) templates** for all printing. Users can customize templates by editing the XLSX files in Excel. PNG preview images are provided for each template.

Templates exist in two language versions: `ar` (Arabic) and `en` (English). Both directories contain identical template structures.

**Confidence: VERIFIED** — 107 template files in each language directory confirmed.

### 10.2 Form Templates (Transaction Documents)

| Document | Template Variations |
|----------|-------------------|
| Sales Invoice | 14 templates (57mm, 80mm x2, A4 x3, A5, Delivery, Instal Contract, Cafe x3, ArEn x2, DotMatrix, Electronic Invoice) |
| Purchase Invoice | 8 templates (80mm, A4 x3, A5, Receipt, ArEn, DotMatrix) |
| Sales Return | 7 templates (80mm x2, A4 x3, A5, ArEn) |
| Purchase Return | 6 templates (80mm, A4 x3, A5, ArEn) |
| Sales Quotation | 7 templates (80mm x2, A4 x3, A5, ArEn) |
| Payment/Expense | 3 templates (80mm, A4, ArEn) |
| Receipt | 3 templates (80mm, A4, ArEn) |
| Inventory Adjustment | 2 templates (80mm, A4) |
| Stock Counting | 2 templates (80mm, A4) |
| Warehouse Transfer | 2 templates (80mm, A4) |
| Cash Transfer | 2 templates (80mm, A4) |

### 10.3 Report Templates

| Report | Sizes |
|--------|-------|
| Daily Movement Report | 80mm, A4 |
| Account Statement | A4, A5, 80mm, ArEn |

### 10.4 Paper Size Support

| Size | Use Case |
|------|----------|
| 57mm | Small thermal receipt printer |
| 80mm | Standard thermal receipt printer (most common) |
| A5 | Half-page printout |
| A4 | Full-page printout |
| DotMatrix | Dot matrix printer format |

### 10.5 Special Templates

- **Electronic Invoice** (`form-sale-140`) — ZATCA-compliant format
- **Delivery Note** (`form-sale-0080`) — For deliveries
- **Installment Contract** (`form-sale-0090`) — For installment sales
- **Cafe templates** (`form-sale-0100/0110/0111`) — For restaurant/cafe use
- **Bilingual** (ArEn) — Arabic/English side by side

### 10.6 Barcode Printing

SAHL supports printing barcode labels:
- `wbarcode_enabled` — enable/disable
- `wbarcode_size` — label size
- `wbarcode_prefix` — barcode prefix
- `wbarcode_code_size` — code text size
- `wbarcode_value_size` — value text size

Automatic prompt: When entering a new product, SAHL asks "Do you want to print barcode labels for this product?"

**Confidence: VERIFIED** — Settings and behavior confirmed from schema and website.

### 10.7 Known Report Business Questions

| Report | Business Question Answered |
|--------|--------------------------|
| Daily Report | "What happened in my business today?" |
| Account Statement | "What is this customer's/supplier's full history and current balance?" |
| Sales Analysis | "How are my sales and profits broken down by items, customers, salesmen, stores, months, or days?" |
| Purchase Analysis | "How are my purchases broken down?" |
| Item Statement/Movement | "What happened with this specific product?" |
| Warehouse Report | "What is the value of goods currently in my warehouse?" |
| Expense Analysis | "Where is my money going?" |

**Confidence: INFERRED** — Based on official website descriptions and template naming.

---

## 11. Users and Permissions

### 11.1 User Table

| Field | Description |
|-------|-------------|
| `title` | Username |
| `pass` | Password |
| `active` | Whether account is active |

### 11.2 Access Control Fields

| Field | Description |
|-------|-------------|
| `options` | Access to system settings |
| `stores` | Which warehouses this user can access |
| `cashboxes` | Which cash registers this user can access |
| `cashbox_transfer_to` | Which registers they can transfer to |

### 11.3 Visibility Permissions

| Permission | Description |
|------------|-------------|
| `see_cost` | Can see product cost information |
| `edit_ids` | Can edit invoice IDs |
| `edit_date` | Can edit invoice dates |
| `today_only_update` | Can only modify today's transactions |
| `today_only_list` | Can only view today's data |
| `remove_bank` | Can remove bank entries |
| `change_qty_minus_zero` | Can reduce quantity to zero or below |

### 11.4 Item Permissions

| Permission | Controls |
|------------|----------|
| `item_list` | View products |
| `item_add` | Create products |
| `item_edit` | Edit products |
| `item_edit_openbal` | Edit opening balances |
| `item_del` | Delete products |
| `item_statement` | View item statement |
| `item_evaluation` | View item valuation |
| `item_in_out` | View item movement |
| `item_barcode` | Print barcodes |
| `item_cargo` | View cargo info |

### 11.5 Account Permissions

| Permission | Controls |
|------------|----------|
| `account_list` | View accounts |
| `account_add` | Create accounts |
| `account_edit` | Edit accounts |
| `account_edit_openbal` | Edit opening balances |
| `account_del` | Delete accounts |
| `account_customer` | Access customer accounts |
| `account_supplier` | Access supplier accounts |
| `account_salesman` | Access salesman accounts |
| `account_other` | Access other accounts |
| `account_balance` | View balances |
| `account_statement` | View statements |
| `account_close_invoices` | Close invoices |

### 11.6 Purchase Permissions

| Permission | Controls |
|------------|----------|
| `purchase_list` | View purchase invoices |
| `purchase_add` | Create purchase invoices |
| `purchase_edit` | Edit purchase invoices |
| `purchase_del` | Delete purchase invoices |
| `purchase_return` | Create purchase returns |
| `purchase_tax1_edit` | Edit tax on purchases |
| `purchase_cash_payment` | Make cash payments on purchases |
| `purchase_credit_payment` | Make credit payments on purchases |

### 11.7 Sale Permissions

| Permission | Controls |
|------------|----------|
| `sale_list` | View sales |
| `sale_add` | Create sales |
| `sale_edit` | Edit sales |
| `sale_del` | Delete sales |
| `sale_modify_prices` | Modify prices during sale |
| `sale_price_below_min_price` | Sell below minimum price |
| `sale_price_below_cost` | Sell below cost |
| `sale_discount` | Apply discounts |
| `sale_see_profit` | See profit information |
| `sale_see_invoice_profit` | See per-invoice profit |
| `sale_return` | Create sales returns |
| `delivery` | Manage deliveries |
| `sale_max_discount_per` | Maximum discount % |
| `sale_max_discount_amount` | Maximum discount amount |
| `sale_tax1_edit` | Edit tax on sales |
| `sale_cash_payment` | Handle cash payments |
| `sale_credit_payment` | Handle credit payments |

### 11.8 Quotation Permissions

| Permission | Controls |
|------------|----------|
| `salequote_list` | View quotations |
| `salequote_add` | Create quotations |
| `salequote_edit` | Edit quotations |
| `salequote_del` | Delete quotations |

### 11.9 Inventory Permissions

| Permission | Controls |
|------------|----------|
| `invent_list/add/edit/del` | Stock counting |
| `adjust_list/add/edit/del` | Inventory adjustments |
| `transfer_list/add/edit/del` | Warehouse transfers |

### 11.10 Financial Permissions

| Permission | Controls |
|------------|----------|
| `payment_list/add/edit/del` | Payments |
| `receipt_list/add/edit/del` | Receipts |
| `money_transfer_add/edit/del` | Cash register transfers |

### 11.11 Installment Permissions

| Permission | Controls |
|------------|----------|
| `instal_list/add` | Installment plan management |
| `installment_list/add/edit/del` | Installment records |
| `installment_due_parts` | View due installments |
| `installment_receipt` | Issue installment receipts |

### 11.12 Report Permissions

| Permission | Controls |
|------------|----------|
| `money_list` | View financial list |
| `payment_analysis` | Expense analysis |
| `receipt_analysis` | Receipt analysis |
| `reports` | General reports access |
| `report_daily` | Daily report |
| `report_sales_analysis` | Sales analysis |
| `report_purchases_analysis` | Purchase analysis |

### 11.13 Other Permissions

| Permission | Controls |
|------------|----------|
| `einvoicing_submit` | Submit e-invoices to ZATCA |

**Confidence: VERIFIED** — All permission fields confirmed directly from the users.frm file. This is one of the most thoroughly verified sections.

---

## 12. Warehouses / Stores

### 12.1 Multi-Store Support

SAHL fully supports multiple warehouses/stores:

- Each store has a name (`stores.title`) and active flag
- Each store independently tracks inventory (`stores_items`)
- Products can be in different quantities across stores
- Users can be restricted to specific stores (`users.stores`)
- Invoices record which store they affect (`invoices.store_id`)

### 12.2 Store Transfers

Stock can be moved between stores:
- Uses the `TRANSFER` invoice type
- Records source (`store_id`) and destination (`store_to_id`)
- Automatically decreases stock in source and increases in destination

### 12.3 Per-Store Reporting

- Inventory report can show per-store quantities and values
- Sales can be filtered/analyzed by store
- Stock value report shows value per store

**Confidence: VERIFIED** — Schema confirmed. Per-store reporting inferred from official website description.

---

## 13. Printing

### 13.1 Template System

- Templates are **XLSX (Excel) files** located in `C:\SAHL\Program\Reports\ar\` and `C:\SAHL\Program\Reports\en\`
- Users can customize by editing templates in Microsoft Excel
- Users can add company logo, change fonts, adjust layout
- SAHL uses the modified template for future printing

### 13.2 Thermal Printer Support

- 80mm receipt paper (most common)
- 57mm small receipt paper
- Templates optimized for narrow paper widths

### 13.3 Full Page Printing

- A4 paper templates for full invoices
- A5 paper templates for half-page documents

### 13.4 Dot Matrix Support

- Templates for dot matrix printers still available
- Relevant for some business environments

### 13.5 Print Copies

`sales_print_copies` setting controls how many copies to print.

### 13.6 Bilingual Templates

"ArEn" templates print Arabic and English side by side on the same document.

**Confidence: VERIFIED** — All template types confirmed from file system.

---

## 14. Settings

### 14.1 Company Settings

| Setting | Description |
|---------|-------------|
| `company` | Company name |
| `cr_id` | Commercial registration number |
| `contact_details` through `contact_details3` | Contact information |
| `country` | Country |
| `tax_id` | Tax registration number |

### 14.2 Currency Settings

| Setting | Description |
|---------|-------------|
| `currency` | Currency code |
| `currency_title` | Currency name |
| `currency_subtitle` | Currency subtitle |
| `currency_abr` | Currency abbreviation |
| `currency_title_ar` through `currency_abr_ar` | Arabic versions |
| `currency_symbol` | Symbol (e.g., SR, EGP) |
| `currency_decimals` | Decimal places |

### 14.3 Price List Names

| Setting | Description |
|---------|-------------|
| `price1_title` through `price4_title` | Customizable names for 4 price levels |

### 14.4 Category Names

| Setting | Description |
|---------|-------------|
| `category2title` through `category6title` | Customizable category level names |

### 14.5 Custom Fields

| Setting | Description |
|---------|-------------|
| `acc_custom2` through `acc_custom6` | Account custom field labels |
| `invoice_custom1` through `invoice_custom5` | Invoice header custom field labels |
| `invoice_items_custom1` through `invoice_items_custom3` | Invoice line item custom field labels |

### 14.6 Tax Settings

| Setting | Description |
|---------|-------------|
| `tax1_title` | Tax 1 name (e.g., "ضريبة القيمة المضافة") |
| `tax1_per` | Tax 1 percentage |
| `tax1_auto_sale` | Auto-apply on sales |
| `tax1_auto_purchase` | Auto-apply on purchases |
| `tax2_title` | Tax 2 name |
| `tax2_per` | Tax 2 percentage |
| `tax2_auto_sale` | Auto-apply on sales |
| `tax2_auto_purchase` | Auto-apply on purchases |

### 14.7 Invoice Additional Charges

| Setting | Description |
|---------|-------------|
| `invoice_addition2_sale` | Additional charge name for sales |
| `invoice_addition2_sale_per` | Default percentage |
| `invoice_addition2_sale_amount` | Default amount |
| `invoice_addition3_sale` | Second additional charge |
| `invoice_addition2_pur` | Additional charge for purchases |
| `invoice_addition3_pur` | Second additional charge for purchases |

### 14.8 Order/Delivery Settings

| Setting | Description |
|---------|-------------|
| `order_status` | Order tracking |
| `order_shippedby` | Shipping method tracking |
| `delivery_sales_auto` | Auto-create delivery for sales |
| `delivery_transfers_auto` | Auto-create delivery for transfers |

### 14.9 Barcode Settings

| Setting | Description |
|---------|-------------|
| `wbarcode_enabled` | Enable barcode label printing |
| `wbarcode_size` | Label size |
| `wbarcode_prefix` | Barcode prefix |
| `wbarcode_code_size` | Code text size on label |
| `wbarcode_value_size` | Value text size on label |

### 14.10 Expiry Settings

| Setting | Description |
|---------|-------------|
| `items_expire_after_days` | Default shelf life |
| `items_expire_alert_days` | Default alert period |

### 14.11 Sales Behavior

| Setting | Description |
|---------|-------------|
| `force_last_account_sales_price` | Force using customer's last price |
| `force_last_account_sales_price_months` | Look-back period in months |
| `sales_print_copies` | Number of copies to print |

### 14.12 System Security

| Setting | Description |
|---------|-------------|
| `backup_pass` | Encryption password for backups |
| `super_pass` | Super administrator password |
| `block_update_before_date` | Prevent updates before date |
| `block_list_before_date` | Prevent listing before date |

### 14.13 E-Invoicing (ZATCA) Settings

| Setting | Description |
|---------|-------------|
| `einvoicing_restricted_mode` | Restricted mode |
| `einvoicing_production_mode` | Production mode |
| `einv_platform` | Platform identifier |
| `einvoicing_client_id` | ZATCA client ID |
| `einvoicing_client_secret_key` | ZATCA client secret |
| `einvoicing_usb_pin` | USB token PIN |
| `einvoicing_taxpayerActivityCode` | Activity code |
| `einvoicing_taxType1` / `einvoicing_subType1` | Tax type 1 |
| `einvoicing_taxType2` / `einvoicing_subType2` | Tax type 2 |
| `einv_issuer_O` | Issuer organization |
| `einv_issuer_OU` | Issuer organizational unit |
| `einv_issuer_CN` | Issuer common name |
| `einv_issuer_RegisteredAddress` | Registered address |
| `einv_issuer_BusinessCategory` | Business category |
| `einv_private_key` / `einv_public_key` | Cryptographic keys |
| `einv_csr` | Certificate signing request |
| `einv_zatca_Compliance_RequestID` | Compliance request ID |
| `einv_zatca_Compliance_binarySecurityToken` | Compliance security token |
| `einv_zatca_Compliance_secret` | Compliance secret |
| `einv_zatca_Production_RequestID` | Production request ID |
| `einv_zatca_Production_binarySecurityToken` | Production security token |
| `einv_zatca_Production_secret` | Production secret |

**Confidence: VERIFIED** — All settings confirmed from the options.frm file.

---

## 15. Backup

### 15.1 Auto Backup

- `AutoBackup.exe` (version 1.2.0.9) is a separate application
- On program exit, SAHL prompts: "Do you want to back up?"
- Backups are saved to a user-specified folder
- Backup to USB flash drive is supported
- Backups can be encrypted using `backup_pass` from settings

### 15.2 Restore

- Backups can be restored from the AutoBackup utility
- A `backup_restore` permission controls who can restore

**Confidence: VERIFIED** — AutoBackup.exe confirmed. Backup prompt behavior confirmed from official website.

---

## 16. Technical Architecture

### 16.1 Application

| Component | Details |
|-----------|---------|
| Executable | `Sahl.exe` |
| Size | 6,960,912 bytes (6.6 MB) |
| Version | 17.0.0.70 |
| Framework | Delphi (32-bit) |
| Company | JUSTAGAIN |
| Location | `C:\SAHL\Program\Sahl.exe` |

### 16.2 Database Server

| Component | Details |
|-----------|---------|
| Engine | MySQL 5.7.33 Community Server |
| Storage | InnoDB |
| Service Name | `MySQL_SAHL` |
| Start Mode | Automatic (Windows Service) |
| Port | 3306 |
| Database Name | `sahl1` |
| Location | `C:\SAHL\mysql-5.7.33-winx64\` |
| Buffer Pool | 1 GB |
| Log File Size | 48 MB |
| Flush Time | 10 seconds |
| Slow Query Log | Enabled (queries > 10 seconds) |

### 16.3 Configuration

| File | Purpose |
|------|---------|
| `C:\SAHL\Program\Sahl` | Encrypted application config (Base64 + encryption, 5,490 bytes, 61 lines) |
| `C:\SAHL\mysql-5.7.33-winx64\_my.ini` | MySQL server configuration |

### 16.4 Application Dependencies

| File | Purpose |
|------|---------|
| `ChilkatDelphi32.dll` (12.6 MB) | Chilkat library (email, FTP, HTTP, etc.) |
| `libeay32.dll` | OpenSSL crypto library |
| `ssleay32.dll` | OpenSSL SSL library |
| `openssl.exe` | OpenSSL command-line tool |

### 16.5 Remote Support Tools

| Tool | File |
|------|------|
| AnyDesk | `AnyDesk.exe` |
| TeamViewer | `TeamViewerQS.exe` |
| RustDesk | `RustDesk-x32-qs.exe` |
| Customer Support | `CustomerSupport.exe` |

### 16.6 Audio Resources

UI sound effects in `C:\SAHL\Program\Audio\`:
- `Add1.wav` — Product added
- `Ask1.wav` — Question prompt
- `Error1.wav` — Error
- `Message1.wav` — Message
- `Save1.wav` — Saved
- `Start1.wav` — Application start

### 16.7 Wallpaper Resources

Background images in `C:\SAHL\Program\Walls\` — 6 JPG files.

### 16.8 Data Flow

```
Sahl.exe (Delphi 32-bit)
    |
    | MySQL protocol (TCP localhost:3306)
    |
mysqld.exe (MySQL 5.7.33, Windows Service: MySQL_SAHL)
    |
    | InnoDB storage engine
    |
C:\SAHL\mysql-5.7.33-winx64\data\sahl1\
    (17 .frm + .ibd table files)
```

### 16.9 Firewall Rules

During installation, SAHL creates Windows Firewall rules to allow MySQL on port 3306 (both inbound and outbound). This suggests possible LAN multi-user support, though this was not verified.

**Confidence: VERIFIED** — All technical details confirmed from installed files, Windows service listing, and install.bat script.

---

## 17. Database Reference

### 17.1 Complete Table List

| # | Table Name | Records Type | Engine |
|---|-----------|-------------|--------|
| 1 | `accounts` | Customers, suppliers, salesmen, others | InnoDB |
| 2 | `banks` | Payment methods / bank accounts | InnoDB |
| 3 | `einvoicing` | ZATCA e-invoice submissions | InnoDB |
| 4 | `installments` | Installment plans | InnoDB |
| 5 | `installments_parts` | Individual installment payments | InnoDB |
| 6 | `invoices` | All transactions (sales, purchases, returns, etc.) | InnoDB |
| 7 | `invoices_delivery` | Delivery tracking for invoice items | InnoDB |
| 8 | `invoices_items` | Line items for all invoices | InnoDB |
| 9 | `items` | Product catalog | InnoDB |
| 10 | `items_units` | Product-unit relationships and per-unit prices | InnoDB |
| 11 | `money` | All financial transactions | InnoDB |
| 12 | `money_invoices` | Links between money transactions and invoices | InnoDB |
| 13 | `options` | System settings (single-row table) | InnoDB |
| 14 | `stores` | Warehouse/store definitions | InnoDB |
| 15 | `stores_items` | Per-store inventory balances | InnoDB |
| 16 | `units` | Global units of measurement | InnoDB |
| 17 | `users` | Application users with permissions | InnoDB |

### 17.2 Key Relationships (Inferred)

```
accounts <--- invoices.account_id (customer or supplier)
accounts <--- invoices.salesman_id (salesman)
stores <--- invoices.store_id (source warehouse)
stores <--- invoices.store_to_id (destination warehouse for transfers)
invoices <--- invoices_items.kind + invoices_items.kind_id (line items)
invoices <--- invoices_delivery (delivery tracking)
items <--- invoices_items.item_id (product on each line)
items <--- items_units.item_id (units per product)
items <--- stores_items.item_id (inventory per store)
stores <--- stores_items.store_id (inventory per store)
accounts <--- money.account_id (financial transaction party)
invoices <--- money_invoices.i_kind + i_id (invoice link)
money <--- money_invoices.m_kind + m_id (money transaction link)
accounts <--- installments.account_id (installment plan customer)
installments <--- installments_parts.installment_id (installment payments)
units <--- items_units.unit_id (unit definition)
users (standalone with embedded permission flags)
options (standalone single-row settings)
banks (standalone payment methods)
```

### 17.3 Invoice Kind Values

The `invoices.kind` field uses these values:

| Kind | Purpose |
|------|---------|
| `SALE` | Sales invoice |
| `RETURNSALE` | Sales return |
| `SALEQUOTE` | Sales quotation |
| `PURCHASE` | Purchase invoice |
| `RETURNPUR` | Purchase return |
| `INVENT` | Physical stock counting |
| `TRANSFER` | Inter-warehouse transfer |
| `ADJUST` | Inventory adjustment |

**Note:** The kind value for cash adjustment was seen as "ADJUSTCASH" in the schema analysis but was not fully confirmed.

### 17.4 Invoice Status Values

| Field | Values |
|-------|--------|
| `status_kind` | OPEN |
| `status` | OPEN, CLOSED |
| `payment_status` | CREDIT, NOT PAID, PAID, PARTIAL |

---

## 18. What We Could Not Verify

### 18.1 Not Verified — UI/Workflow

- Actual screen layout and navigation
- Step-by-step user interface workflow for each operation
- Exact button placements and dialog sequences
- How the main menu/dashboard looks
- Touch screen interaction behavior
- How the product search works in practice
- How barcode scanning is handled in the UI
- How reports are displayed on screen before printing

### 18.2 Not Verified — Database Access

- MySQL credentials (username/password) — the config file is encrypted
- Actual data currently in the database
- Total number of products, customers, invoices in the installed instance
- Whether the application connects as `user`, `sahl`, or another account

### 18.3 Not Verified — Business Logic

- Exact weighted average cost formula (algorithm details)
- Exact tax calculation order (tax before or after discounts?)
- Exact discount stacking order (which discount applies first?)
- How rounding is handled in multi-step calculations
- Exact behaviour when selling below cost
- How the system handles negative stock
- What happens when a product is deleted but has invoice history

### 18.4 Not Verified — Multi-User / Network

- Whether multiple computers can connect to the same MySQL instance
- How concurrent users are handled
- Whether there is row-level locking or application-level locking
- Network performance characteristics

### 18.5 Not Verified — Auto-Update

- Update server URL
- Update mechanism (full download vs. delta)
- How updates are verified/authenticated
- What happens if update fails mid-process

### 18.6 Not Verified — E-Invoicing

- Actual ZATCA API interaction flow
- How invoices are submitted and approved
- Error handling for rejected invoices
- How compliance certificates are renewed

### 18.7 Not Verified — Backup

- Backup file format
- Maximum backup size handling
- How encrypted backups are decrypted
- Whether backup includes MySQL service state or just data files

### 18.8 Not Verified — Licensing

- How the license is validated
- What happens when the license expires
- Whether the application checks online for license status
- Offline grace period behavior

---

> **End of SAHL Reference Knowledge Base**
>
> This document preserves the verified study findings for use during
> JOKER planning. It should be updated if additional SAHL investigation
> is performed (e.g., through actual UI testing).
