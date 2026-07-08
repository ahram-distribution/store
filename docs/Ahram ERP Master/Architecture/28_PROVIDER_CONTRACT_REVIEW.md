# Provider Contract Review

**Document:** 28_PROVIDER_CONTRACT_REVIEW.md  
**Status:** Final Review  
**Architecture Version:** v1.2 (Frozen)  
**Date:** 2026-07-05  

---

## 1. Review Scope

This document reviews all 6 Provider Contracts against the Business Capability Architecture (ADR-001). Each contract is evaluated for:

- Business orientation vs. CRUD orientation
- Method naming consistency with domain language
- Completeness relative to owning capability
- Separation of command (write) vs. query (read) operations

---

## 2. ISalesOrderProvider

**Owning Capability:** Order Management  
**Scope:** Draft → Submitted → Reviewing → Approved → Preparing → Dispatched → Delivered lifecycle + queries

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| `save(order)` | `placeNewOrder(order)` | Renamed | "Save" is CRUD. "Place new order" is the business event of recording a new draft order. |
| `save(order)` (status flow) | `submitOrder(order)` | Renamed | Each status transition is a distinct business operation. Submit, approve, reject, cancel are real-world events with distinct semantics. |
| `save(order)` (approve flow) | `approveOrder(order)` | Added | Business requires manager approval as a separate tracked action. |
| — | `rejectOrder(orderId, reason)` | Added | Rejection requires a reason field. Merging into `save()` loses this semantic. |
| — | `cancelOrder(orderId)` | Added | Cancellation is a distinct terminal transition with different authorization rules. |
| — | `recordPayment(orderId, amount)` | Added | Payment recording updates the order's paid amount. This is a business operation, not a generic update. |
| `findById(id)` | `getOrderById(id)` | Renamed | `get*` prefix is standard query convention. |
| `findByCustomerId(customerId)` | `getCustomerOrders(customerId)` | Renamed | Business language: "get customer orders" vs. technical "find by customer id". |
| `findByCompanyId(companyId)` | `searchOrders(criteria)` | Replaced | `findByCompanyId` is CRUD. `searchOrders` accepts structured criteria (status, date range, sales rep, pagination). |

### Removed Methods

| Method | Reason |
|---|---|
| `findByCustomerId(customerId)` | Replaced by `getCustomerOrders()` with same semantics but better naming |
| `findByCompanyId(companyId, limit, offset)` | Replaced by `searchOrders(criteria)` which is query-object based |

### Final Contract Methods

```typescript
placeNewOrder(order: SalesOrder): Promise<void>
submitOrder(order: SalesOrder): Promise<void>
approveOrder(order: SalesOrder): Promise<void>
rejectOrder(orderId: string, reason: string): Promise<void>
cancelOrder(orderId: string): Promise<void>
recordPayment(orderId: string, amount: number): Promise<void>
getOrderById(id: string): Promise<SalesOrder | null>
getCustomerOrders(customerId: string): Promise<SalesOrder[]>
searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]>
```

---

## 3. ICustomerProvider

**Owning Capability:** Customer Management  
**Scope:** Customer lifecycle (registration, suspension, credit changes) + queries

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| `save(customer)` | `registerNewCustomer(customer)` | Renamed | "Register" is the business term for onboarding a customer. "Save" is generic. |
| — | `suspendCustomer(customerId)` | Added | Suspension is a distinct business action with different semantics from generic update. |
| — | `updateCreditLimit(customerId, newLimit)` | Added | Credit limit changes require audit trail and authorization. A generic update() would bypass this. |
| `findById(id)` | `getCustomerById(id)` | Renamed | Standard query convention. |
| `findByCompanyId(companyId)` | `searchCustomers(criteria)` | Replaced | Enables filtered search (by type, status, text query) instead of unfiltered company dump. |

### Removed Methods

| Method | Reason |
|---|---|
| `findByCompanyId(companyId)` | Replaced by `searchCustomers()` with query-object pattern |

### Final Contract Methods

```typescript
registerNewCustomer(customer: Customer): Promise<void>
suspendCustomer(customerId: string): Promise<void>
updateCreditLimit(customerId: string, newLimit: number): Promise<void>
getCustomerById(id: string): Promise<Customer | null>
searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]>
```

---

## 4. IProductCatalogProvider

**Owning Capability:** Product Management  
**Scope:** Product lookup, search, catalog browsing — read-only from application perspective

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| — | `getProductById(id)` | Renamed | Standard query convention. |
| — | `searchProducts(criteria)` | Renamed | Query-object pattern enables structured search (by name, category, stock status). |
| — | `getCompanyProducts(companyId)` | Renamed | Clear business naming. |

### Method Analysis

Product Catalog is read-only in the application context. Products are managed through a separate admin capability. The provider contract reflects this with query-only operations.

### Final Contract Methods

```typescript
getProductById(id: string): Promise<Product | null>
searchProducts(criteria: ProductSearchCriteria): Promise<Product[]>
getCompanyProducts(companyId: string): Promise<Product[]>
```

---

## 5. IInventoryProvider

**Owning Capability:** Inventory & Warehouse Management  
**Scope:** Stock reservations, adjustments, shipment confirmation, queries

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| — | `reserveStock(productId, quantity, orderId)` | Added | Stock reservation is a distinct business operation triggered by order approval. |
| — | `releaseReservation(reservationId)` | Added | Reservation release happens on order cancellation or fulfillment failure. |
| — | `adjustInventory(productId, quantity, reason)` | Added | Manual stock adjustment (count correction, damage, return) is a warehouse operation. |
| — | `confirmShipment(productId, quantity)` | Added | Shipment confirmation decrements inventory after physical dispatch. |
| `save(record)` | (removed) | Removed | Generic save replaced by specific business operations. |
| `findByProductId(productId)` | `getInventoryLevel(productId)` | Renamed | Business language: "get inventory level" not "find by product id". |
| — | `getInventoryByCompany(companyId)` | Added | Required for warehouse dashboards and reporting. |

