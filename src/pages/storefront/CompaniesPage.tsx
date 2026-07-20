import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCompaniesStore } from '../../store/companies'
import { useCartStore } from '../../store/cart'
import { useAuthStore } from '../../store/auth'
import { StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { StorefrontHero } from '../../components/storefront/StorefrontHero'
import { BusinessShortcuts } from '../../components/storefront/BusinessShortcuts'
import { SearchHighlight } from '../../components/shared/SearchHighlight'
import { buildSearchIndex, searchProducts as smartSearchProducts, type ProductSearchIndex } from '../../utils/smartSearch'
import type { ProductWithPrice, ProductUnitPrice } from '../../types/storefront'

interface CompanyItem {
  id: string
  companyName: string
  logoUrl: string | null
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const customerParam = searchParams.get('customer')
  const setOrderType = useCartStore((s) => s.setOrderType)
  const refreshKey = useCompaniesStore((s) => s.refreshKey)
  const { token: authToken } = useAuthStore()
  const [companies, setCompanies] = useState<CompanyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchProducts, setSearchProducts] = useState<ProductWithPrice[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchFetchRef = useRef(false)

  useEffect(() => {
    const urlOrderType = searchParams.get('order_type')
    if (urlOrderType) setOrderType(urlOrderType)
  }, [searchParams, setOrderType])

  useEffect(() => {
    supabase
      .from('companies')
      .select('id, company_name, logo_url')
      .eq('is_visible', true)
      .order('company_name')
      .then(({ data, error }) => {
        if (!error && data) {
          setCompanies(
            data.map((c: any) => ({
              id: c.id,
              companyName: c.company_name,
              logoUrl: c.logo_url || null,
            }))
          )
        }
        setLoading(false)
      })
  }, [refreshKey])

  const fetchAllProducts = useCallback(async () => {
    if (!authToken || searchFetchRef.current) return
    searchFetchRef.current = true
    setSearchLoading(true)
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: authToken,
      p_company_id: null,
    })
    if (!error && data) {
      const arr = Array.isArray(data) ? data : []
      const mapped: ProductWithPrice[] = arr.map((row: any) => {
        const cartonPrice = Number(row.carton_price) || 0
        const cartonQuantity = Number(row.carton_quantity) || 0
        const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
        const activeUnitTypes = activeUnits.map((u: any) => u.unit_type)
        const hasCarton = activeUnitTypes.includes('carton')
        const rawPrices: ProductUnitPrice[] = []
        if (hasCarton) {
          if (cartonPrice > 0) {
            if (cartonQuantity >= 24) {
              rawPrices.push({ unitType: 'dozen', price: (cartonPrice / cartonQuantity) * 12 })
            }
            rawPrices.push({ unitType: 'carton', price: cartonPrice })
          }
        } else {
          const piecePrice = cartonPrice > 0 && cartonQuantity > 0 ? cartonPrice / cartonQuantity : 0
          if (piecePrice > 0) {
            rawPrices.push({ unitType: 'piece', price: piecePrice })
            rawPrices.push({ unitType: 'dozen', price: piecePrice * 12 })
          }
        }
        const unitPrices = rawPrices.filter(up => activeUnitTypes.includes(up.unitType))
        return {
          id: row.id,
          productName: row.product_name,
          legacyCode: row.legacy_code || '',
          cartonPrice,
          cartonQuantity,
          isActive: row.is_active ?? true,
          isOutOfStock: row.is_out_of_stock === true,
          isVisible: row.is_visible ?? true,
          imageUrl: row.image_url || undefined,
          companyId: row.company_id,
          companyName: row.company_name ?? '',
          unitPrices,
        }
      })
      setSearchProducts(mapped)
    }
    setSearchLoading(false)
  }, [authToken])

  const searchIndices = useMemo(() => {
    return searchProducts.map((p) => ({
      id: p.id,
      product: p,
      index: buildSearchIndex({
        id: p.id,
        legacyCode: p.legacyCode,
        productName: p.productName,
        companyName: p.companyName,
      }),
    }))
  }, [searchProducts])

  const isSearching = globalSearch.trim().length > 0

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const q = globalSearch.trim()
    const indices = searchIndices.filter((si) => si.product.isActive && si.product.isVisible)
    return smartSearchProducts(q, indices, (si) => si.index).map((si) => si.product)
  }, [globalSearch, searchIndices, isSearching])

  useEffect(() => {
    if (isSearching) {
      fetchAllProducts()
    } else {
      searchFetchRef.current = false
    }
  }, [isSearching, fetchAllProducts])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ margin: '-16px -16px 0' }}>
        <StorefrontHero />
      </div>

      <div className="space-y-4" style={{ marginTop: 12 }}>
        <BusinessShortcuts />

        {/* Global Search */}
        <div className="relative">
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="ابحث في جميع المنتجات..."
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
          />
          {isSearching && !searchLoading && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary">
              {searchResults.length} نتيجة
            </span>
          )}
        </div>

        {isSearching ? (
          <>
            {searchLoading && (
              <div className="text-center py-8 text-text-secondary text-sm">
                جاري البحث...
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="text-center py-12 text-text-secondary text-sm">
                لا توجد منتجات متطابقة مع البحث
              </div>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <div className="grid grid-cols-1 gap-2">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => navigate(`/storefront/products?companyId=${product.companyId}${customerParam ? `&customer=${customerParam}` : ''}&highlight=${product.id}`)}
                    className="w-full text-right bg-white border border-border rounded-xl p-3 active:bg-surface transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.productName} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center shrink-0">
                          <span className="text-lg font-bold text-text-secondary">{product.productName.charAt(0)}</span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text truncate">
                          <SearchHighlight text={product.productName} query={globalSearch} />
                        </div>
                        <div className="text-xs text-text-secondary">
                          <SearchHighlight text={product.companyName} query={globalSearch} />
                        </div>
                        {product.legacyCode && (
                          <div className="text-[11px] text-text-secondary ltr">{product.legacyCode}</div>
                        )}
                      </div>
                      <div className="text-xs text-primary font-semibold shrink-0">
                        {product.cartonPrice > 0 ? `${product.cartonPrice.toLocaleString('ar-EG')} ج.` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--theme-accent)' }}>الشركات التجارية</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(15, 43, 91, .45)' }}>اختر الشركة التي تريد التسوق منها</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {companies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => navigate(`/storefront/products?companyId=${company.id}${customerParam ? `&customer=${customerParam}` : ''}`)}
                  style={{
                    background: 'var(--theme-bg-card)',
                    border: '1px solid #E5E7EB',
                    borderRadius: 16,
                    boxShadow: '0 1px 3px rgba(0,0,0,.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '20px 12px 14px',
                    minHeight: 155,
                    cursor: 'pointer',
                    WebkitAppearance: 'none',
                    transition: 'transform 0.15s ease',
                  }}
                  className="active:border-[rgba(var(--theme-accent-rgb),.5)] active:scale-[0.97]"
                >
                  {company.logoUrl ? (
                    <div style={{ width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <img src={company.logoUrl} alt={company.companyName} loading="lazy" decoding="async" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', borderRadius: 8 }} />
                    </div>
                  ) : (
                    <div style={{ width: 90, height: 90, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: 'var(--theme-text-card)', fontWeight: 700, fontSize: 28 }}>{company.companyName.charAt(0)}</span>
                    </div>
                  )}

                  <div style={{ color: 'var(--theme-text-card)', fontWeight: 600, fontSize: 13, textAlign: 'center', lineHeight: 1.4, marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{company.companyName}</div>
                </button>
              ))}
            </div>

            {companies.length === 0 && (
              <div className="text-center py-12" style={{ color: 'rgba(15, 43, 91, .45)', fontSize: 14 }}>
                لا توجد شركات متاحة حالياً
              </div>
            )}
          </>
        )}

        <StorefrontFooter />
      </div>
    </div>
  )
}
