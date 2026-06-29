# خريطة هيكل قاعدة البيانات — SAHL Schema Map

**قاعدة البيانات:** PostgreSQL (Supabase) — `postgres`
**المشروع:** `ahram-distribution` (Al Ahram Trading & Distribution)
**تاريخ الاستخراج:** 2026-06-29
**المصدر:** ملفات الترحيل (Migration SQL files) — `supabase/migrations/*.sql`
**الوضع:** قراءة فقط (Read-Only)

---

## ملخص الجداول المصدرة

يغطي هذا التقرير **16 جدولاً** موزعة على ثلاث فئات:

| # | الفئة | الجدول | الوصف |
|---|---|---|---|
| 1 | الفواتير | `orders` | Customer orders with full lifecycle tracking. |
| 2 | الفواتير | `order_items` | Line items within an order. Prices captured at order time. |
| 3 | الفواتير | `order_status_history` | Complete audit trail of every status change in an order lifecycle. |
| 4 | الفواتير | `order_modification_history` | Audit trail of modifications made to orders after submission. |
| 5 | الفواتير | `credit_invoices` | Per-order credit invoices. Each approved credit order generates one invoice. |
| 6 | الفواتير | `credit_invoice_cheques` | One cheque per invoice. One-to-one relationship. |
| 7 | العملاء | `customers` | Registered business entities that place orders. Owned by Sales Representatives. |
| 8 | العملاء | `customer_addresses` | Multiple addresses per customer for shipping, billing, and other purposes. |
| 9 | العملاء | `customer_contacts` | Multiple contacts per customer with names, phones, and roles. |
| 10 | العملاء | `customer_ownership_history` | Audit trail of customer ownership changes. INSERT-only — no UPDATE or DELETE. |
| 11 | العملاء | `customer_credit_ledger` | Running credit balance for each customer. INSERT-only — no UPDATE or DELETE allowed. |
| 12 | العملاء | `customer_credit_accounts` | Active credit accounts per customer. One account per customer. |
| 13 | الأصناف | `products` | Individual products within a company catalog. Multi-unit sales supported. |
| 14 | الأصناف | `product_units` | — |
| 15 | الأصناف | `companies` | Product manufacturers or brands. |
| 16 | الأصناف | `inventory` | Manual inventory tracking. One record per product (1:1). Quantity deducted at order approval. |

---

## orders

> **الفئة:** الفواتير  
> **الوصف:** Customer orders with full lifecycle tracking.  
> **عدد الحقول:** 19

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `order_number` | `varchar(30)` | نعم | NULL | — | — |
| 3 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 4 | `owner_type` | `varchar(20)` | نعم | ''employee'' | — | — |
| 5 | `owner_id` | `uuid` | نعم | NULL | — | — |
| 6 | `status` | `varchar(30)` | نعم | ''draft'' | — | — |
| 7 | `subtotal` | `decimal(12,2)` | نعم | 0 | — | — |
| 8 | `discount_amount` | `decimal(12,2)` | نعم | 0 | — | — |
| 9 | `tax_amount` | `decimal(12,2)` | نعم | 0 | — | — |
| 10 | `total_amount` | `decimal(12,2)` | نعم | 0 | — | — |
| 11 | `notes` | `text` | لا | NULL | — | — |
| 12 | `revision_number` | `integer` | نعم | 1 | — | — |
| 13 | `submitted_at` | `timestamptz` | لا | NULL | — | — |
| 14 | `approved_at` | `timestamptz` | لا | NULL | — | — |
| 15 | `delivered_at` | `timestamptz` | لا | NULL | — | — |
| 16 | `cancelled_at` | `timestamptz` | لا | NULL | — | — |
| 17 | `created_by` | `uuid` | نعم | NULL | — | — |
| 18 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 19 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## order_items

> **الفئة:** الفواتير  
> **الوصف:** Line items within an order. Prices captured at order time.  
> **عدد الحقول:** 8

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `order_id` | `uuid` | نعم | NULL | — | — |
| 3 | `product_id` | `uuid` | نعم | NULL | — | — |
| 4 | `unit_type` | `varchar(20)` | نعم | NULL | — | — |
| 5 | `unit_quantity` | `integer` | نعم | NULL | — | — |
| 6 | `piece_quantity` | `integer` | نعم | NULL | — | — |
| 7 | `unit_price` | `decimal(12,2)` | نعم | NULL | — | — |
| 8 | `total_price` | `decimal(12,2)` | نعم | NULL | — | — |

## order_status_history

> **الفئة:** الفواتير  
> **الوصف:** Complete audit trail of every status change in an order lifecycle.  
> **عدد الحقول:** 7

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `order_id` | `uuid` | نعم | NULL | — | — |
| 3 | `from_status` | `varchar(30)` | لا | NULL | — | — |
| 4 | `to_status` | `varchar(30)` | نعم | NULL | — | — |
| 5 | `changed_by` | `uuid` | نعم | NULL | — | — |
| 6 | `reason` | `text` | لا | NULL | — | — |
| 7 | `changed_at` | `timestamptz` | نعم | now() | — | — |

## order_modification_history

