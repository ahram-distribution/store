# Provider API Guidelines

**Document:** 29_PROVIDER_API_GUIDELINES.md  
**Status:** Final  
**Architecture Version:** v1.2 (Frozen)  
**Date:** 2026-07-05  

---

## 1. Naming Conventions

### 1.1 Interface Names

```
I{BusinessCapability}Provider
```

| Pattern | Example |
|---|---|
| `I{Capability}Provider` | `ISalesOrderProvider`, `ICustomerProvider` |
| NOT `I{Entity}Repository` | ❌ `IOrderRepository` |
| NOT `I{Entity}Service` | ❌ `IOrderService` |

### 1.2 Method Names — Commands (Write)

Pattern: `{businessVerb}{Noun}()`

| Verb | Business Meaning | Example |
|---|---|---|
| `place` | Create new entity | `placeNewOrder()` |
| `register` | Onboard a new business entity | `registerNewCustomer()` |
| `submit` | Transition to submitted state | `submitOrder()` |
| `approve` | Grant approval | `approveOrder()` |
| `reject` | Deny with reason | `rejectOrder()` |
| `cancel` | Void/terminate before completion | `cancelOrder()` |
| `suspend` | Temporarily disable | `suspendCustomer()` |
| `receive` | Accept a payment/incoming item | `receiveCashPayment()` |
| `deposit` | Place a check for clearing | `depositCheck()` |
| `clear` | Confirm check settlement | `clearCheck()` |
| `return` | Send back (check bounce) | `returnCheck()` |
| `reserve` | Hold stock for an order | `reserveStock()` |
| `release` | Free a reservation | `releaseReservation()` |
| `adjust` | Correct inventory balance | `adjustInventory()` |
| `confirm` | Validate a shipment/operation | `confirmShipment()` |
| `start` | Begin a tracked period | `startWorkday()` |
| `end` | Complete a tracked period | `endWorkday()` |
| `record` | Register a financial event | `recordPayment()` |
| `update` | Modify a specific field | `updateCreditLimit()` |

### 1.3 Method Names — Queries (Read)

Pattern: `get{Noun}By{Criteria}()` or `search{Nouns}()`

| Pattern | Example |
|---|---|
| `get{Entity}ById(id)` | `getOrderById(id)` |
| `get{Entity}By{Criteria}(param)` | `getCustomerOrders(customerId)` |
| `get{Noun}(param)` | `getInventoryLevel(productId)` |
| `get{Noun}Range(from, to)` | `getWorkdayRange(companyId, from, to)` |
| `search{Nouns}(criteria)` | `searchOrders(criteria)` |

### 1.4 Parameter Names

- Use domain language: `orderId`, `customerId`, `productId`, `checkId`
- Use primitive types for identifiers: `string`
- Use query-object parameters for complex filtering: `criteria: OrderSearchCriteria`
- Do NOT use generic parameter names: `id`, `data`, `input`

---

## 2. Return Types

### 2.1 Write Operations (Commands)

| Scenario | Return Type |
|---|---|
| Entity created | `Promise<void>` (entity returned via Application Result) |
| Entity modified | `Promise<void>` |
| Error case | Throw typed exception |

### 2.2 Read Operations (Queries)

| Scenario | Return Type |
|---|---|
| Single entity found | `Promise<TEntity>` |
| Single entity not found | `Promise<null>` |
| Collection found | `Promise<TEntity[]>` |
| Collection empty | `Promise<[]>` |
| Error case | Throw typed exception |

### 2.3 Batch Operations

| Scenario | Return Type |
|---|---|
| All succeeded | `Promise<void>` |
| Partial failure | Throw first failure exception |
| All failed | Throw exception with aggregate message |

### 2.4 Prohibited Return Types

| Prohibited | Reason |
|---|---|
| `ProviderResult<T>` | NOT generic wrapper — use exceptions for errors |
| `ApplicationResult<T>` | Application layer concerns — providers must not depend on application types |
| `Result<T>` | Generic result objects encourage ignoring errors |
| `void | null` | Ambiguous — use `void` for success, throw for error |
| `undefined` | Never return undefined — use `null` for "not found" |

---

## 3. Error Strategy

### 3.1 Exception Types

All providers throw typed exceptions from `src/providers/contracts/exceptions.ts`:

| Exception | When to Throw |
|---|---|
| `ConnectionException` | Database/network connection failure |
| `NotFoundException` | Entity not found by given identifier |
| `ConflictException` | Duplicate key, version conflict, optimistic lock |
| `TimeoutException` | Operation exceeded time limit |
| `ProviderException` | Generic provider error (base class — prefer specific types) |

### 3.2 Exception Handling

Providers throw — they do NOT catch and wrap.

Application Handlers catch provider exceptions and convert to `ApplicationResult`:

```typescript
try {
  await salesOrderProvider.placeNewOrder(order)
  return success(order)
} catch (e) {
  if (e instanceof ConflictException) return conflict('Order already exists')
  if (e instanceof ConnectionException) return failure('Database unavailable', 'SERVICE_UNAVAILABLE')
  return failure((e as Error).message, 'PERSISTENCE_ERROR')
}
```

### 3.3 Error Message Convention

- Messages are business-readable (Arabic or English): `"العميل غير موجود"` / `"Customer not found"`
- Exception codes are machine-readable: `CUSTOMER_NOT_FOUND`, `ORDER_CONFLICT`
- Never expose SQL errors, stack traces, or internal details to Application Layer

---

## 4. RequestContext Usage

### 4.1 When to Pass

RequestContext carries ambient metadata (tenant ID, correlation ID, session info). It is passed as the LAST parameter, or included in the method signature for audit-critical operations:

