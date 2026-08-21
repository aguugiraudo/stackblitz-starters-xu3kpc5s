'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../components/AuthGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function ControlGeneralPage() {
  const { role } = useAuth()
  const canEdit = role === 'perfil_1' || role === 'perfil_2'

  const [sectors, setSectors] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [progressRows, setProgressRows] = useState<any[]>([])
  const [operators, setOperators] = useState<any[]>([])
  const [modalInfo, setModalInfo] = useState<{ orderId: string; sectorId: string; productName: string; sectorName: string } | null>(null)
  const [pendingComplete, setPendingComplete] = useState<{ id: string; order_number: string } | null>(null)
  const [dismissedCompleteIds, setDismissedCompleteIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // Confirmación + trazabilidad de ediciones manuales
  const [pendingManualEdit, setPendingManualEdit] = useState<{
    rowId: string; orderId: string; orderNumber: string; componentName?: string; oldValue: number; newValue: number
  } | null>(null)
  const [editOperatorId, setEditOperatorId] = useState('')
  const [editNote, setEditNote] = useState('')
  const [resetCounter, setResetCounter] = useState(0)

  async function fetchAll() {
    setLoading(true)
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])
    const { data: opsData } = await supabase.from('operators').select('*').eq('active', true).order('full_name')
    setOperators(opsData || [])
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

  // Revisa TODAS las OPs cada vez que se cargan datos frescos (sea por editar acá, o porque
  // Turnos y Operarios cerró producción real en otro lado) y ofrece completar la primera que
  // llegue al 100% y no haya sido descartada ("Todavía no") en esta sesión.
  useEffect(() => {
    if (!canEdit || loading || pendingComplete) return
    const ready = orders.find((o) => avanceFor(o.id) >= 100 && !dismissedCompleteIds.has(o.id))
    if (ready) {
      setPendingComplete({ id: ready.id, order_number: ready.order_number })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, progressRows, loading])

  async function updateQuantity(rowId: string, newValue: number, orderId: string) {
    const clamped = Math.max(0, newValue)
    const updatedRows = progressRows.map((r) => (r.id === rowId ? { ...r, quantity_completed: clamped } : r))
    setProgressRows(updatedRows)

    const { error } = await supabase.from('order_component_progress').update({ quantity_completed: clamped }).eq('id', rowId)
    if (error) { alert('Error al guardar: ' + error.message); return }
  }

  // Se dispara al salir del input (onBlur). No guarda nada todavía: abre el cartel de confirmación.
  function requestManualEdit(row: any, newValue: number, orderId: string, componentName?: string) {
    if (newValue === row.quantity_completed) return
    setPendingManualEdit({ rowId: row.id, orderId, orderNumber: '', componentName, oldValue: row.quantity_completed, newValue })
    setEditOperatorId('')
    setEditNote('')
  }

  function cancelManualEdit() {
    setPendingManualEdit(null)
    setResetCounter((c) => c + 1) // fuerza que los inputs vuelvan a mostrar el valor real guardado
  }

  async function confirmManualEdit() {
    if (!pendingManualEdit) return
    if (!editOperatorId) { alert('Elegí qué operario realizó este avance.'); return }
    if (!editNote.trim()) { alert('Escribí una observación explicando este ajuste manual.'); return }

    await updateQuantity(pendingManualEdit.rowId, pendingManualEdit.newValue, pendingManualEdit.orderId)

    const { error } = await supabase.from('manual_progress_edits').insert({
      order_id: pendingManualEdit.orderId,
      progress_row_id: pendingManualEdit.rowId,
      previous_value: pendingManualEdit.oldValue,
      new_value: pendingManualEdit.newValue,
      operator_id: editOperatorId,
      note: editNote.trim(),
    })
    if (error) { alert('El avance se guardó, pero no se pudo registrar la auditoría: ' + error.message) }

    setPendingManualEdit(null)
    setResetCounter((c) => c + 1)
    refreshOrdersAndProgress()
  }

  async function confirmComplete() {
    if (!pendingComplete) return
    await supabase.from('orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', pendingComplete.id)
    setPendingComplete(null)
    refreshOrdersAndProgress()
  }

  function dismissComplete() {
    if (pendingComplete) setDismissedCompleteIds((prev) => new Set(prev).add(pendingComplete.id))
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

      {!canEdit && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
          Modo solo lectura — no tenés permisos para editar este módulo.
        </div>
      )}
      {canEdit && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-md px-3 py-2">
          El camino correcto para registrar avance es <strong>Turnos y Operarios</strong>. Editar acá queda registrado con operario y observación, para excepciones puntuales.
        </div>
      )}

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
              {orders.map((order: any) => {
                const avance = avanceFor(order.id)
                return (
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
                              key={`${rows[0].id}-${resetCounter}`}
                              type="number"
                              defaultValue={rows[0].quantity_completed}
                              min={0}
                              onFocus={(e) => e.target.select()}
                              onBlur={(e) => requestManualEdit(rows[0], parseInt(e.target.value || '0', 10), order.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                              disabled={!canEdit}
                              className="w-10 text-center bg-transparent outline-none font-medium disabled:cursor-not-allowed"
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
                  <td className="p-3 text-center">
                    <span className="font-semibold text-slate-800">{avance}%</span>
                    {canEdit && avance >= 100 && (
                      <button
                        onClick={() => { setDismissedCompleteIds((prev) => { const s = new Set(prev); s.delete(order.id); return s }); setPendingComplete({ id: order.id, order_number: order.order_number }) }}
                        className="block mx-auto mt-1 text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full hover:bg-emerald-700"
                      >
                        Completar OP
                      </button>
                    )}
                  </td>
                </tr>
              )})}
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
                        key={`${r.id}-${resetCounter}`}
                        type="number"
                        defaultValue={r.quantity_completed}
                        min={0}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => requestManualEdit(r, parseInt(e.target.value || '0', 10), modalInfo.orderId, r.component_name)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        disabled={!canEdit}
                        className="w-10 text-center bg-transparent outline-none font-medium disabled:cursor-not-allowed"
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

      {/* MODAL de confirmación + trazabilidad de edición manual */}
      {pendingManualEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={cancelManualEdit}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <span className="text-amber-500 text-2xl leading-none">⚠️</span>
              <div>
                <h3 className="font-semibold text-slate-800 text-lg">¿Confirmás este ajuste manual?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  El camino correcto para registrar avance es <strong>Turnos y Operarios</strong>, donde queda trazabilidad completa por tarea. Usá esta edición directa solo para excepciones puntuales.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 mb-4 text-sm">
              {pendingManualEdit.componentName && (
                <p className="text-slate-500 mb-1">Componente: <strong className="text-slate-700">{pendingManualEdit.componentName}</strong></p>
              )}
              <p className="text-slate-500">
                Cantidad: <strong className="text-slate-700">{pendingManualEdit.oldValue}</strong>
                {' → '}
                <strong className={pendingManualEdit.newValue > pendingManualEdit.oldValue ? 'text-emerald-700' : 'text-rose-700'}>{pendingManualEdit.newValue}</strong>
              </p>
            </div>

            <div className="mb-3">
              <label className="text-xs text-slate-500">¿Quién realizó este avance?</label>
              <select
                value={editOperatorId}
                onChange={(e) => setEditOperatorId(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full mt-1"
              >
                <option value="">Elegí un operario...</option>
                {operators.map((op) => <option key={op.id} value={op.id}>{op.full_name}</option>)}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-xs text-slate-500">Observación (obligatoria)</label>
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Ej: se cargó directo porque el operario ya se había ido, tarea sin asignar en Turnos y Operarios"
                rows={3}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full mt-1"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={cancelManualEdit} className="flex-1 border border-slate-300 rounded-md py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={confirmManualEdit} className="flex-1 bg-amber-600 text-white rounded-md py-2 text-sm font-medium hover:bg-amber-700">
                Confirmar cambio
              </button>
            </div>
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