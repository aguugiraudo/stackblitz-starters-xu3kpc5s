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
  const [weightByOrder, setWeightByOrder] = useState<Record<string, number>>({})
  const [tasks, setTasks] = useState<any[]>([])
  const [allTasksByOrder, setAllTasksByOrder] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)

  const monday = getMondayOfWeek(weekOffset)
  const weekdayDates = weekDates(monday)
  const satDate = saturdayOf(monday)
  const todayISO = toISO(new Date())

  async function fetchAll() {
    setLoading(true)

    const { data: taskData } = await supabase
      .from('operator_daily_tasks')
      .select('*')
      .gte('plan_date', weekdayDates[0])
      .lte('plan_date', satDate)
    setTasks(taskData || [])

    const { data: activeOrders } = await supabase
      .from('orders')
      .select('id, order_number, status, completed_at, products(name)')
      .in('status', ['pending', 'in_progress'])
      .order('priority_rank', { ascending: true, nullsFirst: false })

    const orderIdsWithTasks = Array.from(new Set((taskData || []).map((t: any) => t.order_id)))
    const activeIds = new Set((activeOrders || []).map((o: any) => o.id))
    const missingIds = orderIdsWithTasks.filter((id) => !activeIds.has(id))

    let completedWithTasks: any[] = []
    if (missingIds.length > 0) {
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, status, completed_at, products(name)')
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
        .select('order_id, minutes_required')
        .in('order_id', orderIds)

      const weights: Record<string, number> = {}
      ;(progressData || []).forEach((r: any) => {
        weights[r.order_id] = (weights[r.order_id] || 0) + r.minutes_required
      })
      setWeightByOrder(weights)

      const { data: allTaskData } = await supabase
        .from('operator_daily_tasks')
        .select('order_id, plan_date, target_quantity, actual_quantity, standard_time_minutes')
        .in('order_id', orderIds)

      const grouped: Record<string, any[]> = {}
      ;(allTaskData || []).forEach((t: any) => {
        if (!grouped[t.order_id]) grouped[t.order_id] = []
        grouped[t.order_id].push(t)
      })
      setAllTasksByOrder(grouped)
    } else {
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

  function cumulativeUpTo(orderId: string, date: string, inclusive: boolean) {
    const totalWeight = weightByOrder[orderId]
    const all = allTasksByOrder[orderId] || []
    const relevant = all.filter((t) => inclusive ? t.plan_date <= date : t.plan_date < date)
    if (!totalWeight || relevant.length === 0) return { prog: null as number | null, real: null as number | null, hasAny: false }

    const progMin = relevant.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const closed = relevant.filter((t) => t.actual_quantity != null)
    const realMin = closed.reduce((s, t) => s + t.actual_quantity * (t.standard_time_minutes || 0), 0)

    return {
      prog: Math.round((progMin / totalWeight) * 1000) / 10,
      real: closed.length > 0 ? Math.round((realMin / totalWeight) * 1000) / 10 : null,
      hasAny: true,
    }
  }

  function dayResult(orderId: string, date: string) {
    // No mostrar nada más allá de la última fecha con una tarea real cargada para esta OP
    const maxTaskDate = maxTaskDateFor(orderId)
    if (!maxTaskDate || date > maxTaskDate) return null

    const upToToday = cumulativeUpTo(orderId, date, true)
    if (!upToToday.hasAny) return null

    const beforeToday = cumulativeUpTo(orderId, date, false)
    const todaysTasks = (allTasksByOrder[orderId] || []).filter((t) => t.plan_date === date)
    const allClosedToday = todaysTasks.length > 0 && todaysTasks.every((t) => t.actual_quantity != null)

    let cumplimiento: number | null = null
    if (allClosedToday) {
      const targetIncrement = (upToToday.prog ?? 0) - (beforeToday.prog ?? 0)
      const realIncrement = (upToToday.real ?? 0) - (beforeToday.real ?? 0)
      cumplimiento = targetIncrement > 0 ? Math.round((realIncrement / targetIncrement) * 1000) / 10 : null
    }

    return { progPct: upToToday.prog, realPct: upToToday.real, cumplimiento }
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

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  const weekCumplimiento = weekResult()

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
                    <div className="text-slate-700 text-xs">{order.products?.name}</div>
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
                          <span className="text-center py-2 text-slate-600 text-xs">{r?.progPct != null ? `${r.progPct}%` : '—'}</span>
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
    </main>
  )
}