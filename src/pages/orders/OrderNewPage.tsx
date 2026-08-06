import { Navigate, useSearchParams } from 'react-router-dom'

export function OrderNewPage() {
  const [searchParams] = useSearchParams()
  const customerParam = searchParams.get('customer')
  const visitParam = searchParams.get('visit')

  const params = new URLSearchParams()
  if (customerParam) params.set('customer', customerParam)
  if (visitParam) params.set('visit', visitParam)
  const qs = params.toString()

  return <Navigate to={'/storefront' + (qs ? '?' + qs : '')} replace />
}
