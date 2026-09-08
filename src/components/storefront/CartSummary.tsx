import type { CartTotals, TierConfig, PaymentMethodOption, ShippingMethodOption } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'

interface CartSummaryProps {
  totals: CartTotals
  selectedTier: TierConfig | null
  selectedPaymentMethod: PaymentMethodOption | null
  selectedShippingMethod: ShippingMethodOption | null
  bonusMode?: boolean
}

export function CartSummary({ totals, selectedTier, selectedPaymentMethod, selectedShippingMethod, bonusMode }: CartSummaryProps) {
  const hasAnyDiscount = totals.totalDiscount > 0

  return (
    <div className="bg-white rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">ملخص الطلب</h3>
        {!bonusMode && hasAnyDiscount && (
          <span className="text-[11px] text-success font-semibold" dir="rtl">
            إجمالي الخصم {totals.totalDiscountPercent}%
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm">
        {bonusMode ? (
          <>
            <div className="flex justify-between text-text-secondary">
              <span>المنتجات الرئيسية</span>
              <span>{formatCurrencyShort(totals.mainBaseTotal ?? 0)}</span>
            </div>

            {totals.dealTotal > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>العروض</span>
                <span>{formatCurrencyShort(totals.dealTotal)}</span>
              </div>
            )}

            <div className="flex justify-between text-text-secondary">
              <span>الشريحة</span>
              <span>{selectedTier?.name ?? '—'}</span>
            </div>

            <div className="flex justify-between text-text-secondary">
              <span>الدفع</span>
              <span>{selectedPaymentMethod?.name ?? '—'}</span>
            </div>

            <div className="flex justify-between text-text-secondary">
              <span>الشحن</span>
              <span>{selectedShippingMethod?.name ?? '—'}</span>
            </div>

            <hr className="border-border" />

            <div className="flex justify-between">
              <span>إجمالي رصيد البونص</span>
              <span>{formatCurrencyShort(totals.bonusCredit ?? 0)}</span>
            </div>

            {(totals.bonusProductsTotal ?? 0) > 0 && (
              <div className="flex justify-between text-text-secondary">
                <span>منتجات البونص</span>
                <span>{formatCurrencyShort(totals.bonusProductsTotal ?? 0)}</span>
              </div>
            )}

            <div className="flex justify-between text-success">
              <span>المغطى من الرصيد</span>
              <span>{formatCurrencyShort(totals.bonusApplied ?? 0)}</span>
            </div>

            {(totals.bonusUnused ?? 0) > 0 && (
              <div className="flex justify-between text-text-secondary">
                <span>غير المستخدم</span>
                <span>{formatCurrencyShort(totals.bonusUnused ?? 0)}</span>
              </div>
            )}

            {(totals.bonusOverflow ?? 0) > 0 && (
              <div className="flex justify-between text-danger">
                <span>الزيادة عن الرصيد</span>
                <span>{formatCurrencyShort(totals.bonusOverflow ?? 0)}</span>
              </div>
            )}

            <hr className="border-border" />

            <div className="flex justify-between text-text font-semibold text-base">
              <span>الإجمالي المستحق</span>
              <span>{formatCurrencyShort(totals.netTotal)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-text-secondary">
              <span>إجمالي المنتجات (الأساسي)</span>
              <span>{formatCurrencyShort(totals.productBaseSubtotal)}</span>
            </div>

            {totals.dealTotal > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>العروض</span>
                <span>{formatCurrencyShort(totals.dealTotal)}</span>
              </div>
            )}

            {totals.tierDiscount > 0 && (
              <div className="flex justify-between text-success">
                <span>خصم الشريحة ({selectedTier?.name ?? 'شريحة'})</span>
                <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
              </div>
            )}

            {totals.paymentDiscount > 0 && (
              <div className="flex justify-between text-success">
                <span>خصم طريقة الدفع ({selectedPaymentMethod?.name ?? ''})</span>
                <span>-{formatCurrencyShort(totals.paymentDiscount)}</span>
              </div>
            )}

            {totals.shippingDiscount > 0 && (
              <div className="flex justify-between text-success">
                <span>خصم طريقة الشحن ({selectedShippingMethod?.name ?? ''})</span>
                <span>-{formatCurrencyShort(totals.shippingDiscount)}</span>
              </div>
            )}

            <hr className="border-border" />

            <div className="flex justify-between text-text font-semibold text-base">
              <span>الإجمالي النهائي</span>
              <span>{formatCurrencyShort(totals.netTotal)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}