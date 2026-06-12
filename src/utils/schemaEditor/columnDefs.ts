export type InputType = 'text' | 'number' | 'boolean' | 'textarea' | 'datetime-local' | 'color' | 'select' | 'url'

export interface ColumnDef {
  key: string
  label: string
  inputType: InputType
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  maxLength?: number
}

function tsOpts(label: string): { value: string; label: string }[] {
  return [{ value: 'true', label }, { value: 'false', label: '' }]
}

/* ───────── TIERS ───────── */
export const TIER_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'name', label: 'اسم الشريحة', inputType: 'text', required: true, maxLength: 100 },
  { key: 'description', label: 'الوصف', inputType: 'textarea' },
  { key: 'discount_percent', label: 'نسبة الخصم (%)', inputType: 'number', step: 0.01, min: 0, max: 100 },
  { key: 'minimum_order_amount', label: 'الحد الأدنى للطلب', inputType: 'number', step: 0.01, min: 0 },
  { key: 'sort_order', label: 'ترتيب العرض', inputType: 'number', min: 0 },
  { key: 'color', label: 'اللون', inputType: 'color' },
  { key: 'icon_url', label: 'رابط الأيقونة', inputType: 'url' },
  { key: 'is_visible', label: 'ظاهر للعملاء', inputType: 'boolean' },
  { key: 'is_active', label: 'نشط', inputType: 'boolean' },
  { key: 'starts_at', label: 'تاريخ البدء', inputType: 'datetime-local' },
  { key: 'ends_at', label: 'تاريخ الانتهاء', inputType: 'datetime-local' },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── DAILY DEALS ───────── */
export const DAILY_DEAL_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'title', label: 'العنوان', inputType: 'text', required: true, maxLength: 255 },
  { key: 'description', label: 'الوصف', inputType: 'textarea' },
  { key: 'image_url', label: 'رابط الصورة', inputType: 'url' },
  { key: 'fixed_price', label: 'السعر الثابت', inputType: 'number', required: true, step: 0.01, min: 0 },
  { key: 'original_quantity', label: 'الكمية الأصلية', inputType: 'number', min: 0 },
  { key: 'available_quantity', label: 'الكمية المتاحة', inputType: 'number', readonly: true, min: 0 },
  { key: 'starts_at', label: 'تاريخ البدء', inputType: 'datetime-local' },
  { key: 'ends_at', label: 'تاريخ الانتهاء', inputType: 'datetime-local' },
  { key: 'status', label: 'الحالة', inputType: 'select', readonly: true,
    options: [
      { value: 'draft', label: 'مسودة' },
      { value: 'scheduled', label: 'مجدول' },
      { value: 'active', label: 'نشط' },
      { value: 'sold_out', label: 'نفد' },
      { value: 'expired', label: 'منتهي' },
      { value: 'cancelled', label: 'ملغي' },
    ] },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── AUCTIONS ───────── */
export const AUCTION_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'code', label: 'الكود', inputType: 'text', required: true, maxLength: 30 },
  { key: 'title', label: 'العنوان', inputType: 'text', required: true, maxLength: 255 },
  { key: 'description', label: 'الوصف', inputType: 'textarea' },
  { key: 'image_url', label: 'رابط الصورة', inputType: 'url' },
  { key: 'starting_price', label: 'السعر الابتدائي', inputType: 'number', step: 0.01, min: 0 },
  { key: 'current_price', label: 'السعر الحالي', inputType: 'number', step: 0.01, min: 0, readonly: true },
  { key: 'bid_increment', label: 'زيادة المزايدة', inputType: 'number', step: 0.01, min: 0 },
  { key: 'deposit_amount', label: 'مبلغ التأمين', inputType: 'number', step: 0.01, min: 0 },
  { key: 'start_time', label: 'وقت البدء', inputType: 'datetime-local', required: true },
  { key: 'end_time', label: 'وقت الانتهاء', inputType: 'datetime-local', required: true },
  { key: 'status', label: 'الحالة', inputType: 'select', readonly: true,
    options: [
      { value: 'pending', label: 'قيد الانتظار' },
      { value: 'live', label: 'مباشر' },
      { value: 'ended', label: 'منتهي' },
      { value: 'awarded', label: 'تم الترسية' },
      { value: 'cancelled', label: 'ملغي' },
    ] },
  { key: 'winner_amount', label: 'قيمة الفائز', inputType: 'number', readonly: true, step: 0.01 },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── CREDIT PROGRAMS ───────── */
export const CREDIT_PROGRAM_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'name', label: 'اسم البرنامج', inputType: 'text', required: true, maxLength: 100 },
  { key: 'credit_limit', label: 'الحد الائتماني', inputType: 'number', required: true, step: 0.01, min: 0 },
  { key: 'credit_days', label: 'عدد الأيام', inputType: 'number', required: true, min: 1 },
  { key: 'terms', label: 'الشروط', inputType: 'textarea' },
  { key: 'is_active', label: 'نشط', inputType: 'boolean' },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── TIER COMPANY EXCEPTIONS ───────── */
export const TIER_COMPANY_EXCEPTION_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'tier_id', label: 'الشريحة', inputType: 'text', readonly: true },
  { key: 'company_id', label: 'الشركة', inputType: 'text', readonly: true },
  { key: 'discount_percent', label: 'نسبة الخصم', inputType: 'number', required: true, step: 0.01, min: 0, max: 100 },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── TIER PRODUCT EXCEPTIONS ───────── */
export const TIER_PRODUCT_EXCEPTION_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'tier_id', label: 'الشريحة', inputType: 'text', readonly: true },
  { key: 'product_id', label: 'المنتج', inputType: 'text', readonly: true },
  { key: 'discount_percent', label: 'نسبة الخصم', inputType: 'number', required: true, step: 0.01, min: 0, max: 100 },
  { key: 'applies_to_all_tiers', label: 'لجميع الشرائح', inputType: 'boolean' },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
  { key: 'updated_at', label: 'آخر تحديث', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── DAILY DEAL ITEMS ───────── */
export const DAILY_DEAL_ITEM_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'product_id', label: 'المنتج', inputType: 'text', required: true },
  { key: 'quantity', label: 'الكمية', inputType: 'number', required: true, min: 1 },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
]

/* ───────── AUCTION ITEMS ───────── */
export const AUCTION_ITEM_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'المُعرّف', inputType: 'text', readonly: true },
  { key: 'product_id', label: 'المنتج', inputType: 'text', required: true },
  { key: 'quantity', label: 'الكمية', inputType: 'number', required: true, min: 1 },
  { key: 'created_at', label: 'تاريخ الإنشاء', inputType: 'text', readonly: true, hidden: true },
]
