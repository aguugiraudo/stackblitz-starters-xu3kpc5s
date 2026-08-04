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
      // Las completadas más recientes primero, y todas arriba de las activas — así no se "pierden" al fondo
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
    }

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [weekOffset])

  const hasSaturdayTasks = tasks.some((t) => t.plan_date === satDate)
  const dates = hasSaturdayTasks ? [...weekdayDates, satDate] : weekdayDates

  function dayResult(orderId: string, date: string) {
    const totalWeight = weightByOrder[orderId]
    const dayTasks = tasks.filter((t) => t.order_id === orderId && t.plan_date === date)
    if (dayTasks.length === 0 || !totalWeight) return null

    const progMinutes = dayTasks.reduce((sum, t) => sum + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const hasAnyActual = dayTasks.some((t) => t.actual_quantity != null)
    const realMinutes = dayTasks.reduce((sum, t) => sum + (t.actual_quantity != null ? t.actual_quantity * (t.standard_time_minutes || 0) : 0), 0)

    const progPct = Math.round((progMinutes / totalWeight) * 1000) / 10
    const realPct = hasAnyActual ? Math.round((realMinutes / totalWeight) * 1000) / 10 : null
    const cumplimiento = realPct != null && progPct > 0 ? Math.round((realPct / progPct) * 1000) / 10 : null

    return { progPct, realPct, cumplimiento }
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

  // Cumplimiento acumulado de TODA la semana (todos los días juntos)
  function weekResult() {
    const weekTasks = tasks // ya viene filtrado por la semana actual desde fetchAll
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
      <p className="text-sm text-slate-500 mb-4">Objetivo programado vs. producción real, por orden y por día.</p>

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
                          <span className="text-center py-2 text-slate-600 text-xs">{r ? `${r.progPct}%` : '—'}</span>
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