> **الفئة:** الفواتير  
> **الوصف:** Audit trail of modifications made to orders after submission.  
> **عدد الحقول:** 9

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `order_id` | `uuid` | نعم | NULL | — | — |
| 3 | `revision_number` | `integer` | نعم | NULL | — | — |
| 4 | `field_name` | `varchar(100)` | نعم | NULL | — | — |
| 5 | `old_value` | `text` | لا | NULL | — | — |
| 6 | `new_value` | `text` | لا | NULL | — | — |
| 7 | `modified_by` | `uuid` | نعم | NULL | — | — |
| 8 | `reason` | `text` | نعم | NULL | — | — |
| 9 | `modified_at` | `timestamptz` | نعم | now() | — | — |

## credit_invoices

> **الفئة:** الفواتير  
> **الوصف:** Per-order credit invoices. Each approved credit order generates one invoice.  
> **عدد الحقول:** 11

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `invoice_number` | `varchar(50)` | نعم | NULL | — | — |
| 3 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 4 | `order_id` | `uuid` | نعم | NULL | — | — |
| 5 | `invoice_amount` | `decimal(12,2)` | نعم | NULL | — | — |
| 6 | `issue_date` | `date` | نعم | CURRENT_DATE | — | — |
| 7 | `due_date` | `date` | نعم | NULL | — | — |
| 8 | `status` | `public` | نعم | ''open'' | — | — |
| 9 | `paid_at` | `timestamptz` | لا | NULL | — | — |
| 10 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 11 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## credit_invoice_cheques

> **الفئة:** الفواتير  
> **الوصف:** One cheque per invoice. One-to-one relationship.  
> **عدد الحقول:** 10

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `invoice_id` | `uuid` | نعم | NULL | — | — |
| 3 | `cheque_number` | `varchar(100)` | نعم | NULL | — | — |
| 4 | `bank_name` | `varchar(255)` | نعم | NULL | — | — |
| 5 | `amount` | `decimal(12,2)` | نعم | NULL | — | — |
| 6 | `due_date` | `date` | نعم | NULL | — | — |
| 7 | `status` | `public` | نعم | ''received'' | — | — |
| 8 | `recorded_by` | `uuid` | نعم | NULL | — | — |
| 9 | `recorded_at` | `timestamptz` | نعم | now() | — | — |
| 10 | `created_at` | `timestamptz` | نعم | now() | — | — |

## customers

> **الفئة:** العملاء  
> **الوصف:** Registered business entities that place orders. Owned by Sales Representatives.  
> **عدد الحقول:** 13

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `identity_id` | `uuid` | نعم | NULL | — | — |
| 3 | `code` | `varchar(20)` | نعم | NULL | — | — |
| 4 | `company_name` | `varchar(255)` | نعم | NULL | — | — |
| 5 | `email` | `varchar(255)` | لا | NULL | — | — |
| 6 | `credit_limit` | `decimal(12,2)` | نعم | 0 | — | — |
| 7 | `credit_days` | `integer` | نعم | 0 | — | — |
| 8 | `owner_type` | `varchar(20)` | نعم | ''employee'' | — | — |
| 9 | `owner_id` | `uuid` | نعم | NULL | — | — |
| 10 | `is_active` | `boolean` | نعم | true | — | — |
| 11 | `registered_at` | `timestamptz` | لا | NULL | — | — |
| 12 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 13 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## customer_addresses

> **الفئة:** العملاء  
> **الوصف:** Multiple addresses per customer for shipping, billing, and other purposes.  
> **عدد الحقول:** 11

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 3 | `label` | `varchar(100)` | لا | NULL | — | — |
| 4 | `address_line1` | `varchar(255)` | نعم | NULL | — | — |
| 5 | `address_line2` | `varchar(255)` | لا | NULL | — | — |
| 6 | `city` | `varchar(100)` | نعم | NULL | — | — |
| 7 | `governorate` | `varchar(100)` | لا | NULL | — | — |
| 8 | `postal_code` | `varchar(20)` | لا | NULL | — | — |
| 9 | `latitude` | `decimal(10,7)` | لا | NULL | — | — |
| 10 | `longitude` | `decimal(10,7)` | لا | NULL | — | — |
| 11 | `is_default` | `boolean` | نعم | false | — | — |

## customer_contacts

> **الفئة:** العملاء  
> **الوصف:** Multiple contacts per customer with names, phones, and roles.  
> **عدد الحقول:** 6

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 3 | `full_name` | `varchar(255)` | نعم | NULL | — | — |
| 4 | `phone` | `varchar(20)` | نعم | NULL | — | — |
| 5 | `email` | `varchar(255)` | لا | NULL | — | — |
| 6 | `role` | `varchar(100)` | لا | NULL | — | — |

## customer_ownership_history

> **الفئة:** العملاء  
> **الوصف:** Audit trail of customer ownership changes. INSERT-only — no UPDATE or DELETE.  
> **عدد الحقول:** 7

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 3 | `previous_owner_id` | `uuid` | لا | NULL | — | — |
| 4 | `new_owner_id` | `uuid` | نعم | NULL | — | — |
| 5 | `changed_by` | `uuid` | نعم | NULL | — | — |
| 6 | `reason` | `text` | لا | NULL | — | — |
| 7 | `changed_at` | `timestamptz` | نعم | now() | — | — |

