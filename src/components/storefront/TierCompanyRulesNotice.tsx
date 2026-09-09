import type { CompanyRuleResult, TierConfig } from '../../types/storefront'
import { formatSmartMoney } from '../../utils/numbers'

interface TierCompanyRulesNoticeProps {
  companyRule: CompanyRuleResult
  tier: TierConfig
}

export function TierCompanyRulesNotice({ companyRule, tier }: TierCompanyRulesNoticeProps) {
  if (companyRule.meetsMinimumCompanies && companyRule.meetsCompanyCaps) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-success text-white flex items-center justify-center shrink-0 text-xs font-bold">✓</span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-success">شروط تنويع الشركات محققة</div>
          <div className="text-[11px] text-text-secondary">
            تم الشراء من {companyRule.distinctCompanyCount} شركة مختلفة
            {companyRule.maxCompanyValue != null && (
              <> — لا تتجاوز أي شركة الحد الأقصى {formatSmartMoney(companyRule.maxCompanyValue)} ج.م ({companyRule.maxCompanyPurchasePercent}% من قيمة الشريحة)</>
            )}
          </div>
        </div>
      </div>
    )
  }

  const violations = companyRule.companies.filter((c) => c.exceedsCap)
  const missing = companyRule.meetsMinimumCompanies ? 0 : (companyRule.minimumCompanyCount ?? 0) - companyRule.distinctCompanyCount

  return (
    <div className="rounded-xl border border-warning/40 bg-amber-50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-warning text-white flex items-center justify-center text-[11px] font-bold shrink-0">!</span>
        <h4 className="text-sm font-bold text-amber-800">شروط تنويع الشركات غير محققة</h4>
      </div>

      <div className="space-y-2 text-[11px] text-amber-700 leading-relaxed">
        {!companyRule.meetsMinimumCompanies && companyRule.minimumCompanyCount != null && (
          <>
            <div>
              يجب أن يتنوع الطلب بين <b>{companyRule.minimumCompanyCount}</b> شركة على الأقل.
              أنت حاليًا تشتري من <b>{companyRule.distinctCompanyCount}</b> شركة فقط.
            </div>
            {missing > 0 && (
              <div>أضف منتجات من <b>{missing}</b> شركة أخرى للوصول إلى الحد الأدنى المطلوب.</div>
            )}
          </>
        )}

        {violations.length > 0 && violations.map((v) => (
          <div key={v.companyId}>
            شركة <b>{v.companyName}</b> تجاوزت الحد الأقصى للشريحة: تمثل <b>{v.percent}%</b> من قيمة الشريحة، بينما الحد الأقصى المسموح هو <b>{v.maxPercent}%</b> ({formatSmartMoney(v.maxCompanyValue ?? 0)} ج.م لكل شركة).
            قلّل مشتريات هذه الشركة أو أضف مشتريات من شركات أخرى.
          </div>
        ))}
      </div>

      {companyRule.companies.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          {companyRule.companies.map((c) => (
            <div key={c.companyId} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${c.exceedsCap ? 'bg-amber-200/50 ring-1 ring-amber-300' : 'bg-white/60'}`}>
              <span className="font-semibold text-amber-900 truncate">{c.companyName}</span>
              <span className={`font-bold shrink-0 ml-2 ${c.exceedsCap ? 'text-danger' : 'text-amber-800'}`}>
                {c.percent}%
                {c.maxPercent != null && <span className="font-normal text-amber-600"> / {c.maxPercent}%</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}