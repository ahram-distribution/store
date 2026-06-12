# Auction Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `OWNER_DEFINED`

---

## AUCTION_CREATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only Upper Management may create auctions.

---

## AUCTION_INVENTORY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Auction inventory is independent from catalog inventory.

Auction items are package-based and manually defined.

Auction quantity is managed separately.

---

## AUCTION_PARTICIPATION_FLOW

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Workflow

1. Customer requests participation.
2. Request appears to Upper Management.
3. Upper Management approves or rejects participation.
4. Approved customer may bid.

### Participant Type

Only customers participate in auctions.

Employees do not participate as bidders.

---

## AUCTION_CONFIGURATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Auction package may contain:

- Name
- Image
- Contents
- Quantity
- Starting price
- Start time
- End time

All configuration is controlled by Upper Management.

---

## BIDDING_RULES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Rules

- Bid increments are predefined.
- Increment value is configured by Upper Management.
- Customers bid using the configured increment structure.

---

## REALTIME_REQUIREMENTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Auction must operate in realtime.

Participants should be able to view:

- Participant names
- Current bid values
- Live bidding activity

---

## AUCTION_LIVE_SCREEN

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visible information:

- Participant names
- Latest bid
- Current highest bidder
- Remaining time

Visible to auction viewers.

---

## AUCTION_FAILURE_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If winner does not complete purchase:

- Deposit is forfeited
- Administrative action may be taken
- Upper Management may relaunch auction

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Auction Participation Flow | "Customer requests participation via 'المشاركة بالمزاد'. Request submitted for approval. Upper Management approves/rejects. After approval, button changes to 'المزايدة'." | Two-step participation flow: request → approval → bidding enabled. Upper Management controls access. | Auctions, Participants | OWNER_DEFINED |
| 2026-06-09 | Auction Configuration | "Auction package contains name, image, contents, quantity, starting price, start/end time. All controlled by Upper Management." | Defines the configurable fields of an auction package. Management-controlled setup. | Auctions, Auction Items | OWNER_DEFINED |
| 2026-06-09 | Bidding Rules | "Bid increments are predefined and configured by Upper Management. Customers bid using configured increment structure." | Bidding follows a fixed increment structure set by management. | Auctions, Bids | OWNER_DEFINED |
| 2026-06-09 | Realtime Requirements | "Auction must operate in realtime. Participants view participant names, current bid values, live bidding activity." | Real-time visibility of bids, participants, and activity is a core requirement. | Auctions, Bids, Participants, Activity | OWNER_DEFINED |
| 2026-06-09 | Auction Creation | "Only Upper Management may create auctions." | Auction creation restricted to Upper Management. | Auctions, Permissions | OWNER_DEFINED |
| 2026-06-09 | Auction Inventory | "Auction inventory is independent from catalog inventory. Auction items are package-based and manually defined. Auction quantity is managed separately." | Auctions have their own inventory system, separate from catalog. | Auctions, Inventory, Products | OWNER_DEFINED |
| 2026-06-09 | Participant Type | "Only customers participate in auctions. Employees do not participate as bidders." | Auction participation is customer-only; employees cannot bid. | Auctions, Participants, Customers, Employees | OWNER_DEFINED |
| 2026-06-09 | Auction Live Screen | "Visible information: participant names, latest bid, current highest bidder, remaining time. Visible to auction viewers." | Live auction display requirements accessible to all viewers. | Auctions, UI, Realtime | OWNER_DEFINED |
| 2026-06-09 | Auction Failure Rule | "If winner does not complete purchase: deposit forfeited, administrative action may be taken, Upper Management may relaunch auction." | Consequences and remedies for winner non-completion. | Auctions, Payments, Deposits | OWNER_DEFINED |
 
---

*End of 08_AUCTION_RULES.md*
