# Promotional Systems

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `OWNER_DEFINED`

---

## DAILY_DEAL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Business Definition

صفقة اليوم is a standalone promotional package.

Daily Deal is always a package.

### Package Contents

Package may contain:

- Single product
- Multiple products

Package contents are manually defined by Upper Management.

### Inventory

Daily Deal packages are independent from catalog inventory.

Daily Deal packages maintain their own configured quantity.

### Duration

Duration is controlled by Upper Management.

---

## DAILY_DEAL_REPORTING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Daily Deals:

- Count in reports
- Count in targets

---

## DAILY_DEAL_PURCHASE_LIMITS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Customer may purchase a Daily Deal once per order.

If multiple Daily Deals are active:

Customer may purchase one unit from each deal in the same order.

---

## FLASH_OFFER

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Business Definition

عرض الساعة (Hour Offer) is a time-limited promotional package.

### Relationship to Daily Deal

Flash Offer follows the same business model as Daily Deal.

Differences:

- Defined start time
- Defined end time
- Typically limited-duration offer

### Concurrency

Multiple Flash Offers may run simultaneously.

### Expiration Behavior

When offer expires:

- Remains visible
- Selling is disabled
- Display "Offer Expired"
- Display expiration date and time

---

## MIXED_ORDERS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Single order may contain:

- Catalog products
- Daily Deal package
- Flash Offer package

At the same time.

---

## PROMOTIONS_AND_TIERS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Pricing tiers never apply to:

- Daily Deals
- Flash Offers
- Auctions

Each promotion type has its own independent pricing.

No tier stacking is allowed.

Promotional values do NOT contribute toward tier qualification thresholds.

Promotional values ARE included in cart totals, order totals, sales totals, reporting totals, and target calculations.

For detailed tier eligibility rules, see `08_PRICING_AND_TIERS_RULES.md` — TIER_ELIGIBILITY_CALCULATION, CART_TOTALS, and TIER_AND_PROMOTION_SEPARATION_PRINCIPLE.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Daily Deal Package | "Daily Deal is always a package. Package may contain single or multiple products. Contents manually defined by Upper Management. Independent from catalog inventory. Maintains own configured quantity." | Daily deals are manually curated packages with independent inventory tracking. | Daily Deals, Products, Inventory | OWNER_DEFINED |
| 2026-06-09 | Daily Deal Reporting | "Daily Deals count in reports and count in targets." | Daily deal sales contribute to business metrics and performance targets. | Daily Deals, Reports, Targets | OWNER_DEFINED |
| 2026-06-09 | Daily Deal Purchase Limits | "Customer may purchase a Daily Deal once per order. If multiple Daily Deals active, customer may purchase one unit from each deal in the same order." | One unit per deal per order; multiple distinct deals allowed in same order. | Daily Deals, Orders, Cart | OWNER_DEFINED |
| 2026-06-09 | Flash Offer Model | "Flash Offer follows the same business model as Daily Deal. Differences: defined start time, defined end time, typically limited-duration offer." | Flash offers are structurally identical to daily deals, differing only in time constraints. | Flash Offers, Daily Deals, Time Windows | OWNER_DEFINED |
| 2026-06-09 | Flash Offer Concurrency | "Multiple Flash Offers may run simultaneously." | No limit on concurrent flash offers. | Flash Offers, Scheduling | OWNER_DEFINED |
| 2026-06-09 | Flash Offer Expiration | "When offer expires: remains visible, selling disabled, display 'Offer Expired', display expiration date and time." | Expired offers become read-only with clear expiration indicators. | Flash Offers, UI, Storefront | OWNER_DEFINED |
| 2026-06-09 | Mixed Orders | "Single order may contain catalog products, Daily Deal package, and Flash Offer package at the same time." | Orders support combining regular and promotional items in one transaction. | Orders, Cart, Daily Deals, Flash Offers | OWNER_DEFINED |
| 2026-06-10 | Promotions and Tiers | "Pricing tiers never apply to Daily Deals, Flash Offers, or Auctions. Each promotion type has its own independent pricing. No tier stacking is allowed. Promotional values do NOT contribute toward tier qualification thresholds. Promotional values ARE included in cart totals, order totals, sales totals, reporting totals, and target calculations." | Tier discounts exclusive to catalog products; promotional/auction values excluded from tier qualification but included in all financial/reporting totals. | Pricing, Tiers, Daily Deals, Flash Offers, Auctions | OWNER_DEFINED |
| 2026-06-10 | Promotion Pricing Isolation | "The following pricing systems are fully independent from pricing tiers: Daily Deals, Flash Offers, Auctions. Pricing tiers never apply to these systems." | Confirms full pricing independence between promotion types and tiers. | Pricing, Tiers, Daily Deals, Flash Offers, Auctions | OWNER_DEFINED |
 
---

*End of 07_PROMOTIONAL_SYSTEMS.md*
