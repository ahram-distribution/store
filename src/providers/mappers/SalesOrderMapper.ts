import type { SalesOrder, OrderLine } from '../../domain/models/salesOrder'
import { createMoney, ZeroMoney } from '../../domain/value-objects/Money'
import { OrderStatus } from '../../domain/enums/OrderStatus'
import type { UnitType } from '../../domain/enums/UnitType'

const LEGACY_STATUS_MAP: Record<string, OrderStatus> = {
  draft: OrderStatus.Draft,
  submitted: OrderStatus.Submitted,
  reviewing: OrderStatus.Reviewing,
  returned_for_revision: OrderStatus.Reviewing,
  approved: OrderStatus.Approved,
  preparing: OrderStatus.Preparing,
  prepared: OrderStatus.Preparing,
  ready_for_dispatch: OrderStatus.Preparing,
  sent_to_delivery: OrderStatus.Dispatched,
  dispatched: OrderStatus.Dispatched,
  deferred: OrderStatus.Draft,
  cancelled: OrderStatus.Cancelled,
  delivered: OrderStatus.Delivered,
}

export class SalesOrderMapper {
  static mapStatus(legacy: string): OrderStatus {
    return LEGACY_STATUS_MAP[legacy] ?? OrderStatus.Draft
  }

  static fromUnifiedOrder(data: any): SalesOrder {
    const header = data.order ?? data
    const mappedItems: OrderLine[] = (data.items ?? []).map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      unitType: item.unit_type as UnitType,
      unitPrice: createMoney(Number(item.unit_price) || 0),
      quantity: Number(item.unit_quantity) || 0,
      total: createMoney(Number(item.total_price) || 0),
    }))
    const subtotal = Number(header.subtotal) || 0
    const discount = Number(header.discount_amount) || 0
    const total = Number(header.total_amount) || 0
    return {
      id: header.id,
      orderNumber: header.order_number ?? '',
      companyId: header.company_id ?? '',
      customerId: header.customer_id,
      customerName: header.snapshot_customer_name ?? header.customer_name ?? '',
      ownerName: header.owner_name ?? header.created_by_name ?? '',
      salesRepId: header.owner_id ?? header.created_by ?? '',
      status: SalesOrderMapper.mapStatus(header.status),
      lines: mappedItems,
      subtotal: createMoney(subtotal),
      discount: createMoney(discount),
      grandTotal: createMoney(total),
      paidAmount: ZeroMoney,
      balanceDue: createMoney(total),
      notes: header.notes ?? null,
      createdAt: new Date(header.created_at),
      updatedAt: new Date(header.updated_at ?? header.created_at),
    }
  }

  static fromUnifiedOrderItem(row: any): SalesOrder {
    return {
      id: row.id,
      orderNumber: row.order_number ?? '',
      companyId: row.company_id ?? '',
      customerId: row.customer_id,
      customerName: row.customer_name ?? row.snapshot_customer_name ?? '',
      ownerName: row.owner_name ?? row.created_by_name ?? '',
      salesRepId: row.owner_id ?? row.created_by ?? '',
      status: SalesOrderMapper.mapStatus(row.status),
      lines: [],
      subtotal: createMoney(Number(row.subtotal) || 0),
      discount: createMoney(Number(row.discount_amount) || 0),
      grandTotal: createMoney(Number(row.total_amount) || 0),
      paidAmount: ZeroMoney,
      balanceDue: createMoney(Number(row.total_amount) || 0),
      notes: row.notes ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at ?? row.created_at),
    }
  }
}
