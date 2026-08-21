'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function shortDate(iso: string | null) {
  if (!iso) return '—'
  return iso.split('T')[0].split('-').reverse().join('/')
}

// Días hábiles (sin sábados ni domingos) entre dos fechas
function businessDaysBetween(startISO: string | null, endISO: string | null) {
  if (!startISO || !endISO) return null
  const start = new Date(startISO)
  const end = new Date(endISO.split('T')[0])
  if (end <= start) return 0
  let count = 0
  const d = new Date(start)
  while (d < end) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

export default function HistorialPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [inicioByOrder, setInicioByOrder] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<any | null>(null)
  const [detailTasks, setDetailTasks] = useState<any[]>([])
  const [hoursSummary, setHoursSummary] = useState<{ estimadas: number; reales: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({})

  async function fetchOrders() {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, client_name, lot_quantity, completed_at, notes, products(name)')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
    setOrders(data || [])

    const orderIds = (data || []).map((o: any) => o.id)
    if (orderIds.length > 0) {
      // Trae todas las tareas de estas OPs solo para calcular el Inicio real:
      // la primera fecha con Real cargado en el sector de menor secuencia (ej. Corte Láser)
      const { data: taskData } = await supabase
        .from('operator_daily_tasks')
        .select('order_id, plan_date, actual_quantity, sectors(sequence_no)')
        .in('order_id', orderIds)

      const minSeqByOrder: Record<string, number> = {}
      ;(taskData || []).forEach((t: any) => {
        const seq = t.sectors?.sequence_no
        if (seq == null) return
        if (minSeqByOrder[t.order_id] == null || seq < minSeqByOrder[t.order_id]) {
          minSeqByOrder[t.order_id] = seq
        }
      })

      const inicioMap: Record<string, string> = {}
      ;(taskData || []).forEach((t: any) => {
        const seq = t.sectors?.sequence_no
        if (seq == null || t.actual_quantity == null) return
        if (seq !== minSeqByOrder[t.order_id]) return
        if (!inicioMap[t.order_id] || t.plan_date < inicioMap[t.order_id]) {
          inicioMap[t.order_id] = t.plan_date
        }
      })
      setInicioByOrder(inicioMap)
    } else {
      setInicioByOrder({})
    }

    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [])

  const filtered = search.length > 0
    ? orders.filter((o) =>
        o.order_number.toLowerCase().includes(search.toLowerCase()) ||
        o.products?.name?.toLowerCase().includes(search.toLowerCase()) ||
        o.client_name?.toLowerCase().includes(search.toLowerCase())
      )
    : orders

  async function openDetail(order: any) {
    setSelected(order)
    setLoadingDetail(true)
    setExpandedSectors({})

    const { data: tasksData } = await supabase
      .from('operator_daily_tasks')
      .select('*, operators(full_name), sectors(name, sequence_no), components(name)')
      .eq('order_id', order.id)
      .order('plan_date', { ascending: true })
    setDetailTasks(tasksData || [])

    const { data: progressData } = await supabase
      .from('order_progress_detail')
      .select('minutes_required')
      .eq('order_id', order.id)
    const estimadasMin = (progressData || []).reduce((s: number, r: any) => s + r.minutes_required, 0)

    const realesMin = (tasksData || []).reduce((s: number, t: any) =>
      s + (t.actual_quantity != null ? t.actual_quantity * (t.standard_time_minutes || 0) : 0), 0)

    setHoursSummary({
      estimadas: Math.round((estimadasMin / 60) * 10) / 10,
      reales: Math.round((realesMin / 60) * 10) / 10,
    })

    setLoadingDetail(false)
  }

  function closeDetail() {
    setSelected(null)
    setDetailTasks([])
    setHoursSummary(null)
    setExpandedSectors({})
  }

  function toggleSector(sectorId: string) {
    setExpandedSectors((prev) => ({ ...prev, [sectorId]: !prev[sectorId] }))
  }

  // Agrupa las tareas del detalle por sector, en el orden de secuencia de planta
  function groupedBySector() {
    const groups: Record<string, { sectorId: string; sectorName: string; sequenceNo: number; tasks: any[] }> = {}
    detailTasks.forEach((t: any) => {
      const sectorId = t.sector_id
      const sectorName = t.sectors?.name || 'Sin sector'
      const sequenceNo = t.sectors?.sequence_no ?? 999
      if (!groups[sectorId]) groups[sectorId] = { sectorId, sectorName, sequenceNo, tasks: [] }
      groups[sectorId].tasks.push(t)
    })
    return Object.values(groups).sort((a, b) => a.sequenceNo - b.sequenceNo)
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Historial de Órdenes</h1>
      <p className="text-sm text-slate-500 mb-6">Trazabilidad completa de las órdenes finalizadas: quién hizo qué, cuándo y cuánto.</p>

      <input
        placeholder="Buscar por N° OP, producto o cliente..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full sm:w-80 mb-5"
      />

      {filtered.length === 0 ? (
        <p className="text-slate-500">Todavía no hay órdenes completadas.</p>
      ) : (
        <>
          {/* ===== VERSIÓN PC: tabla ===== */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-left">
                  <th className="p-3 font-medium">N° OP</th>
                  <th className="p-3 font-medium">Producto</th>
                  <th className="p-3 font-medium">Cliente</th>
                  <th className="p-3 font-medium text-center">Cantidad</th>
                  <th className="p-3 font-medium text-center">Inicio</th>
                  <th className="p-3 font-medium text-center">Fin</th>
                  <th className="p-3 font-medium text-center">Días hábiles</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} onClick={() => openDetail(o)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="p-3 font-medium text-slate-700">#{o.order_number}</td>
                    <td className="p-3 text-slate-700">{o.products?.name}</td>
                    <td className="p-3 text-slate-600">{o.client_name}</td>
                    <td className="p-3 text-center text-slate-600">{o.lot_quantity}</td>
                    <td className="p-3 text-center text-slate-500">{shortDate(inicioByOrder[o.id] || null)}</td>
                    <td className="p-3 text-center text-slate-500">{shortDate(o.completed_at)}</td>
                    <td className="p-3 text-center font-medium text-slate-700">
                      {businessDaysBetween(inicioByOrder[o.id] || null, o.completed_at) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ===== VERSIÓN CELULAR: tarjetas ===== */}
          <div className="md:hidden flex flex-col gap-3">
            {filtered.map((o) => (
              <button key={o.id} onClick={() => openDetail(o)}
                className="text-left bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-slate-400">#{o.order_number}</p>
                <p className="text-sm font-medium text-slate-700 break-words">{o.products?.name}</p>
                <p className="text-xs text-slate-500 mt-1">Cliente: {o.client_name} — Cantidad: {o.lot_quantity}</p>
                <div className="flex justify-between text-xs text-slate-500 mt-2">
                  <span>Inicio: {shortDate(inicioByOrder[o.id] || null)}</span>
                  <span>Fin: {shortDate(o.completed_at)}</span>
                  <span className="font-medium text-slate-700">
                    {businessDaysBetween(inicioByOrder[o.id] || null, o.completed_at) ?? '—'} días hábiles
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* MODAL de detalle / trazabilidad */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeDetail}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <h3 className="font-semibold text-slate-800 text-lg">#{selected.order_number} — {selected.products?.name}</h3>
                <p className="text-sm text-slate-500">Cliente: {selected.client_name} — Cantidad: {selected.lot_quantity}</p>
              </div>
              <button onClick={closeDetail} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            <div className="grid grid-cols-3 gap-3 my-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Inicio</p>
                <p className="text-sm font-semibold text-slate-700">{shortDate(inicioByOrder[selected.id] || null)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Fin</p>
                <p className="text-sm font-semibold text-slate-700">{shortDate(selected.completed_at)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Duración (días hábiles)</p>
                <p className="text-sm font-semibold text-slate-700">
                  {businessDaysBetween(inicioByOrder[selected.id] || null, selected.completed_at) ?? '—'} días
                </p>
              </div>
            </div>

            {hoursSummary && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 text-sm">
                <span className="text-blue-700">Horas estándar estimadas: <strong>{hoursSummary.estimadas}h</strong></span>
                <span className="mx-2 text-blue-300">|</span>
                <span className="text-blue-700">Horas reales insumidas: <strong>{hoursSummary.reales}h</strong></span>
              </div>
            )}

            {selected.notes && (
              <p className="text-sm text-slate-500 italic mb-4">Obs. de la OP: "{selected.notes}"</p>
            )}

            <h4 className="text-sm font-semibold text-slate-700 mb-2">Línea de tiempo por sector</h4>
            {loadingDetail ? (
              <p className="text-sm text-slate-400">Cargando...</p>
            ) : detailTasks.length === 0 ? (
              <p className="text-sm text-slate-400">No hay tareas registradas para esta OP.</p>
            ) : (
              <div className="space-y-2">
                {groupedBySector().map((group) => {
                  const isOpen = !!expandedSectors[group.sectorId]
                  const allClosed = group.tasks.every((t) => t.actual_quantity != null)
                  const totalProg = group.tasks.reduce((s, t) => s + t.target_quantity, 0)
                  const totalReal = group.tasks.reduce((s, t) => s + (t.actual_quantity ?? 0), 0)
                  const operatorNames = Array.from(new Set(group.tasks.map((t) => t.operators?.full_name).filter(Boolean)))

                  return (
                    <div key={group.sectorId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSector(group.sectorId)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-400 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                          <span className="text-sm font-medium text-slate-700 truncate">{group.sectorName}</span>
                          <span className="text-xs text-slate-400 shrink-0">
                            {operatorNames.length === 1 ? operatorNames[0] : `${operatorNames.length} operarios`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className={allClosed ? 'text-slate-600' : 'text-amber-600'}>
                            Prog: <strong>{totalProg}</strong> — Real: <strong>{allClosed ? totalReal : 'sin cerrar'}</strong>
                          </span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="divide-y divide-slate-100">
                          {group.tasks.map((t: any) => (
                            <div key={t.id} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <div>
                                <p className="text-xs text-slate-400">
                                  {shortDate(t.plan_date)}{t.components?.name ? ` — ${t.components.name}` : ''}
                                </p>
                                <p className="text-sm text-slate-700 font-medium">{t.operators?.full_name}</p>
                                {t.notes && <p className="text-xs text-slate-500 italic">"{t.notes}"</p>}
                              </div>
                              <div className="text-sm text-slate-600 shrink-0">
                                Programado: <strong>{t.target_quantity}</strong> — Real: <strong className={t.actual_quantity == null ? 'text-amber-600' : 'text-slate-700'}>
                                  {t.actual_quantity != null ? t.actual_quantity : 'sin cerrar'}
                                </strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <button onClick={closeDetail} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  )
}