```typescript
// Option A: Context as last parameter
placeNewOrder(order: SalesOrder, context: RequestContext): Promise<void>

// Option B: Context NOT passed (simpler) — context injected via constructor
class SupabaseSalesOrderProvider {
  constructor(private context: RequestContext) {}
  async placeNewOrder(order: SalesOrder): Promise<void> { ... }
}
```

**Recommendation:** Option B (constructor injection) — reduces method signature noise. Use Option A only when different operations require different context per call.

### 4.2 Context Fields

| Field | Required | Purpose |
|---|---|---|
| `tenantId` | Yes | Multi-tenant isolation |
| `correlationId` | Yes | Request tracing across provider boundaries |
| `identityId` | Yes | Audit trail (who performed the action) |

---

## 5. Pagination Rules

### 5.1 When to Paginate

- Any query that returns an unbounded collection MUST support pagination
- Methods that return business-limited results (e.g., `getCustomerOrders()` for a single customer — typically limited) MAY omit pagination

### 5.2 Pagination Parameters

```typescript
interface PageRequest {
  limit: number    // Max results per page (1-100, default 50)
  offset: number   // Zero-based offset (default 0)
}

interface PageResponse<T> {
  items: T[]
  total: number     // Total matching records (for UI pagination)
  limit: number
  offset: number
}
```

### 5.3 Cursor Pagination (Alternative)

For high-volume queries, cursor-based pagination is preferred:

```typescript
interface CursorRequest {
  after?: string   // Cursor from previous response
  limit: number
}

interface CursorResponse<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}
```

---

## 6. Filtering Rules

### 6.1 Query-Object Pattern

Complex queries use a structured criteria object:

```typescript
interface OrderSearchCriteria {
  companyId: string
  customerId?: string
  status?: OrderStatus | OrderStatus[]
  fromDate?: Date
  toDate?: Date
  salesRepId?: string
  minAmount?: number
  maxAmount?: number
  searchText?: string
  page?: PageRequest
  sort?: SortRequest
}
```

### 6.2 Filtering by Status

- Accept single value OR array: `status?: OrderStatus | OrderStatus[]`
- Empty filter = no status filter (return all)

### 6.3 Date Ranges

- Use `fromDate` / `toDate` naming
- Both inclusive: `date >= fromDate && date <= toDate`
- Omit `fromDate` = no lower bound
- Omit `toDate` = no upper bound

---

## 7. Sorting Rules

### 7.1 Sort Specification

```typescript
interface SortRequest {
  field: string      // Domain field name (camelCase)
  direction: 'asc' | 'desc'
}
```

### 7.2 Allowed Sort Fields

Contracts document which fields support sorting:

```typescript
// Allowed: 'createdAt', 'grandTotal', 'status', 'customerName'
sort?: SortRequest
```

### 7.3 Default Sort

- Unless specified, default sort is `{ field: 'createdAt', direction: 'desc' }`

---

## 8. Batch Operations

### 8.1 When to Use

Batch operations are for performance optimization only. They are NOT for transactional grouping.

| Scenario | Batch? |
|---|---|
| Upload 100 orders from legacy system | ✅ Batch import |
| Submit 5 orders at end of shift | ❌ Sequential submits — each needs independent validation |

### 8.2 Batch Signature

```typescript
batchPlaceOrders(orders: SalesOrder[]): Promise<void>
batchAdjustInventory(adjustments: Array<{ productId: string; quantity: number; reason: string }>): Promise<void>
```

### 8.3 Error Handling

- Batch operations are ALL-OR-NOTHING for business consistency
- Partial success is not supported — if any item fails, all fail
- The exception identifies the failing item

---

## 9. Optional Operations

### 9.1 Optional Parameters

- Use optional parameters (?) for truly optional data
- Document default behavior when optional parameter is omitted
- Prefer explicit `undefined` checks over overloads

```typescript
// Preferred
searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]>

// NOT preferred (overloads)
searchOrders(companyId: string): Promise<SalesOrder[]>
searchOrders(companyId: string, status: OrderStatus): Promise<SalesOrder[]>
```

### 9.2 Optional Provider Methods

If a provider implementation cannot support certain operations:

```typescript
// Mark as optional in interface
searchOrders?(criteria: OrderSearchCriteria): Promise<SalesOrder[]>
```

Application handlers MUST check for existence:
```typescript
if (provider.searchOrders) {
  return await provider.searchOrders(criteria)
}
return failure('Search not supported by this provider', 'NOT_IMPLEMENTED')
```

---

## 10. Versioning Strategy

### 10.1 Interface Versioning

Provider contracts are versioned at the INTERFACE level, not the implementation level.

- Breaking changes → new interface name: `ISalesOrderProviderV2`
- Non-breaking changes → extend existing interface: `interface ISalesOrderProviderV2 extends ISalesOrderProvider`

### 10.2 Breaking Changes

Changes that break existing consumers:

- Removing a method
- Renaming a method
- Adding a required parameter
- Changing a return type
- Narrowing accepted parameter types

### 10.3 Non-Breaking Changes

Changes that do NOT break existing consumers:

- Adding a new method (existing consumers ignore it)
- Adding an optional parameter (with default)
- Widening accepted parameter types

### 10.4 Deprecation

```typescript
/** @deprecated Use placeNewOrder() instead. Will be removed in v3. */
placeOrder(order: SalesOrder): Promise<void>
```

Deprecated methods maintain backward compatibility for one major version cycle.

---

## 11. Contract Stability Commitment

All provider contracts in this document are **frozen** for Phase 3 implementation.

Changes require:
1. New ADR (Architecture Decision Record)
2. Updated contract review (28_PROVIDER_CONTRACT_REVIEW.md)
3. Product Owner approval

No contract changes will be made during Phase 3 implementation unless a blocking issue is discovered.
