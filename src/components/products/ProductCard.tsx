import { Edit3, Eye, Power, Trash2, Star, Package, Building2, Calendar } from 'lucide-react'
import { formatCurrencyShort } from '../../utils/format'

interface ProductCardProps {
  product: any
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
  onViewDetails: () => void
}

const UNIT_LABELS: Record<string, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

export function ProductCard({ product, onEdit, onToggleActive, onDelete, onViewDetails }: ProductCardProps) {
  const isOutOfStock = product.is_out_of_stock === true && product.is_active !== false
  const units = (product.product_units || []).filter((u: any) => u.is_active !== false)
  const unitNames = units.map((u: any) => UNIT_LABELS[u.unit_type] || u.unit_type).join(' - ')

  const piecePrice = product.carton_price > 0 && product.carton_quantity > 0
    ? Math.round(product.carton_price / product.carton_quantity * 100) / 100
    : 0

  const createdDate = product.created_at
    ? new Date(product.created_at).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  return (
    <div className={`bg-white rounded-xl border border-border overflow-hidden transition-all hover:shadow-sm ${!product.is_active ? 'opacity-70' : ''}`}>
      {/* Image */}
      <div className="relative h-36 bg-surface overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.product_name}
            className="w-full h-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-text-secondary/30" />
          </div>
        )}
        {isOutOfStock ? (
          <div className="absolute top-2 right-2 bg-warning/90 text-white text-[9px] px-2 py-0.5 rounded-full font-semibold">
            نفذت الكمية
          </div>
        ) : !product.is_active ? (
          <div className="absolute top-2 right-2 bg-danger/90 text-white text-[9px] px-2 py-0.5 rounded-full font-semibold">
            موقوف
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Name + code */}
        <div>
          <div className="flex items-start justify-between gap-1">
            <h3 className="text-sm font-bold text-text leading-tight line-clamp-2">{product.product_name}</h3>
          </div>
          <p className="text-[10px] text-text-secondary font-mono mt-0.5" dir="ltr">{product.legacy_code || '—'}</p>
        </div>

        {/* Company */}
        <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <Building2 className="w-3 h-3 shrink-0" />
          <span className="truncate">{product.company_name || '—'}</span>
        </div>

        {/* Units */}
        {unitNames && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <Star className="w-3 h-3 shrink-0" />
            <span>{unitNames}</span>
          </div>
        )}

        {/* Price */}
        <div className="flex items-center gap-2 flex-wrap">
          {product.carton_price > 0 ? (
            <>
              <span className="text-xs font-bold text-primary">{formatCurrencyShort(product.carton_price)} <span className="text-[9px] font-normal text-text-secondary">كرتونة</span></span>
              {piecePrice > 0 && (
                <span className="text-[10px] text-text-secondary">| {formatCurrencyShort(piecePrice)} <span className="text-[9px]">قطعة</span></span>
              )}
            </>
          ) : (
            <span className="text-[10px] text-danger">السعر غير محدد</span>
          )}
        </div>

        {/* Date */}
        {createdDate && (
          <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{createdDate}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex border-t border-border divide-x divide-border">
        <button onClick={onViewDetails} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] text-text-secondary hover:bg-surface transition-colors">
          <Eye className="w-3.5 h-3.5" />
          عرض
        </button>
        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] text-primary hover:bg-surface transition-colors">
          <Edit3 className="w-3.5 h-3.5" />
          تعديل
        </button>
        <button onClick={onToggleActive} className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] transition-colors hover:bg-surface ${isOutOfStock ? 'text-success' : product.is_active ? 'text-warning' : 'text-success'}`}>
          <Power className="w-3.5 h-3.5" />
          {isOutOfStock ? 'تفعيل' : product.is_active ? 'إيقاف' : 'تفعيل'}
        </button>
        <button onClick={onDelete} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] text-danger hover:bg-surface transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
          حذف
        </button>
      </div>
    </div>
  )
}
