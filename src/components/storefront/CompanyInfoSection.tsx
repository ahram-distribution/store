import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { Phone, MessageCircle, Headphones, X } from 'lucide-react'

interface CompanyData {
  company_name: string
  company_banner_url: string
  facebook_url: string
  sales_phone_1: string
  sales_phone_2: string
  sales_whatsapp_1: string
  sales_whatsapp_2: string
  technical_support_phone: string
}

function useCompanyProfile() {
  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    supabase.rpc('get_company_profile', { p_token: token }).then(({ data: res }) => {
      if (res?.success && res.data) {
        setData({
          company_name: (res.data as any).company_name || '',
          company_banner_url: (res.data as any).company_banner_url || '',
          facebook_url: (res.data as any).facebook_url || '',
          sales_phone_1: (res.data as any).sales_phone_1 || '',
          sales_phone_2: (res.data as any).sales_phone_2 || '',
          sales_whatsapp_1: (res.data as any).sales_whatsapp_1 || '',
          sales_whatsapp_2: (res.data as any).sales_whatsapp_2 || '',
          technical_support_phone: (res.data as any).technical_support_phone || '',
        })
      }
      setLoading(false)
    })
  }, [token])

  return { data, loading }
}

export function StorefrontBanner() {
  const { data, loading } = useCompanyProfile()

  if (loading || !data?.company_banner_url) return null

  return (
    <img
      src={data.company_banner_url}
      alt={data.company_name || 'الشركة'}
      className="w-full h-[200px] object-cover rounded-2xl"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

export function StorefrontFooter() {
  const { data, loading } = useCompanyProfile()
  const [phoneSheet, setPhoneSheet] = useState(false)
  const [whatsappSheet, setWhatsappSheet] = useState(false)

  if (loading || !data) return null

  return (
    <>
      <div className="flex items-center justify-center gap-6 py-4">
        {(data.sales_phone_1 || data.sales_phone_2) && (
          <button onClick={() => setPhoneSheet(true)} className="w-10 h-10 bg-[#F8FAFC] border border-[#E5E7EB] rounded-full flex items-center justify-center active:bg-gray-100 transition-colors">
            <Phone className="w-5 h-5 text-brand" />
          </button>
        )}
        {(data.sales_whatsapp_1 || data.sales_whatsapp_2) && (
          <button onClick={() => setWhatsappSheet(true)} className="w-10 h-10 bg-[#F8FAFC] border border-[#E5E7EB] rounded-full flex items-center justify-center active:bg-gray-100 transition-colors">
            <MessageCircle className="w-5 h-5 text-green-500" />
          </button>
        )}
        {data.facebook_url && (
          <a href={data.facebook_url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 bg-[#F8FAFC] border border-[#E5E7EB] rounded-full flex items-center justify-center active:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </a>
        )}
        {data.technical_support_phone && (
          <a href={`tel:${data.technical_support_phone}`} className="w-10 h-10 bg-[#F8FAFC] border border-[#E5E7EB] rounded-full flex items-center justify-center active:bg-gray-100 transition-colors">
            <Headphones className="w-5 h-5 text-brand" />
          </a>
        )}
      </div>

      {phoneSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setPhoneSheet(false)}>
          <div className="bg-white rounded-t-2xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[#111827]">اتصل بالمبيعات</h3>
              <button onClick={() => setPhoneSheet(false)} className="text-muted hover:text-[#111827] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {data.sales_phone_1 && (
                <a href={`tel:${data.sales_phone_1}`} className="block w-full text-center py-3 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-brand font-medium text-sm active:bg-gray-100 transition-colors ltr">
                  {data.sales_phone_1}
                </a>
              )}
              {data.sales_phone_2 && (
                <a href={`tel:${data.sales_phone_2}`} className="block w-full text-center py-3 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-brand font-medium text-sm active:bg-gray-100 transition-colors ltr">
                  {data.sales_phone_2}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {whatsappSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setWhatsappSheet(false)}>
          <div className="bg-white rounded-t-2xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[#111827]">واتساب المبيعات</h3>
              <button onClick={() => setWhatsappSheet(false)} className="text-muted hover:text-[#111827] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {data.sales_whatsapp_1 && (
                <a href={`https://wa.me/${data.sales_whatsapp_1.replace(/^0+/, '20')}`} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-green-600 font-medium text-sm active:bg-gray-100 transition-colors ltr">
                  {data.sales_whatsapp_1}
                </a>
              )}
              {data.sales_whatsapp_2 && (
                <a href={`https://wa.me/${data.sales_whatsapp_2.replace(/^0+/, '20')}`} target="_blank" rel="noopener noreferrer" className="block w-full text-center py-3 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-green-600 font-medium text-sm active:bg-gray-100 transition-colors ltr">
                  {data.sales_whatsapp_2}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