## customer_credit_ledger

> **الفئة:** العملاء  
> **الوصف:** Running credit balance for each customer. INSERT-only — no UPDATE or DELETE allowed.  
> **عدد الحقول:** 10

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 3 | `transaction_type` | `ledger_transaction_type` | نعم | NULL | — | — |
| 4 | `amount` | `decimal(12,2)` | نعم | NULL | — | — |
| 5 | `running_balance` | `decimal(12,2)` | نعم | NULL | — | — |
| 6 | `reference_type` | `varchar(50)` | لا | NULL | — | — |
| 7 | `reference_id` | `uuid` | لا | NULL | — | — |
| 8 | `notes` | `text` | لا | NULL | — | — |
| 9 | `created_by` | `uuid` | نعم | NULL | — | — |
| 10 | `created_at` | `timestamptz` | نعم | now() | — | — |

## customer_credit_accounts

> **الفئة:** العملاء  
> **الوصف:** Active credit accounts per customer. One account per customer.  
> **عدد الحقول:** 13

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `customer_id` | `uuid` | نعم | NULL | — | — |
| 3 | `credit_program_id` | `uuid` | نعم | NULL | — | — |
| 4 | `credit_limit` | `decimal(12,2)` | نعم | NULL | — | — |
| 5 | `payment_term_days` | `integer` | نعم | NULL | — | — |
| 6 | `outstanding_credit` | `decimal(12,2)` | نعم | 0 | — | — |
| 7 | `reserved_credit` | `decimal(12,2)` | نعم | 0 | — | — |
| 8 | `guarantee_cheque_amount` | `decimal(12,2)` | لا | NULL | — | — |
| 9 | `credit_status` | `public` | نعم | ''active'' | — | — |
| 10 | `activated_at` | `timestamptz` | نعم | now() | — | — |
| 11 | `activated_by` | `uuid` | نعم | NULL | — | — |
| 12 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 13 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## products

> **الفئة:** الأصناف  
> **الوصف:** Individual products within a company catalog. Multi-unit sales supported.  
> **عدد الحقول:** 11

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `company_id` | `uuid` | نعم | NULL | — | — |
| 3 | `product_name` | `varchar(255)` | نعم | NULL | — | — |
| 4 | `legacy_code` | `varchar(100)` | نعم | NULL | — | — |
| 5 | `description` | `text` | لا | NULL | — | — |
| 6 | `carton_quantity` | `integer` | نعم | NULL | — | — |
| 7 | `carton_price` | `decimal(12,2)` | نعم | NULL | — | — |
| 8 | `is_active` | `boolean` | نعم | true | — | — |
| 9 | `image_url` | `text` | لا | NULL | — | — |
| 10 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 11 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## product_units

> **الفئة:** الأصناف  
> **الوصف:** لا يوجد وصف  
> **عدد الحقول:** 5

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `product_id` | `uuid` | نعم | NULL | — | — |
| 3 | `unit_type` | `varchar(20)` | نعم | NULL | — | — |
| 4 | `is_active` | `boolean` | نعم | true | — | — |
| 5 | `created_at` | `timestamptz` | نعم | now() | — | — |

## companies

> **الفئة:** الأصناف  
> **الوصف:** Product manufacturers or brands.  
> **عدد الحقول:** 6

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `company_name` | `varchar(255)` | نعم | NULL | — | — |
| 3 | `legacy_code` | `varchar(100)` | نعم | NULL | — | — |
| 4 | `is_active` | `boolean` | نعم | true | — | — |
| 5 | `created_at` | `timestamptz` | نعم | now() | — | — |
| 6 | `updated_at` | `timestamptz` | نعم | now() | — | — |

## inventory

> **الفئة:** الأصناف  
> **الوصف:** Manual inventory tracking. One record per product (1:1). Quantity deducted at order approval.  
> **عدد الحقول:** 6

| # | اسم الحقل | النوع | إجباري? | القيمة الافتراضية | مفتاح? | مرجع (FK) |
|---|---|---|---|---|---|---|
| 1 | `id` | `uuid` | لا | gen_random_uuid() | 🔑 PK | — |
| 2 | `product_id` | `uuid` | نعم | NULL | — | — |
| 3 | `quantity` | `integer` | نعم | 0 | — | — |
| 4 | `last_counted_at` | `timestamptz` | لا | NULL | — | — |
| 5 | `notes` | `text` | لا | NULL | — | — |
| 6 | `updated_at` | `timestamptz` | نعم | now() | — | — |

---

## إحصائيات

- **جداول الفواتير:** 6
- **جداول العملاء:** 6
- **جداول الأصناف:** 4
- **الإجمالي:** 16
- **قاعدة البيانات:** PostgreSQL 15+ (Supabase)
- **تاريخ التقرير:** 2026-06-29T09:45:29.684Z

> تم استخراج هذا التقرير من ملفات SQL في `supabase/migrations/` باستخدام NPM API (Node.js).