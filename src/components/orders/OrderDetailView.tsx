import { useState, useEffect, useMemo } from 'react'
import { sendWhatsAppFromDisplay, copyWhatsAppFromDisplay } from '../../lib/whatsapp'
import { buildOrderDisplayData } from '../../types/order-display'
import { creditService } from '../../services/credit'
import { buildTimelineEvents, getCurrentOwner, getLastActionLabel } from './order-detail.utils'
import { renderDeliveryPermitHtml, printInvoice } from './order-printing'
import { OrderHeaderSection } from './OrderHeaderSection'
import { OrderCustomerSection } from './OrderCustomerSection'
import { OrderExecutiveStatusPanel } from './OrderExecutiveStatusPanel'
import { OrderProductsSection } from './OrderProductsSection'
import { OrderDeliverySection } from './OrderDeliverySection'
import { OrderCollectionsSection } from './OrderCollectionsSection'
import { OrderReturnsSection } from './OrderReturnsSection'
import { OrderTimelineSection } from './OrderTimelineSection'
import { OrderActionsSection } from './OrderActionsSection'
import { ModificationHistoryPanel } from './ModificationHistoryPanel'
import type { UnifiedOrder } from '../../types/unified-order'

interface OrderDetailViewProps {
  data: UnifiedOrder
  actions?: React.ReactNode
  onBack?: () => void
}

export function OrderDetailView({ data, actions, onBack }: OrderDetailViewProps) {
  const { order, customer, items, collections, current_delivery, modification_history } = data
  const [overLimit, setOverLimit] = useState<boolean | null>(null)

  const grandTotal = useMemo(() => items.reduce((s, i) => s + Number(i.total_price || 0), 0), [items])
  const timelineEvents = useMemo(() => buildTimelineEvents(data), [data])
  const lastAction = useMemo(() => getLastActionLabel(timelineEvents), [timelineEvents])
  const currentOwner = useMemo(() => getCurrentOwner(data), [data])

  const collectedAmount = useMemo(() => {
    if (!collections?.length) return 0
    return collections
      .filter(c => c.status !== 'pending' && c.amount != null)
      .reduce((s, c) => s + Number(c.amount), 0)
  }, [collections])

  const collectionStatus = !collections?.length ? 'غير محصل'
    : collectedAmount >= grandTotal ? 'محصل بالكامل'
    : 'محصل جزئى'

  const deliveryAttempts = useMemo(() => data.delivery_history?.length || 0, [data.delivery_history])

  useEffect(() => {
    if (order.payment_method === 'credit' && ['submitted', 'reviewing'].includes(order.status)) {
      creditService.checkOrderOverLimit(order.id).then((r) => {
        if (r.over_limit) setOverLimit(true)
      }).catch(() => {})
    }
  }, [order.id, order.payment_method, order.status])

  function handlePdf(compact: boolean) {
    const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
    const html = renderDeliveryPermitHtml(data, logoUrl)
    if (compact) {
      const comp = html.replace(/size: A4/, 'size: A5').replace(/1cm/g, '0.4cm').replace(/10pt/g, '8pt').replace(/18pt/g, '11pt').replace(/20pt/g, '14pt')
      printInvoice(comp)
    } else {
      printInvoice(html)
    }
  }

  function handleWhatsApp() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any })
    sendWhatsAppFromDisplay(display)
  }

  function handleCopyMessage() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any })
    copyWhatsAppFromDisplay(display)
  }

  return (
    <div className="space-y-4 pb-4 max-w-4xl mx-auto">
      <OrderHeaderSection
        order={order}
        currentOwner={currentOwner}
        overLimit={overLimit}
        lastAction={lastAction}
        modificationEntries={modification_history}
        actions={actions}
        onBack={onBack}
      />
      <OrderCustomerSection customer={customer} order={order} />
      <OrderExecutiveStatusPanel
        order={order}
        current_delivery={current_delivery}
        collectionStatus={collectionStatus}
        deliveryAttempts={deliveryAttempts}
        currentOwner={currentOwner}
      />
      <OrderProductsSection items={items} order={order} />
      <OrderDeliverySection
        current_delivery={current_delivery}
        delivery_mode={order.delivery_mode}
        customer={customer}
      />
      {collections && collections.length > 0 && (
        <OrderCollectionsSection collections={collections} grandTotal={grandTotal} />
      )}
      <OrderReturnsSection returns={data.returns} />
      {modification_history && modification_history.length > 0 && (
        <ModificationHistoryPanel
          entries={modification_history}
          revisionNumber={order.revision_number}
          lastRevisedAt={order.last_revised_at}
        />
      )}
      <OrderTimelineSection timelineEvents={timelineEvents} />
      <OrderActionsSection
        onPdf={handlePdf}
        onWhatsApp={handleWhatsApp}
        onCopyMessage={handleCopyMessage}
      />
    </div>
  )
}
