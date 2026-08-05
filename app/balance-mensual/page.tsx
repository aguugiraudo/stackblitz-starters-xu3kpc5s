'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

// Suma N días HÁBILES (lunes a viernes) a una fecha
function addBusinessDays(start: Date, days: number) {
  const d = new Date(start)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) added++
  }
  return d
}

// Días hábiles restantes en el mes actual, desde hoy (sin contar hoy)
function businessDaysLeftInMonth() {
  const today = new Date()
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  let count = 0
  const d = new Date(today)
  while (d <= lastDay) {
    const day = d.getDay()
    if (day !== 0 && day !== 6 && d > today) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function shortDate(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function CapacidadMensualPage() {
  const [sectors, setSectors] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [progressRows, setProgressRows] = useState<any[]>([])
  const [capacity, setCapacity] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  async function fetchAll() {
    setLoading(true)
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])

    const { data: capData } = await supabase.from('sector_capacity_settings').select('*')
    const capMap: Record<string, number> = {}
    ;(capData || []).forEach((c: any) => { capMap[c.sector_id] = Number(c.hours_per_day) })
    setCapacity(capMap)

    const { data: ordersData } = await supabase
      .from('orders')
      .select('id, order_number, priority_rank, products(name)')
      .in('status', ['pending', 'in_progress'])
      .order('priority_rank', { ascending: true, nullsFirst: false })
    setOrders(ordersData || [])

    const initialSelected: Record<string, boolean> = {}
    ;(ordersData || []).forEach((o: any) => { initialSelected[o.id] = true })
    setSelected(initialSelected)

    const orderIds = (ordersData || []).map((o: any) => o.id)
    if (orderIds.length > 0) {
      const { data: progData } = await supabase
        .from('order_progress_detail')
        .select('order_id, sector_id, sequence_no, minutes_required, minutes_completed')
        .in('order_id', orderIds)
      setProgressRows(progData || [])
    }

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  async function saveCapacity(sectorId: string, value: string) {
    const hrs = parseFloat(value || '0')
    setCapacity((prev) => ({ ...prev, [sectorId]: hrs }))
    await supabase.from('sector_capacity_settings')
      .upsert({ sector_id: sectorId, hours_per_day: hrs }, { onConflict: 'sector_id' })
  }

  function toggleOrder(orderId: string) {
    setSelected((prev) => ({ ...prev, [orderId]: !prev[orderId] }))
  }

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {}
    orders.forEach((o) => { next[o.id] = value })
    setSelected(next)
  }

  const selectedOrderIds = new Set(orders.filter((o) => selected[o.id]).map((o) => o.id))

  // Carga pendiente por sector (solo de las OPs seleccionadas)
  function pendingMinutesFor(sectorId: string) {
    return progressRows
      .filter((r) => r.sector_id === sectorId && selectedOrderIds.has(r.order_id))
      .reduce((sum, r) => sum + Math.max(0, r.minutes_required - r.minutes_completed), 0)
  }

  const businessDaysLeft = businessDaysLeftInMonth()
  const today = new Date()

  const sectorStats = sectors.map((s) => {
    const pendingMin = pendingMinutesFor(s.id)
    const pendingHoras = Math.round((pendingMin / 60) * 10) / 10
    const hoursPerDay = capacity[s.id] || 0
    const diasNecesarios = hoursPerDay > 0 ? Math.ceil(pendingHoras / hoursPerDay) : null
    const fechaFin = diasNecesarios != null && diasNecesarios > 0 ? addBusinessDays(today, diasNecesarios) : today
    const capacidadMes = hoursPerDay * businessDaysLeft
    const diferenciaMes = Math.round((capacidadMes - pendingHoras) * 10) / 10
    return { sector: s, pendingHoras, hoursPerDay, diasNecesarios, fechaFin, capacidadMes: Math.round(capacidadMes * 10) / 10, diferenciaMes }
  })

  const bottleneck = sectorStats
    .filter((s) => s.diasNecesarios != null && s.pendingHoras > 0)
    .sort((a, b) => (b.diasNecesarios || 0) - (a.diasNecesarios || 0))[0]

  // Para cada OP seleccionada: su etapa actual (primer sector con pendiente) y cuántos días hasta que le toque
  function orderNextStage(order: any) {
    for (const s of sectors) {
      const own = progressRows.find((r) => r.order_id === order.id && r.sector_id === s.id)
      if (!own) continue
      const ownPending = own.minutes_required - own.minutes_completed
      if (ownPending <= 0) continue

      // cola: todas las OPs seleccionadas con igual o mayor prioridad (rank menor = antes) en ese sector
      const queueMinutes = progressRows
        .filter((r) => r.sector_id === s.id && selectedOrderIds.has(r.order_id))
        .filter((r) => {
          const o = orders.find((o) => o.id === r.order_id)
          return o && (o.priority_rank ?? 999999) <= (order.priority_rank ?? 999999)
        })
        .reduce((sum, r) => sum + Math.max(0, r.minutes_required - r.minutes_completed), 0)

      const hoursPerDay = capacity[s.id] || 0
      const days = hoursPerDay > 0 ? Math.ceil((queueMinutes / 60) / hoursPerDay) : null
      return { sector: s, days, date: days != null ? addBusinessDays(today, days) : null }
    }
    return null
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Capacidad Mensual</h1>
      <p className="text-sm text-slate-500 mb-6">Proyectá cuánto tiempo te lleva la carga pendiente, sector por sector.</p>

      {/* Selección de OPs */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700">OPs a proyectar</h2>
          <div className="flex gap-2">
            <button onClick={() => toggleAll(true)} className="text-xs text-blue-600 underline">Seleccionar todas</button>
            <button onClick={() => toggleAll(false)} className="text-xs text-slate-500 underline">Ninguna</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
          {orders.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!selected[o.id]} onChange={() => toggleOrder(o.id)} />
              <span className="truncate">#{o.order_number} — {o.products?.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Cuello de botella */}
      {bottleneck && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800">
            <strong>Sector cuello de botella: {bottleneck.sector.name}.</strong> Con la capacidad que cargaste, es el que más tarda en vaciarse
            ({bottleneck.diasNecesarios} días hábiles) — es el que más impacta si querés acelerar toda la producción.
          </p>
        </div>
      )}

      {/* Tarjetas por sector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {sectorStats.map(({ sector, pendingHoras, hoursPerDay, diasNecesarios, fechaFin, capacidadMes, diferenciaMes }) => (
          <div key={sector.id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <p className="font-semibold text-slate-700 mb-2">{sector.name}</p>

            <div className="flex items-center gap-2 mb-3">
              <label className="text-xs text-slate-500">Horas/día:</label>
              <input
                type="number"
                step={0.5}
                defaultValue={hoursPerDay}
                onBlur={(e) => saveCapacity(sector.id, e.target.value)}
                className="w-16 text-center rounded-md border border-slate-300 py-1 text-sm"
              />
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Carga pendiente</span>
                <span className="text-slate-700 font-medium">{pendingHoras} hs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Días necesarios</span>
                <span className="text-slate-700 font-medium">{diasNecesarios != null ? `${diasNecesarios} días` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fin estimado</span>
                <span className="text-slate-700 font-medium">{pendingHoras > 0 ? shortDate(fechaFin) : '—'}</span>
              </div>
            </div>

            <div className={`mt-3 pt-3 border-t text-xs rounded ${diferenciaMes >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {hoursPerDay === 0 ? (
                <span className="text-slate-400">Cargá las horas/día para ver el diagnóstico del mes.</span>
              ) : diferenciaMes >= 0 ? (
                <span>✓ Capacidad correcta — te sobran ~{diferenciaMes}hs este mes en este sector.</span>
              ) : (
                <span>⚠ Requerimiento de tercerización — faltan ~{Math.abs(diferenciaMes)}hs para cubrir este mes.</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Próxima etapa por OP */}
      <h2 className="font-semibold text-slate-700 mb-3">¿Cuándo le toca a cada OP?</h2>
      {selectedOrderIds.size === 0 ? (
        <p className="text-slate-400">No hay OPs seleccionadas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-left">
                <th className="p-3 font-medium">N° OP</th>
                <th className="p-3 font-medium">Producto</th>
                <th className="p-3 font-medium">Próxima etapa pendiente</th>
                <th className="p-3 font-medium text-center">Le toca en</th>
                <th className="p-3 font-medium text-center">Fecha estimada</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter((o) => selectedOrderIds.has(o.id)).map((order) => {
                const stage = orderNextStage(order)
                return (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium text-slate-700">#{order.order_number}</td>
                    <td className="p-3 text-slate-600">{order.products?.name}</td>
                    <td className="p-3 text-slate-600">{stage ? stage.sector.name : <span className="text-emerald-600">Sin pendientes</span>}</td>
                    <td className="p-3 text-center text-slate-600">{stage?.days != null ? `${stage.days} días` : '—'}</td>
                    <td className="p-3 text-center text-slate-600">{stage?.date ? shortDate(stage.date) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}