### Final Contract Methods

```typescript
reserveStock(productId: string, quantity: number, orderId: string): Promise<StockReservation>
releaseReservation(reservationId: string): Promise<void>
adjustInventory(productId: string, quantity: number, reason: string): Promise<InventoryRecord>
confirmShipment(productId: string, quantityShipped: number): Promise<InventoryRecord>
getInventoryLevel(productId: string): Promise<InventoryRecord | null>
getInventoryByCompany(companyId: string): Promise<InventoryRecord[]>
```

---

## 6. IAttendanceProvider

**Owning Capability:** Attendance Tracking  
**Scope:** Workday lifecycle (start/end) + queries

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| `save(workday)` | `startWorkday(workday)` | Renamed | Starting a workday is a discrete business event (check-in). |
| `save(workday)` (end flow) | `endWorkday(workdayId, checkOut, location?)` | Renamed | Ending a workday is a discrete event (check-out) with its own data (time, location). |
| `findById(id)` | `getWorkdayById(id)` | Renamed | Standard query convention. |
| `findByEmployeeAndDate(empId, date)` | `getWorkdayByEmployeeAndDate(empId, date)` | Renamed | Clearer query naming. |
| `findByCompanyAndDateRange(compId, from, to)` | `getWorkdayRange(companyId, from, to)` | Renamed | "Range" is clearer than "date range". |

### Final Contract Methods

```typescript
startWorkday(workday: Workday): Promise<void>
endWorkday(workdayId: string, checkOut: Date, latitude?: number, longitude?: number): Promise<void>
getWorkdayById(id: string): Promise<Workday | null>
getWorkdayByEmployeeAndDate(employeeId: string, date: Date): Promise<Workday | null>
getWorkdayRange(companyId: string, from: Date, to: Date): Promise<Workday[]>
```

---

## 7. ICollectionProvider

**Owning Capability:** Collections & Payment  
**Scope:** Payment collection (cash/check), check lifecycle, queries

### Review Table

| Current Method | Recommended Method | Status | Business Justification |
|---|---|---|---|
| `save(payment)` | `receiveCashPayment(payment)` | Renamed | Cash and check collection are distinct business events with different data requirements. |
| `save(payment)` | `receiveCheckPayment(payment)` | Split | Check payments have additional fields (bank, due date, check number). |
| — | `depositCheck(checkId)` | Added | Check deposit is a separate business step after receipt. |
| — | `clearCheck(checkId)` | Added | Check clearance is the final settlement step. |
| — | `returnCheck(checkId, reason)` | Added | Bounced/returned checks require a reason and initiate reconciliation. |
| `findByOrderId(orderId)` | `getPaymentsByOrder(orderId)` | Renamed | Standard query convention. |
| — | `getPaymentById(id)` | Added | Required for payment detail views. |

### Final Contract Methods

```typescript
receiveCashPayment(payment: Payment): Promise<void>
receiveCheckPayment(payment: CheckPayment): Promise<void>
depositCheck(checkId: string): Promise<void>
clearCheck(checkId: string): Promise<void>
returnCheck(checkId: string, reason: string): Promise<void>
getPaymentsByOrder(orderId: string): Promise<Payment[]>
getPaymentById(id: string): Promise<Payment | null>
```

---

## 8. Cross-Cutting Concerns

### 8.1 Command vs. Query Separation

All provider contracts follow CQRS principle at the method level:
- **Command methods** (write): Named with business verbs (`placeNewOrder`, `suspendCustomer`, `reserveStock`). Return `void` or the created entity.
- **Query methods** (read): Named with `get*` prefix. Return domain entities or arrays.

This separation enables:
- Different error handling for reads vs. writes
- Future read model optimization (caching, denormalized views)
- Clear audit trail: commands can fire domain events

### 8.2 Parameter Style

- Write operations: Accept domain entity objects for complex data, primitive parameters for simple identifiers
- Query operations: Use scalar parameters for simple lookups, query-object parameters for complex search
- Sensitive parameters (session, identity): NOT included in provider methods — handled by Application Layer policies

### 8.3 Return Values

- Write operations: Return `void` or the created/modified entity
- Read operations: Return domain entities, `null` for not-found, arrays for collections
- Error handling: Throw typed exceptions (see 29_PROVIDER_API_GUIDELINES.md)

### 8.4 What Providers Do NOT Do

Providers must NOT:
- Validate business rules (handled by Domain)
- Check authorization (handled by Application Policies)
- Create domain events (handled by Domain)
- Manage transactions/sagas (handled by Application Layer with Saga pattern)

---

## 9. Approval Checklist

| Criterion | Status |
|---|---|
| All CRUD methods replaced with business operations | ✅ |
| No `save()`, `find()`, `update()`, `delete()`, `insert()` methods remain | ✅ |
| Each method maps to a real business event or query | ✅ |
| Command vs. query separation maintained | ✅ |
| Method names use domain language (Ubiquitous Language) | ✅ |
| Return types are domain entities (not DTOs) | ✅ |
| No infrastructure concerns leaked into interfaces | ✅ |
| No Supabase/HTTP/Database types in interfaces | ✅ |
| All owning capabilities have complete coverage | ✅ |
