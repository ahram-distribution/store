# Pricing and Tiers Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `OWNER_DEFINED`

---

## TIER_SYSTEM_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner-defined rule:

Pricing tiers are NOT permanently assigned to customers.

A tier is a selectable pricing mode used during order creation.

Users may:

- Select a tier.
- Change tiers.
- Remove the selected tier.
- Return to base pricing.

Allowed users:

- Customer
- Sales Representative
- Sales Manager (when creating orders)

---

## REALTIME_PRICING_BEHAVIOR

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a tier is selected:

The following must update immediately:

- Product prices
- Product cards
- Cart values
- Totals
- Discounts

Updates should occur instantly when tier selection changes.

---

## TIER_MINIMUM_REQUIREMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Each tier has:

- Minimum purchase requirement.

If minimum requirement is not met:

- Order cannot be submitted.

---

## TIER_ELIGIBILITY_CALCULATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Daily Deals, Flash Offers and Auctions do NOT contribute toward tier qualification thresholds.

They are excluded from:

- Tier minimum purchase calculations
- Tier eligibility calculations
- Tier activation requirements

---

## CART_TOTALS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Daily Deals, Flash Offers and Auctions are included in:

- Cart totals
- Order totals
- Sales totals
- Reporting totals
- Target calculations

---

## TIER_QUALIFICATION_EXAMPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Tier Minimum:
10,000 EGP

Order Contents:

- Regular Products = 6,000 EGP
- Daily Deal = 4,000 EGP

Cart Total:
10,000 EGP

Tier Calculation:
6,000 EGP

Result:

Tier minimum is NOT achieved.

Reason:

Daily Deal value does not count toward tier qualification.

---

## TIER_AND_PROMOTION_SEPARATION_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Promotional mechanisms must remain isolated from tier-discount qualification logic.

Purpose:

Prevent discounted promotional purchases from artificially satisfying tier requirements.

---

## TIER_ADMINISTRATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Upper Management controls:

- Tier names
- Tier discounts
- Minimum purchase values
- Tier activation
- Tier visibility
- Product exceptions
- Company exceptions

---

## PRICING_MODEL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Default behavior:

Carton price is entered.

Lower unit prices are calculated automatically.

Exception support:

Upper Management may manually enter unit pricing when automatic calculation is not appropriate.

---

## PRICING_AUTHORITY_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Final order pricing is determined only by:

- Base pricing
- Selected pricing tier
- Predefined discounts
- Predefined exceptions configured by Upper Management

Sales Representatives and Sales Managers do not apply manual discounts during order creation.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Tier System Principle | "Pricing tiers are not permanently assigned. A tier is a selectable pricing mode during order creation. Users may select, change, remove, or return to base pricing. Allowed: Customer, Sales Rep, Sales Manager." | Tiers are transient order-level pricing selections, not customer-level classifications. | Tiers, Pricing, Orders, Cart | OWNER_DEFINED |
| 2026-06-09 | Realtime Pricing Behavior | "When a tier is selected, product prices, cards, cart values, totals, and discounts must update instantly." | Immediate UI reactivity required on tier change. | Pricing, Cart, UI | OWNER_DEFINED |
| 2026-06-09 | Tier Minimum Requirement | "Each tier has a minimum purchase requirement. If not met, order cannot be submitted." | Tiers enforce a minimum order value threshold. | Tiers, Orders | OWNER_DEFINED |
| 2026-06-09 | Tier Administration | "Upper Management controls: tier names, discounts, minimum purchase values, activation, visibility, product exceptions, company exceptions." | Full administrative control over tier configuration. | Tiers, Products, Companies, Permissions | OWNER_DEFINED |
| 2026-06-09 | Pricing Authority Rule | "Final order pricing determined only by: base pricing, selected tier, predefined discounts, predefined exceptions configured by Upper Management. Sales Reps and Sales Managers do not apply manual discounts during order creation." | Pricing is system-determined; no manual discount authority for field roles. | Pricing, Orders, Tiers | OWNER_DEFINED |
| 2026-06-09 | Pricing Model | "Carton price entered. Lower unit prices calculated automatically. Upper Management may manually enter unit pricing when automatic calculation is not appropriate." | Default pricing is carton-based with auto-calculation; manual override available for exceptions. | Pricing, Products, Units | OWNER_DEFINED |
| 2026-06-10 | Promotions and Tiers | "Pricing tiers never apply to Daily Deals, Flash Offers, or Auctions. Each promotion type has its own independent pricing. No tier stacking is allowed." | Tier discounts are exclusive to catalog products; promotional/auction items have independent pricing. | Pricing, Tiers, Daily Deals, Flash Offers, Auctions | OWNER_DEFINED |
| 2026-06-10 | Tier Eligibility Calculation | "Daily Deals, Flash Offers and Auctions do NOT contribute toward tier qualification thresholds. Excluded from: tier minimum purchase calculations, tier eligibility calculations, tier activation requirements." | Promotional/auction values are excluded when calculating whether an order meets tier minimum requirements. | Pricing, Tiers, Daily Deals, Flash Offers, Auctions | OWNER_DEFINED |
| 2026-06-10 | Cart Totals | "Daily Deals, Flash Offers and Auctions are included in: cart totals, order totals, sales totals, reporting totals, target calculations." | Despite being excluded from tier qualification, promotional/auction values count toward all financial and reporting totals. | Pricing, Cart, Orders, Reports, Targets | OWNER_DEFINED |
| 2026-06-10 | Tier and Promotion Separation Principle | "Promotional mechanisms must remain isolated from tier-discount qualification logic. Purpose: prevent discounted promotional purchases from artificially satisfying tier requirements." | Architectural principle ensuring tier qualification reflects only regular (non-discounted) purchases. | Pricing, Tiers, Architecture | OWNER_DEFINED |
 
---

## Open Questions for Owner

1. Is the three-price model (carton/unit/wholesale) sufficient, or are additional price types needed?
2. Who has authority to create/manage daily deals and flash offers? (Any employee? Manager only?)
3. Should flash offers be implemented fully, or is the feature deprioritized?

---

*End of 08_PRICING_AND_TIERS_RULES.md*
