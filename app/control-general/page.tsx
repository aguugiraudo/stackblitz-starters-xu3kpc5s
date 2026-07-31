'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function ControlGeneralPage() {
  const [sectors, setSectors] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [progressRows, setProgressRows] = useState<any[]>([])
  const [modalInfo, setModalInfo] = useState<{ orderId: string; sectorId: string; productName: string; sectorName: string } | null>(null)
  const [pendingComplete, setPendingComplete] = useState<{ id: string; order_number: string } | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchAll() {
    setLoading(true)
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])
    await refreshOrdersAndProgress()
    setLoading(false)
  }

  async function refreshOrdersAndProgress() {
    const { data: ordersData } = await supabase
      .from('orders')
      .select('id, order_number, lot_quantity, client_name, products(name)')
      .in('status', ['pending', 'in_progress'])
      .order('priority_rank', { ascending: true, nullsFirst: false })
    setOrders(ordersData || [])

    const orderIds = (ordersData || []).map((o: any) => o.id)
    if (orderIds.length > 0) {
      const { data: progressData } = await supabase.from('order_progress_detail').select('*').in('order_id', orderIds)
      setProgressRows(progressData || [])
    } else {
      setProgressRows([])
    }
  }

  useEffect(() => { fetchAll() }, [])

  function rowsFor(orderId: string, sectorId: string) {
    return progressRows.filter((r) => r.order_id === orderId && r.sector_id === sectorId)
  }

  function avanceFor(orderId: string) {
    const rows = progressRows.filter((r) => r.order_id === orderId)
    const totalRequired = rows.reduce((sum, r) => sum + r.minutes_required, 0)
    const totalCompleted = rows.reduce((sum, r) => sum + Math.min(r.quantity_completed, r.quantity_required) * r.standard_time_minutes, 0)
    return totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 1000) / 10 : 0
  }

  async function updateQuantity(rowId: string, newValue: number, orderId: string, orderNumber: string) {
    const clamped = Math.max(0, newValue)
    const updatedRows = progressRows.map((r) => (r.id === rowId ? { ...r, quantity_completed: clamped } : r))
    setProgressRows(updatedRows)

    const { error } = await supabase.from('order_component_progress').update({ quantity_completed: clamped }).eq('id', rowId)
    if (error) { alert('Error al guardar: ' + error.message); return }

    const rows = updatedRows.filter((r) => r.order_id === orderId)
    const totalRequired = rows.reduce((sum, r) => sum + r.minutes_required, 0)
    const totalCompleted = rows.reduce((sum, r) => sum + Math.min(r.quantity_completed, r.quantity_required) * r.standard_time_minutes, 0)
    const pct = totalRequired > 0 ? (totalCompleted / totalRequired) * 100 : 0

    // Pregunta siempre que el % ponderado llegue a 100, sin excepción
    if (pct >= 100) {
      setPendingComplete({ id: orderId, order_number: orderNumber })
    }
  }

  async function confirmComplete() {
    if (!pendingComplete) return
    await supabase.from('orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', pendingComplete.id)
    setPendingComplete(null)
    refreshOrdersAndProgress()
  }

  function dismissComplete() {
    setPendingComplete(null)
  }

  function pillClasses(completed: number, required: number) {
    if (required === 0) return 'bg-slate-100 text-slate-300'
    if (completed > required) return 'bg-rose-200 text-rose-800'
    if (completed === required && completed > 0) return 'bg-emerald-200 text-emerald-800'
    if (completed > 0) return 'bg-amber-200 text-amber-800'
    return 'bg-slate-100 text-slate-400'
  }

  if (loading) return <main className="p-8 text-slate-500">Cargando...</main>

  const modalRows = modalInfo ? rowsFor(modalInfo.orderId, modalInfo.sectorId) : []

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Avance de Producción</h1>
      <p className="text-sm text-slate-500 mb-4">Estado actual de las órdenes en curso, por sector.</p>

      <div className="flex gap-4 mb-5 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-slate-100 border border-slate-300"></i> Sin iniciar</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-amber-200"></i> En curso</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-emerald-200"></i> Finalizado</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-rose-200"></i> Cantidad excedida</span>
      </div>

      {orders.length === 0 ? (
        <p className="text-slate-500">No hay órdenes activas todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-left">
                <th className="p-3 font-medium">N° OP</th>
                <th className="p-3 font-medium min-w-[180px]">Producto</th>
                <th className="p-3 font-medium text-center">Cantidad</th>
                {sectors.map((s) => (
                  <th key={s.id} className="p-3 font-medium text-center w-[110px]">{s.name}</th>
                ))}
                <th className="p-3 font-medium text-center">% Avance</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr key={order.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="p-3 font-medium text-slate-700">#{order.order_number}</td>
                  <td className="p-3 text-slate-700">{order.products?.name}</td>
                  <td className="p-3 text-center text-slate-600">{order.lot_quantity}</td>
                  {sectors.map((sector) => {
                    const rows = rowsFor(order.id, sector.id)
                    if (rows.length === 0) {
                      return <td key={sector.id} className="p-3 text-center text-slate-300">—</td>
                    }
                    const totalRequired = rows.reduce((sum, r) => sum + r.quantity_required, 0)
                    const totalCompleted = rows.reduce((sum, r) => sum + r.quantity_completed, 0)
                    const hasComponents = rows.length > 1 || rows[0].target_type === 'component'
                    const pill = pillClasses(totalCompleted, totalRequired)

                    return (
                      <td key={sector.id} className="p-2 text-center">
                        {!hasComponents ? (
                          <div className={`inline-flex items-center justify-center rounded-full px-2 py-1 ${pill}`}>
                            <input
                              type="number"
                              value={rows[0].quantity_completed}
                              min={0}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => updateQuantity(rows[0].id, parseInt(e.target.value || '0', 10), order.id, order.order_number)}
                              className="w-10 text-center bg-transparent outline-none font-medium"
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => setModalInfo({ orderId: order.id, sectorId: sector.id, productName: order.products?.name, sectorName: sector.name })}
                            className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 font-semibold ${pill}`}
                          >
                            {totalCompleted}/{totalRequired}
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className="p-3 text-center font-semibold text-slate-800">{avanceFor(order.id)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setModalInfo(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <h3 className="font-semibold text-slate-800">{modalInfo.sectorName}</h3>
                <p className="text-sm text-slate-500">{modalInfo.productName}</p>
              </div>
              <button onClick={() => setModalInfo(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
              {modalRows.map((r) => {
                const pill = pillClasses(r.quantity_completed, r.quantity_required)
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="text-sm text-slate-700">{r.component_name}</span>
                    <div className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${pill}`}>
                      <input
                        type="number"
                        value={r.quantity_completed}
                        min={0}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateQuantity(r.id, parseInt(e.target.value || '0', 10), modalInfo.orderId, '')}
                        className="w-10 text-center bg-transparent outline-none font-medium"
                      />
                      <span className="text-xs opacity-70">/ {r.quantity_required}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <button onClick={() => setModalInfo(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {pendingComplete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <h3 className="font-semibold text-slate-800 text-lg mb-2">¿OP terminada?</h3>
            <p className="text-sm text-slate-500 mb-5">
              La orden <strong>#{pendingComplete.order_number}</strong> llegó al 100% de avance ponderado.
              ¿La marcamos como completada y la pasamos al Historial?
            </p>
            <div className="flex gap-2">
              <button onClick={dismissComplete} className="flex-1 border border-slate-300 rounded-md py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Todavía no
              </button>
              <button onClick={confirmComplete} className="flex-1 bg-emerald-600 text-white rounded-md py-2 text-sm font-medium hover:bg-emerald-700">
                Sí, completar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}