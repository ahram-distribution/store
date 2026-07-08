import type { InventoryRecord } from '../../domain/models/inventory'

export class InventoryMapper {
  static fromProductRow(row: any): InventoryRecord {
    const inv = row.inventory ?? {}
    return {
      id: inv.id ?? `${row.id}-inv`,
      productId: row.id,
      companyId: row.company_id ?? '',
      quantity: Number(inv.quantity ?? 0),
      lastCountedAt: inv.last_counted_at ? new Date(inv.last_counted_at) : null,
      notes: inv.notes ?? null,
      updatedAt: new Date(inv.updated_at ?? row.updated_at ?? new Date()),
    }
  }
}
