# Storefront Purchase Experience

> **Last Updated:** 2026-06-09

---

## PURCHASE_BUTTON

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Product cards should use:

"شراء"

instead of:

"أضف للسلة"

After addition:

Button becomes:

"إزالة من السلة"

---

## QUANTITY_INPUT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Users must be able to:

- Increase quantity using controls
- Decrease quantity using controls
- Directly type quantity

Examples:

53
120
500

Direct numeric entry is required.

---

## QUANTITY_RULES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

- Integer values only
- No fractional quantities
- No negative quantities

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Purchase Button | "Product cards should use شراء instead of أضف للسلة. After addition, button becomes إزالة من السلة." | Simplified Arabic call-to-action for purchase flow. | Storefront, UI, Cart | OWNER_DEFINED |
| 2026-06-09 | Quantity Input | "Users must be able to increase/decrease quantity using controls and directly type quantity." | Flexible quantity input supporting both controls and direct entry. | Storefront, Cart, Products | OWNER_DEFINED |
| 2026-06-09 | Quantity Rules | "Integer values only. No fractional quantities. No negative quantities." | Strict integer-only validation for order quantities. | Storefront, Cart, Orders | OWNER_DEFINED |

---

*End of 13_STOREFRONT_EXPERIENCE.md*
