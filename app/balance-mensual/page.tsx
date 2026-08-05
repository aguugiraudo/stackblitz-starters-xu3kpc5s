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
  const [orderPickerOpen, setOrderPickerOpen] = useState(false)
  const [sectorModal, setSectorModal] = useState<any | null>(null)

  const [plantSettings, setPlantSettings] = useState<{ id: string | null; totalOperators: number; hoursPerOperator: number }>({
    id: null, totalOperators: 0, hoursPerOperator: 8,
  })

  const [loading, setLoading] = useState(true)

  async function fetchAll() {
    setLoading(true)
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])

    const { data: capData } = await supabase.from('sector_capacity_settings').select('*')
    const capMap: Record<string, number> = {}
    ;(capData || []).forEach((c: any) => { capMap[c.sector_id] = Number(c.hours_per_day) })
    setCapacity(capMap)

    const { data: plantData } = await supabase.from('plant_capacity_settings').select('*').limit(1).maybeSingle()
    if (plantData) {
      setPlantSettings({
        id: plantData.id,
        totalOperators: plantData.total_operators,
        hoursPerOperator: Number(plantData.hours_per_operator),
      })
    }

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

  async function savePlantSetting(field: 'totalOperators' | 'hoursPerOperator', value: string) {
    const num = field === 'totalOperators' ? parseInt(value || '0', 10) : parseFloat(value || '0')
    const next = { ...plantSettings, [field]: num }
    setPlantSettings(next)
    if (plantSettings.id) {
      await supabase.from('plant_capacity_settings').update({
        total_operators: next.totalOperators,
        hours_per_operator: next.hoursPerOperator,
      }).eq('id', plantSettings.id)
    }
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
  const selectedCount = selectedOrderIds.size

  function pendingMinutesFor(sectorId: string) {
    return progressRows
      .filter((r) => r.sector_id === sectorId && selectedOrderIds.has(r.order_id))
      .reduce((sum, r) => sum + Math.max(0, r.minutes_required - r.minutes_completed), 0)
  }

  function pendingHoursByOrderFor(sectorId: string) {
    const map: Record<string, number> = {}
    progressRows
      .filter((r) => r.sector_id === sectorId && selectedOrderIds.has(r.order_id))
      .forEach((r) => {
        const pend = Math.max(0, r.minutes_required - r.minutes_completed)
        map[r.order_id] = (map[r.order_id] || 0) + pend
      })
    return Object.entries(map)
      .map(([orderId, min]) => ({
        order: orders.find((o) => o.id === orderId),
        hours: Math.round((min / 60) * 10) / 10,
      }))
      .filter((r) => r.hours > 0)
      .sort((a, b) => b.hours - a.hours)
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

  // Panorama general: mano de obra real (operarios × hs/operario), independiente de los inputs por sector
  const totalPendingHoras = Math.round(sectorStats.reduce((s, x) => s + x.pendingHoras, 0) * 10) / 10
  const laborDiariaTotal = plantSettings.totalOperators * plantSettings.hoursPerOperator
  const laborCapacidadMes = Math.round(laborDiariaTotal * businessDaysLeft * 10) / 10
  const laborDiferencia = Math.round((laborCapacidadMes - totalPendingHoras) * 10) / 10
  const hasLaborInput = plantSettings.totalOperators > 0 && plantSettings.hoursPerOperator > 0

  function orderEstimatedFinish(order: any) {
    let maxDays: number | null = null
    let limitingSector: any = null

    for (const s of sectors) {
      const own = progressRows.find((r) => r.order_id === order.id && r.sector_id === s.id)
      if (!own) continue
      const ownPending = own.minutes_required - own.minutes_completed
      if (ownPending <= 0) continue

      const queueMinutes = progressRows
        .filter((r) => r.sector_id === s.id && selectedOrderIds.has(r.order_id))
        .filter((r) => {
          const o = orders.find((o) => o.id === r.order_id)
          return o && (o.priority_rank ?? 999999) <= (order.priority_rank ?? 999999)
        })
        .reduce((sum, r) => sum + Math.max(0, r.minutes_required - r.minutes_completed), 0)

      const hoursPerDay = capacity[s.id] || 0
      if (hoursPerDay <= 0) continue
      const days = Math.ceil((queueMinutes / 60) / hoursPerDay)

      if (maxDays == null || days > maxDays) {
        maxDays = days
        limitingSector = s
      }
    }

    if (maxDays == null) return null
    return { days: maxDays, date: addBusinessDays(today, maxDays), limitingSector }
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Capacidad Mensual</h1>
      <p className="text-sm text-slate-500 mb-6">Proyección de la carga pendiente frente a la capacidad disponible, por sector y a nivel planta.</p>

      {/* Selector de Órdenes */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden">
        <button
          onClick={() => setOrderPickerOpen(!orderPickerOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <span className="font-semibold text-slate-700">
            Órdenes incluidas en la proyección — {selectedCount} de {orders.length}
          </span>
          <span className="text-slate-400 text-sm">{orderPickerOpen ? '▲ cerrar' : '▼ ver / elegir'}</span>
        </button>
        {orderPickerOpen && (
          <div className="border-t border-slate-200 p-4">
            <div className="flex gap-3 mb-3">
              <button onClick={() => toggleAll(true)} className="text-xs text-blue-600 underline">Seleccionar todas</button>
              <button onClick={() => toggleAll(false)} className="text-xs text-slate-500 underline">Ninguna</button>
            </div>
            <div className="flex flex-col divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {orders.map((o) => (
                <label key={o.id} className="flex items-center gap-3 py-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={!!selected[o.id]} onChange={() => toggleOrder(o.id)} className="shrink-0" />
                  <span>#{o.order_number} — {o.products?.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Panorama General */}
      <div className="bg-slate-900 text-white rounded-xl shadow-sm p-5 mb-6">
        <p className="font-semibold mb-1">Panorama General</p>
        <p className="text-xs text-slate-400 mb-4">Capacidad de mano de obra de la planta frente a la carga total pendiente del mes.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-400">Cantidad de operarios</label>
            <input
              type="number"
              defaultValue={plantSettings.totalOperators || ''}
              onBlur={(e) => savePlantSetting('totalOperators', e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Horas por operario / día</label>
            <input
              type="number"
              step={0.5}
              defaultValue={plantSettings.hoursPerOperator || ''}
              onBlur={(e) => savePlantSetting('hoursPerOperator', e.target.value)}
              placeholder="8"
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-700">
          <div>
            <p className="text-xs text-slate-400">Capacidad de mano de obra este mes</p>
            <p className="text-2xl font-semibold">{hasLaborInput ? `${laborCapacidadMes} hs` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Carga total pendiente</p>
            <p className="text-2xl font-semibold">{totalPendingHoras} hs</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Diagnóstico</p>
            {!hasLaborInput ? (
              <p className="text-base text-slate-400">Cargá operarios y horas</p>
            ) : laborDiferencia >= 0 ? (
              <p className="text-lg font-semibold text-emerald-400">Capacidad suficiente (+{laborDiferencia}hs)</p>
            ) : (
              <p className="text-lg font-semibold text-rose-400">Capacidad insuficiente (−{Math.abs(laborDiferencia)}hs)</p>
            )}
          </div>
        </div>
      </div>

      {/* Sector crítico */}
      {bottleneck && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800">
            <strong>Sector crítico: {bottleneck.sector.name}.</strong> Con la capacidad cargada, es el que más tarda en absorber su carga pendiente
            ({bottleneck.diasNecesarios} días hábiles) — el punto de mayor impacto si se busca acelerar la producción general.
          </p>
        </div>
      )}

      {/* Detalle por sector */}
      <h2 className="font-semibold text-slate-700 mb-3">Detalle por sector</h2>
      <div className="space-y-3 mb-8">
        {sectorStats.map(({ sector, pendingHoras, hoursPerDay, diasNecesarios, fechaFin, diferenciaMes }) => (
          <div key={sector.id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="font-semibold text-slate-800 text-lg">{sector.name}</p>
                {pendingHoras > 0 && (
                  <button
                    onClick={() => setSectorModal({ sector, orders: pendingHoursByOrderFor(sector.id), totalHoras: pendingHoras })}
                    className="text-xs text-blue-600 underline"
                  >
                    Ver desglose por orden
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Horas/día asignadas:</label>
                <input
                  type="number"
                  step={0.5}
                  defaultValue={hoursPerDay}
                  onBlur={(e) => saveCapacity(sector.id, e.target.value)}
                  className="w-16 text-center rounded-md border border-slate-300 py-1 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div>
                <p className="text-xs text-slate-400">Carga pendiente</p>
                <p className="text-slate-700 font-medium">{pendingHoras} hs</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Días necesarios</p>
                <p className="text-slate-700 font-medium">{diasNecesarios != null ? `${diasNecesarios} días` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Fin estimado</p>
                <p className="text-slate-700 font-medium">{pendingHoras > 0 ? shortDate(fechaFin) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Diagnóstico del mes</p>
                {hoursPerDay === 0 ? (
                  <p className="text-slate-400 text-sm">Sin datos</p>
                ) : diferenciaMes >= 0 ? (
                  <p className="text-emerald-700 text-sm font-medium">Capacidad correcta (+{diferenciaMes}hs)</p>
                ) : (
                  <p className="text-rose-700 text-sm font-medium">Requiere tercerización ({Math.abs(diferenciaMes)}hs)</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Estimación de finalización por orden */}
      <h2 className="font-semibold text-slate-700 mb-1">Estimación de finalización por orden</h2>
      <p className="text-xs text-slate-400 mb-3">Basado en el orden de prioridad actual de la Cola de Producción. Es una proyección orientativa, no una fecha comprometida.</p>
      {selectedOrderIds.size === 0 ? (
        <p className="text-slate-400">No hay órdenes seleccionadas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-left">
                <th className="p-3 font-medium">N° OP</th>
                <th className="p-3 font-medium">Producto</th>
                <th className="p-3 font-medium">Sector limitante</th>
                <th className="p-3 font-medium text-center">Fin estimado</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter((o) => selectedOrderIds.has(o.id)).map((order) => {
                const est = orderEstimatedFinish(order)
                return (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium text-slate-700">#{order.order_number}</td>
                    <td className="p-3 text-slate-600">{order.products?.name}</td>
                    <td className="p-3 text-slate-600">{est ? est.limitingSector.name : <span className="text-emerald-600">Sin pendientes</span>}</td>
                    <td className="p-3 text-center text-slate-700 font-medium">{est ? shortDate(est.date) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: desglose por orden de un sector */}
      {sectorModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSectorModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">{sectorModal.sector.name}</h3>
                <p className="text-sm text-slate-500">{sectorModal.totalHoras} hs pendientes en total</p>
              </div>
              <button onClick={() => setSectorModal(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="space-y-2">
              {sectorModal.orders.map((r: any) => (
                <div key={r.order?.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2.5">
                  <span className="text-sm text-slate-700 truncate">#{r.order?.order_number} — {r.order?.products?.name}</span>
                  <span className="text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-full px-3 py-1 shrink-0">
                    {r.hours} hs
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => setSectorModal(null)} className="mt-5 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  )
}