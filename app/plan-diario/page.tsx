'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

function getMondayOfWeek(offsetWeeks: number) {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function weekDates(monday: Date) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return toISO(d)
  })
}

function saturdayOf(monday: Date) {
  const d = new Date(monday)
  d.setDate(monday.getDate() + 5)
  return toISO(d)
}

function shortDate(iso: string) {
  return iso.split('-').reverse().slice(0, 2).join('/')
}

export default function PlanDiarioPage() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [orders, setOrders] = useState<any[]>([])
  const [sectors, setSectors] = useState<any[]>([])
  const [weightByOrder, setWeightByOrder] = useState<Record<string, number>>({})
  const [progressDetailRows, setProgressDetailRows] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [allTasksByOrder, setAllTasksByOrder] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [orderDetailModal, setOrderDetailModal] = useState<{ order: any; date: string } | null>(null)

  const monday = getMondayOfWeek(weekOffset)
  const weekdayDates = weekDates(monday)
  const satDate = saturdayOf(monday)
  const todayISO = toISO(new Date())

  async function fetchAll() {
    setLoading(true)

    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])

    const { data: taskData } = await supabase
      .from('operator_daily_tasks')
      .select('*')
      .gte('plan_date', weekdayDates[0])
      .lte('plan_date', satDate)
    setTasks(taskData || [])

    const { data: activeOrders } = await supabase
      .from('orders')
      .select('id, order_number, status, completed_at, lot_quantity, products(name)')
      .in('status', ['pending', 'in_progress'])
      .order('priority_rank', { ascending: true, nullsFirst: false })

    const orderIdsWithTasks = Array.from(new Set((taskData || []).map((t: any) => t.order_id)))
    const activeIds = new Set((activeOrders || []).map((o: any) => o.id))
    const missingIds = orderIdsWithTasks.filter((id) => !activeIds.has(id))

    let completedWithTasks: any[] = []
    if (missingIds.length > 0) {
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, status, completed_at, lot_quantity, products(name)')
        .in('id', missingIds)
      completedWithTasks = (data || []).sort((a: any, b: any) =>
        new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime()
      )
    }

    const allOrders = [...completedWithTasks, ...(activeOrders || [])]
    setOrders(allOrders)

    const orderIds = allOrders.map((o: any) => o.id)
    if (orderIds.length > 0) {
      const { data: progressData } = await supabase
        .from('order_progress_detail')
        .select('order_id, sector_id, minutes_required, quantity_required, quantity_completed, standard_time_minutes, target_type, component_id, component_name')
        .in('order_id', orderIds)
      setProgressDetailRows(progressData || [])

      const weights: Record<string, number> = {}
      ;(progressData || []).forEach((r: any) => {
        weights[r.order_id] = (weights[r.order_id] || 0) + r.minutes_required
      })
      setWeightByOrder(weights)

      const { data: allTaskData } = await supabase
        .from('operator_daily_tasks')
        .select('order_id, sector_id, component_id, plan_date, target_quantity, actual_quantity, standard_time_minutes')
        .in('order_id', orderIds)

      const grouped: Record<string, any[]> = {}
      ;(allTaskData || []).forEach((t: any) => {
        if (!grouped[t.order_id]) grouped[t.order_id] = []
        grouped[t.order_id].push(t)
      })
      setAllTasksByOrder(grouped)
    } else {
      setProgressDetailRows([])
      setAllTasksByOrder({})
    }

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [weekOffset])

  const hasSaturdayTasks = tasks.some((t) => t.plan_date === satDate)
  const dates = hasSaturdayTasks ? [...weekdayDates, satDate] : weekdayDates

  function maxTaskDateFor(orderId: string) {
    const all = allTasksByOrder[orderId] || []
    if (all.length === 0) return null
    return all.reduce((max, t) => (t.plan_date > max ? t.plan_date : max), all[0].plan_date)
  }

  // Real acumulado (%) de una orden hasta una fecha dada (inclusive o estrictamente anterior)
  function cumulativeRealUpTo(orderId: string, date: string, inclusive: boolean) {
    const totalWeight = weightByOrder[orderId]
    const all = allTasksByOrder[orderId] || []
    const relevant = all.filter((t) => inclusive ? t.plan_date <= date : t.plan_date < date)
    if (!totalWeight || relevant.length === 0) return { real: null as number | null, hasAny: false }

    const closed = relevant.filter((t) => t.actual_quantity != null)
    const realMin = closed.reduce((s, t) => s + t.actual_quantity * (t.standard_time_minutes || 0), 0)

    return {
      real: closed.length > 0 ? Math.round((realMin / totalWeight) * 1000) / 10 : null,
      hasAny: true,
    }
  }

  function dayResult(orderId: string, date: string) {
    // No mostrar nada más allá de la última fecha con una tarea real cargada para esta OP
    const maxTaskDate = maxTaskDateFor(orderId)
    if (!maxTaskDate || date > maxTaskDate) return null

    const totalWeight = weightByOrder[orderId]
    const upToToday = cumulativeRealUpTo(orderId, date, true)
    if (!upToToday.hasAny) return null

    const beforeToday = cumulativeRealUpTo(orderId, date, false)
    const todaysTasks = (allTasksByOrder[orderId] || []).filter((t) => t.plan_date === date)
    const allClosedToday = todaysTasks.length > 0 && todaysTasks.every((t) => t.actual_quantity != null)

    // Incremento de objetivo de HOY (solo lo programado para este día, en % del peso total)
    const todayTargetMin = todaysTasks.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const todayTargetPct = totalWeight ? (todayTargetMin / totalWeight) * 100 : 0

    // El objetivo del día parte del REAL acumulado hasta ayer, no del objetivo teórico acumulado.
    // Así "Obj." nunca arrastra el déficit (o exceso) de días anteriores.
    const baseRealPct = beforeToday.real ?? 0
    const progPct = Math.round((baseRealPct + todayTargetPct) * 10) / 10

    let cumplimiento: number | null = null
    if (allClosedToday) {
      const realIncrement = (upToToday.real ?? 0) - (beforeToday.real ?? 0)
      cumplimiento = todayTargetPct > 0 ? Math.round((realIncrement / todayTargetPct) * 1000) / 10 : null
    }

    return { progPct, realPct: upToToday.real, cumplimiento }
  }

  function plantDayResult(date: string) {
    const dayTasks = tasks.filter((t) => t.plan_date === date)
    if (dayTasks.length === 0) return null

    const progMinutes = dayTasks.reduce((sum, t) => sum + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const hasAnyActual = dayTasks.some((t) => t.actual_quantity != null)
    const realMinutes = dayTasks.reduce((sum, t) => sum + (t.actual_quantity != null ? t.actual_quantity * (t.standard_time_minutes || 0) : 0), 0)

    const progHoras = Math.round((progMinutes / 60) * 10) / 10
    const realHoras = hasAnyActual ? Math.round((realMinutes / 60) * 10) / 10 : null
    const cumplimiento = hasAnyActual && progMinutes > 0 ? Math.round((realMinutes / progMinutes) * 1000) / 10 : null

    return { progHoras, realHoras, cumplimiento }
  }

  function weekResult() {
    const weekTasks = tasks
    if (weekTasks.length === 0) return null
    const progMinutes = weekTasks.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const hasAnyActual = weekTasks.some((t) => t.actual_quantity != null)
    const realMinutes = weekTasks.reduce((s, t) => s + (t.actual_quantity != null ? t.actual_quantity * (t.standard_time_minutes || 0) : 0), 0)
    if (!hasAnyActual || progMinutes === 0) return null
    return Math.round((realMinutes / progMinutes) * 1000) / 10
  }

  function cumplimientoColor(c: number | null) {
    if (c == null) return 'text-slate-300'
    if (c >= 100) return 'text-emerald-600 font-semibold'
    if (c >= 70) return 'text-amber-600 font-semibold'
    return 'text-rose-600 font-semibold'
  }

  // Desglose por sector de una orden, tal como estaba a una fecha puntual:
  // requerido total, completado real ACUMULADO hasta esa fecha, pendiente, y lo programado justo ese día.
  function sectorBreakdownFor(orderId: string, date: string) {
    const allRows = progressDetailRows.filter((r) => r.order_id === orderId)
    const orderTasks = allTasksByOrder[orderId] || []

    // Agrupar los renglones de requerido por sector (puede haber varios por componente)
    const bySector: Record<string, { sectorId: string; sectorName: string; sequenceNo: number; requiredQty: number }> = {}
    allRows.forEach((r) => {
      const sector = sectors.find((s) => s.id === r.sector_id)
      const sectorName = sector?.name || 'Sin sector'
      const sequenceNo = sector?.sequence_no ?? 999
      if (!bySector[r.sector_id]) bySector[r.sector_id] = { sectorId: r.sector_id, sectorName, sequenceNo, requiredQty: 0 }
      bySector[r.sector_id].requiredQty += r.quantity_required
    })

    return Object.values(bySector)
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .map((s) => {
        const tasksUpToDate = orderTasks.filter((t) => t.sector_id === s.sectorId && t.plan_date <= date)
        const completedQty = tasksUpToDate
          .filter((t) => t.actual_quantity != null)
          .reduce((sum, t) => sum + t.actual_quantity, 0)
        const todayTasks = orderTasks.filter((t) => t.sector_id === s.sectorId && t.plan_date === date)
        const programmedTodayQty = todayTasks.reduce((sum, t) => sum + t.target_quantity, 0)
        const pendingQty = Math.max(0, s.requiredQty - completedQty)
        return {
          ...s,
          completedQty,
          pendingQty,
          programmedTodayQty,
          pctDone: s.requiredQty > 0 ? Math.round((completedQty / s.requiredQty) * 1000) / 10 : null,
        }
      })
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  const weekCumplimiento = weekResult()
  const modalBreakdown = orderDetailModal ? sectorBreakdownFor(orderDetailModal.order.id, orderDetailModal.date) : []
  const modalDayResult = orderDetailModal ? dayResult(orderDetailModal.order.id, orderDetailModal.date) : null

  return (
    <main className="p-6 max-w-full mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Plan Diario</h1>
      <p className="text-sm text-slate-500 mb-4">Avance acumulado de cada orden, y cumplimiento del objetivo de cada día.</p>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={() => setWeekOffset((w) => w - 1)} className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">
          ← Semana anterior
        </button>
        <span className="text-sm font-medium text-slate-700">
          Semana del {shortDate(weekdayDates[0])} al {shortDate(weekdayDates[4])}
        </span>
        <button onClick={() => setWeekOffset((w) => w + 1)} className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">
          Semana siguiente →
        </button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-blue-600 underline">Volver a esta semana</button>
        )}
        {hasSaturdayTasks && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">+ Sábado {shortDate(satDate)} (extra)</span>
        )}
        {weekCumplimiento != null && (
          <span className={`text-xs px-2 py-1 rounded-full bg-slate-100 ${cumplimientoColor(weekCumplimiento)}`}>
            Cumplimiento de la semana: {weekCumplimiento}%
          </span>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="text-slate-500">No hay órdenes activas todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
          <table className="text-sm border-collapse table-fixed w-full">
            <colgroup>
              <col style={{ width: '150px' }} />
              {dates.map((d) => <col key={d} style={{ width: '150px' }} />)}
            </colgroup>
            <thead>
              <tr className="bg-slate-900 text-white text-left">
                <th className="p-2 font-medium">OP / Producto</th>
                {dates.map((d, i) => {
                  const isToday = d === todayISO
                  return (
                    <th key={d} className={`p-2 font-medium text-center border-l ${
                      d === satDate ? 'bg-amber-900/40 border-amber-700' :
                      isToday ? 'bg-slate-700 border-slate-600' : 'border-slate-700'
                    }`}>
                      {i < 5 ? DAY_NAMES[i] : 'Sábado extra'}
                      <div className="text-[10px] font-normal text-slate-300">{shortDate(d)}{isToday ? ' • hoy' : ''}</div>
                    </th>
                  )
                })}
              </tr>
              <tr className="bg-slate-800 text-slate-300 text-[11px]">
                <th className="p-1"></th>
                {dates.map((d) => {
                  const isToday = d === todayISO
                  return (
                    <th key={d} className={`p-0 border-l ${d === satDate ? 'border-amber-700' : isToday ? 'border-slate-600' : 'border-slate-700'}`}>
                      <div className="grid grid-cols-3">
                        <span className="text-center py-1">Obj.</span>
                        <span className="text-center py-1">Real</span>
                        <span className="text-center py-1">Cum.</span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50 border-t-2 border-b-2 border-slate-200">
                <td className="p-2 font-semibold text-slate-600 text-xs">Cumplimiento de planta</td>
                {dates.map((d) => {
                  const r = plantDayResult(d)
                  const isToday = d === todayISO
                  return (
                    <td key={d} className={`p-0 border-l border-slate-200 ${isToday ? 'bg-slate-100' : ''}`}>
                      <div className="grid grid-cols-3">
                        <span className="text-center py-2 text-slate-500 text-xs">{r ? `${r.progHoras}h` : '—'}</span>
                        <span className="text-center py-2 text-slate-500 text-xs">{r?.realHoras != null ? `${r.realHoras}h` : '—'}</span>
                        <span className={`text-center py-2 text-xs ${cumplimientoColor(r?.cumplimiento ?? null)}`}>
                          {r?.cumplimiento != null ? `${r.cumplimiento}%` : '—'}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>

              {orders.map((order) => (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="p-2 leading-tight">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      #{order.order_number}
                      {order.status === 'completed' && (
                        <span className="text-emerald-600 text-[10px] bg-emerald-50 px-1 rounded">completada</span>
                      )}
                    </div>
                    <div className="text-slate-700 text-xs">
                      {order.products?.name}
                      {order.lot_quantity != null && <span className="text-slate-400"> ({order.lot_quantity})</span>}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const r = dayResult(order.id, d)
                    const isToday = d === todayISO
                    return (
                      <td key={d} className={`p-0 border-l ${
                        d === satDate ? 'border-amber-100 bg-amber-50/40' :
                        isToday ? 'border-slate-100 bg-slate-50/60' : 'border-slate-100'
                      }`}>
                        <div className="grid grid-cols-3">
                          {r?.progPct != null ? (
                            <button
                              onClick={() => setOrderDetailModal({ order, date: d })}
                              className="text-center py-2 text-slate-600 text-xs hover:bg-slate-100 hover:text-blue-700 hover:underline decoration-dotted transition-colors"
                              title="Ver desglose por sector"
                            >
                              {r.progPct}%
                            </button>
                          ) : (
                            <span className="text-center py-2 text-slate-600 text-xs">—</span>
                          )}
                          <span className="text-center py-2 text-slate-600 text-xs">{r?.realPct != null ? `${r.realPct}%` : '—'}</span>
                          <span className={`text-center py-2 text-xs ${cumplimientoColor(r?.cumplimiento ?? null)}`}>
                            {r?.cumplimiento != null ? `${r.cumplimiento}%` : '—'}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: desglose por sector de la OP, tal como estaba en la fecha clickeada */}
      {orderDetailModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOrderDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <h3 className="font-semibold text-slate-800 text-lg">
                  #{orderDetailModal.order.order_number} — {orderDetailModal.order.products?.name}
                </h3>
                <p className="text-sm text-slate-500">Estado al {shortDate(orderDetailModal.date)}</p>
              </div>
              <button onClick={() => setOrderDetailModal(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {modalDayResult && (
              <div className="grid grid-cols-3 gap-3 my-4">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Objetivo</p>
                  <p className="text-lg font-semibold text-slate-700">{modalDayResult.progPct != null ? `${modalDayResult.progPct}%` : '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Real</p>
                  <p className="text-lg font-semibold text-slate-700">{modalDayResult.realPct != null ? `${modalDayResult.realPct}%` : '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Cumplimiento del día</p>
                  <p className={`text-lg font-semibold ${cumplimientoColor(modalDayResult.cumplimiento)}`}>
                    {modalDayResult.cumplimiento != null ? `${modalDayResult.cumplimiento}%` : '—'}
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 mb-2">
              Para llegar al {modalDayResult?.progPct != null ? `${modalDayResult.progPct}%` : 'objetivo'}, esto es lo que hace falta o ya se hizo, sector por sector:
            </p>

            <div className="space-y-2">
              {modalBreakdown.map((s) => (
                <div key={s.sectorId} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-slate-700">{s.sectorName}</p>
                    <p className={`text-xs font-semibold ${
                      s.pctDone == null ? 'text-slate-300' : s.pctDone >= 100 ? 'text-emerald-600' : s.pctDone > 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}>
                      {s.pctDone != null ? `${s.pctDone}%` : '—'}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <span>Requerido: <strong className="text-slate-700">{s.requiredQty}</strong></span>
                    <span>Completado: <strong className="text-slate-700">{s.completedQty}</strong></span>
                    <span>Pendiente: <strong className={s.pendingQty > 0 ? 'text-rose-600' : 'text-emerald-600'}>{s.pendingQty}</strong></span>
                  </div>
                  {s.programmedTodayQty > 0 && (
                    <p className="text-[11px] text-blue-600 mt-1.5 bg-blue-50 rounded px-2 py-1 inline-block">
                      Programado para el {shortDate(orderDetailModal.date)}: {s.programmedTodayQty} u.
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button onClick={() => setOrderDetailModal(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  )
}