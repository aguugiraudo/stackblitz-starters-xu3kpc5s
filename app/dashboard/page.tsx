'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function currentMonthValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const CATEGORY_COLORS: Record<string, string> = {
  ESTUFAS: 'bg-orange-100 text-orange-700',
  FOGONEROS: 'bg-red-100 text-red-700',
  HORNOS: 'bg-purple-100 text-purple-700',
  'ACCESORIOS FOGONEROS': 'bg-slate-200 text-slate-700',
  OTROS: 'bg-slate-100 text-slate-500',
}

export default function DashboardPage() {
  const [monthValue, setMonthValue] = useState(currentMonthValue())
  const [rows, setRows] = useState<any[]>([])
  const [serviceRows, setServiceRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [year, monthNum] = monthValue.split('-').map(Number)
  const monthStart = `${monthValue}-01`
  const nextMonth = new Date(year, monthNum, 1)
  const monthEnd = nextMonth.toISOString().split('T')[0]

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('embalaje_production')
      .select('*')
      .gte('plan_date', monthStart)
      .lt('plan_date', monthEnd)
    setRows(data || [])

    const { data: svc } = await supabase
      .from('service_tasks')
      .select('*, sectors(name)')
      .gte('plan_date', monthStart)
      .lt('plan_date', monthEnd)
    setServiceRows(svc || [])

    setLoading(false)
  }

  useEffect(() => { fetchData() }, [monthValue])

  const byCategory: Record<string, { qty: number; revenue: number; hasPrice: boolean; products: Record<string, number> }> = {}
  rows.forEach((r) => {
    const cat = r.category || 'OTROS'
    if (!byCategory[cat]) byCategory[cat] = { qty: 0, revenue: 0, hasPrice: false, products: {} }
    byCategory[cat].qty += r.actual_quantity
    if (r.price != null) {
      byCategory[cat].revenue += r.actual_quantity * Number(r.price)
      byCategory[cat].hasPrice = true
    }
    byCategory[cat].products[r.product_name] = (byCategory[cat].products[r.product_name] || 0) + r.actual_quantity
  })

  const totalUnits = rows.reduce((s, r) => s + r.actual_quantity, 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.price != null ? r.actual_quantity * Number(r.price) : 0), 0)
  const anyPriceSet = rows.some((r) => r.price != null)

  // Servicios (categoría 'servicio') y 5S (categoría '5s') se muestran por separado
  const serviceOnlyRows = serviceRows.filter((r) => r.category !== '5s')
  const fiveSRows = serviceRows.filter((r) => r.category === '5s')

  const totalServiceHours = serviceOnlyRows.reduce((s, r) => s + Number(r.hours_assigned || 0), 0)
  const totalServiceQty = serviceOnlyRows.reduce((s, r) => s + (r.quantity_services || 0), 0)
  const bySectorServices: Record<string, { hours: number; qty: number }> = {}
  serviceOnlyRows.forEach((r) => {
    const sec = r.sectors?.name || 'Sin sector'
    if (!bySectorServices[sec]) bySectorServices[sec] = { hours: 0, qty: 0 }
    bySectorServices[sec].hours += Number(r.hours_assigned || 0)
    bySectorServices[sec].qty += r.quantity_services || 0
  })

  const total5SHours = fiveSRows.reduce((s, r) => s + Number(r.hours_assigned || 0), 0)
  const bySector5S: Record<string, number> = {}
  fiveSRows.forEach((r) => {
    const sec = r.sectors?.name || 'Sin sector'
    bySector5S[sec] = (bySector5S[sec] || 0) + Number(r.hours_assigned || 0)
  })

  const categories = Object.keys(byCategory).sort((a, b) => byCategory[b].qty - byCategory[a].qty)

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Dashboard</h1>
      <p className="text-sm text-slate-500 mb-6">Producción del mes, por categoría de producto.</p>

      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm font-medium text-slate-700">Mes</label>
        <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <p className="text-sm text-slate-500">Total producido este mes</p>
          <p className="text-3xl font-semibold text-slate-800 mt-1">{totalUnits} <span className="text-base font-normal text-slate-400">productos</span></p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <p className="text-sm text-slate-500">Valor de producción {anyPriceSet ? '' : '(cargá precios en el Catálogo)'}</p>
          <p className="text-3xl font-semibold text-emerald-700 mt-1">
            {anyPriceSet ? `$${totalRevenue.toLocaleString('es-AR')}` : '—'}
          </p>
        </div>
      </div>

      {rows.length === 0 && serviceRows.length === 0 ? (
        <p className="text-slate-500">No hay actividad registrada este mes todavía.</p>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const info = byCategory[cat]
            const productNames = Object.keys(info.products).sort((a, b) => info.products[b] - info.products[a])
            return (
              <div key={cat} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.OTROS}`}>
                    {cat}
                  </span>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-slate-800">{info.qty} unidades</p>
                    {info.hasPrice && (
                      <p className="text-sm text-emerald-700">${info.revenue.toLocaleString('es-AR')}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {productNames.map((name) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{name}</span>
                      <span className="text-slate-500">{info.products[name]} u.</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Categoría SERVICIOS — horas, no unidades */}
          {serviceOnlyRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                  SERVICIOS
                </span>
                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-800">{totalServiceHours} hs</p>
                  {totalServiceQty > 0 && <p className="text-sm text-slate-500">{totalServiceQty} servicios</p>}
                </div>
              </div>
              <div className="space-y-1">
                {Object.entries(bySectorServices).map(([sector, info]) => (
                  <div key={sector} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{sector}</span>
                    <span className="text-slate-500">{info.hours} hs{info.qty > 0 ? ` — ${info.qty} servicios` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Categoría 5S — horas dedicadas a mejora continua */}
          {fiveSRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  5S
                </span>
                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-800">{total5SHours} hs</p>
                </div>
              </div>
              <div className="space-y-1">
                {Object.entries(bySector5S).map(([sector, hours]) => (
                  <div key={sector} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{sector}</span>
                    <span className="text-slate-500">{hours} hs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  )
}