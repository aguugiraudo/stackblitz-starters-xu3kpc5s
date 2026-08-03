'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function today() {
  return new Date().toISOString().split('T')[0]
}

function formatDateShort(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function PlanTurnosPage() {
  const [operators, setOperators] = useState<any[]>([])
  const [newOperatorName, setNewOperatorName] = useState('')

  const [sectors, setSectors] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [progressRows, setProgressRows] = useState<any[]>([])

  const [planDate, setPlanDate] = useState(today())
  const [tasks, setTasks] = useState<any[]>([])
  const [availability, setAvailability] = useState<Record<string, number>>({})

  const [fOperator, setFOperator] = useState('')
  const [fOperatorSearch, setFOperatorSearch] = useState('')
  const [showOperatorList, setShowOperatorList] = useState(false)
  const [fAvailableHours, setFAvailableHours] = useState('')
  const [fSector, setFSector] = useState('')
  const [fOrder, setFOrder] = useState('')
  const [fComponent, setFComponent] = useState('')
  const [fQuantity, setFQuantity] = useState('')

  const [loading, setLoading] = useState(true)

  async function fetchStatic() {
    const { data: opsData } = await supabase.from('operators').select('*').eq('active', true).order('full_name')
    setOperators(opsData || [])
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])
    const { data: ordersData } = await supabase
      .from('orders').select('id, order_number, products(name)').in('status', ['pending', 'in_progress'])
    setOrders(ordersData || [])

    const orderIds = (ordersData || []).map((o: any) => o.id)
    if (orderIds.length > 0) {
      const { data: progressData } = await supabase.from('order_progress_detail').select('*').in('order_id', orderIds)
      setProgressRows(progressData || [])
    }
  }

  async function fetchTasksAndAvailability() {
    const { data: taskData } = await supabase
      .from('operator_daily_tasks')
      .select('*, operators(full_name), orders(order_number, products(name)), sectors(name), components(name)')
      .eq('plan_date', planDate)
      .order('created_at')
    setTasks(taskData || [])

    const { data: availData } = await supabase
      .from('operator_daily_availability').select('*').eq('plan_date', planDate)
    const map: Record<string, number> = {}
    ;(availData || []).forEach((a: any) => { map[a.operator_id] = Number(a.hours_available) })
    setAvailability(map)
  }

  useEffect(() => {
    setLoading(true)
    fetchStatic().then(() => fetchTasksAndAvailability()).then(() => setLoading(false))
  }, [])

  useEffect(() => { fetchTasksAndAvailability() }, [planDate])

  async function addOperator() {
    if (!newOperatorName.trim()) return
    const { error } = await supabase.from('operators').insert({ full_name: newOperatorName.trim(), active: true })
    if (error) { alert('Error al agregar operario: ' + error.message); return }
    setNewOperatorName('')
    fetchStatic()
  }

  async function deactivateOperator(id: string) {
    if (!confirm('¿Dar de baja este operario?')) return
    await supabase.from('operators').update({ active: false }).eq('id', id)
    fetchStatic()
  }

  function selectOperator(op: any) {
    setFOperator(op.id); setFOperatorSearch(op.full_name); setShowOperatorList(false)
    setFAvailableHours(availability[op.id] != null ? String(availability[op.id]) : '')
  }

  async function saveAvailability() {
    if (!fOperator || !fAvailableHours) return
    const hrs = parseFloat(fAvailableHours)
    if (isNaN(hrs) || hrs <= 0) return
    await supabase.from('operator_daily_availability')
      .upsert({ operator_id: fOperator, plan_date: planDate, hours_available: hrs }, { onConflict: 'operator_id,plan_date' })
    fetchTasksAndAvailability()
  }

  const filteredOperators = fOperatorSearch.length > 0
    ? operators.filter((o) => o.full_name.toLowerCase().includes(fOperatorSearch.toLowerCase()))
    : operators

  const ordersForSector = fSector
    ? orders.filter((o) => progressRows.some((r) => r.order_id === o.id && r.sector_id === fSector && r.quantity_completed < r.quantity_required))
    : []

  const rowsForOrderSector = (fSector && fOrder)
    ? progressRows.filter((r) => r.order_id === fOrder && r.sector_id === fSector)
    : []
  const needsComponent = rowsForOrderSector.length > 1 || (rowsForOrderSector[0]?.target_type === 'component')
  const selectedRow = needsComponent
    ? rowsForOrderSector.find((r) => r.component_id === fComponent)
    : rowsForOrderSector[0]

  const alreadyProgrammedForThisRow = selectedRow
    ? tasks
        .filter((t) => t.order_id === fOrder && t.sector_id === fSector && (t.component_id || null) === (fComponent || null))
        .reduce((sum, t) => sum + t.target_quantity, 0)
    : 0

  const pendingForSelectedRow = selectedRow
    ? Math.max(0, selectedRow.quantity_required - selectedRow.quantity_completed - alreadyProgrammedForThisRow)
    : null

  const taskHours = (() => {
    const qty = parseInt(fQuantity || '0', 10)
    if (!selectedRow || !qty || selectedRow.standard_time_minutes <= 0) return null
    return Math.round(((qty * selectedRow.standard_time_minutes) / 60) * 100) / 100
  })()

  function hoursProgrammedFor(operatorId: string) {
    return tasks.filter((t) => t.operator_id === operatorId)
      .reduce((sum, t) => sum + Number(t.hours_assigned || 0), 0)
  }

  const hoursSoFar = fOperator ? hoursProgrammedFor(fOperator) : 0
  const availableForSelected = fOperator ? availability[fOperator] : undefined

  async function addTask() {
    if (!fOperator || !fSector || !fOrder || !fQuantity) {
      alert('Completá operario, sector, OP y cantidad.')
      return
    }
    if (needsComponent && !fComponent) {
      alert('Este sector tiene componentes — elegí cuál.')
      return
    }
    if (availability[fOperator] == null) {
      alert('Primero cargá las horas disponibles de este operario para esta fecha.')
      return
    }
    const qty = parseInt(fQuantity, 10)
    if (pendingForSelectedRow != null && qty > pendingForSelectedRow) {
      alert(`Esa OP solo tiene ${pendingForSelectedRow} unidades pendientes en este sector/componente (contando lo ya programado hoy).`)
      return
    }
    const { error } = await supabase.from('operator_daily_tasks').insert({
      operator_id: fOperator,
      plan_date: planDate,
      sector_id: fSector,
      order_id: fOrder,
      component_id: needsComponent ? fComponent : null,
      hours_assigned: taskHours ?? 0,
      target_quantity: qty,
      standard_time_minutes: selectedRow?.standard_time_minutes ?? null,
    })
    if (error) { alert('Error al asignar la tarea: ' + error.message); return }
    setFSector(''); setFOrder(''); setFComponent(''); setFQuantity('')
    fetchTasksAndAvailability(); fetchStatic()
  }

  async function saveActual(taskId: string, value: string) {
    const parsed = value === '' ? null : Math.max(0, parseInt(value, 10))
    await supabase.from('operator_daily_tasks').update({ actual_quantity: parsed }).eq('id', taskId)
    fetchTasksAndAvailability(); fetchStatic()
  }

  async function saveNotes(taskId: string, value: string) {
    await supabase.from('operator_daily_tasks').update({ notes: value || null }).eq('id', taskId)
    fetchTasksAndAvailability()
  }

  async function deleteTask(taskId: string) {
    if (!confirm('¿Eliminar esta tarea asignada?')) return
    await supabase.from('operator_daily_tasks').delete().eq('id', taskId)
    fetchTasksAndAvailability(); fetchStatic()
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  const tasksByOperator: Record<string, { id: string; tasks: any[] }> = {}
  tasks.forEach((t) => {
    const name = t.operators?.full_name || 'Sin asignar'
    if (!tasksByOperator[name]) tasksByOperator[name] = { id: t.operator_id, tasks: [] }
    tasksByOperator[name].tasks.push(t)
  })

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Turnos y Operarios</h1>
      <p className="text-sm text-slate-500 mb-6">Asigná tareas diarias por operario y registrá lo realmente producido.</p>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-slate-700 mb-3">Operarios</h2>
        <div className="flex gap-2 mb-3">
          <input placeholder="Nombre y apellido" value={newOperatorName} onChange={(e) => setNewOperatorName(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1" />
          <button onClick={addOperator} className="bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700">
            Agregar
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {operators.map((op) => (
            <span key={op.id} className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 rounded-full pl-3 pr-1 py-1 text-xs max-w-[220px]">
              <span className="truncate" title={op.full_name}>{op.full_name}</span>
              <button onClick={() => deactivateOperator(op.id)} className="text-slate-400 hover:text-rose-600 rounded-full w-4 h-4 flex items-center justify-center shrink-0">✕</button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-medium text-slate-700">Fecha a programar / cerrar</label>
        <input type="date" value={planDate} onChange={(e) => { setPlanDate(e.target.value); setFOperator(''); setFOperatorSearch('') }}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-slate-700 mb-3">Asignar tarea</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <div className="relative">
            <input
              placeholder="Buscar operario..."
              value={fOperatorSearch}
              onChange={(e) => { setFOperatorSearch(e.target.value); setFOperator(''); setShowOperatorList(true) }}
              onFocus={() => setShowOperatorList(true)}
              title={fOperatorSearch}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full truncate"
            />
            {showOperatorList && !fOperator && (
              <div className="absolute z-20 top-full mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                {filteredOperators.length === 0 ? (
                  <div className="p-2 text-xs text-slate-400">Sin resultados</div>
                ) : filteredOperators.map((op) => (
                  <div key={op.id} onClick={() => selectOperator(op)} title={op.full_name}
                    className="px-3 py-1.5 text-sm hover:bg-slate-100 cursor-pointer truncate">
                    {op.full_name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1">
            <input placeholder={`Horas disponibles el ${formatDateShort(planDate)}`} type="number" step={0.5} value={fAvailableHours}
              onChange={(e) => setFAvailableHours(e.target.value)}
              disabled={!fOperator}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1 disabled:bg-slate-50" />
            <button onClick={saveAvailability} disabled={!fOperator}
              className="text-xs bg-slate-700 text-white px-3 rounded-md hover:bg-slate-800 disabled:opacity-40">
              Guardar
            </button>
          </div>

          {fOperator && (
            <div className="flex items-center text-sm">
              <span className={`font-medium ${availableForSelected != null && hoursSoFar > availableForSelected ? 'text-rose-600' : 'text-slate-700'}`}>
                {hoursSoFar} / {availableForSelected ?? '—'} hs programadas ({formatDateShort(planDate)})
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
          <select value={fSector} onChange={(e) => { setFSector(e.target.value); setFOrder(''); setFComponent('') }}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm truncate">
            <option value="">Sector...</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <select value={fOrder} onChange={(e) => { setFOrder(e.target.value); setFComponent('') }} disabled={!fSector}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50 truncate">
            <option value="">OP pendiente...</option>
            {ordersForSector.map((o) => <option key={o.id} value={o.id}>#{o.order_number} — {o.products?.name}</option>)}
          </select>

          {needsComponent ? (
            <select value={fComponent} onChange={(e) => setFComponent(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm truncate">
              <option value="">Componente...</option>
              {rowsForOrderSector.map((r) => <option key={r.component_id} value={r.component_id}>{r.component_name}</option>)}
            </select>
          ) : <div />}

          <div>
            <input placeholder="Cantidad a programar" type="number" value={fQuantity}
              max={pendingForSelectedRow ?? undefined}
              onChange={(e) => setFQuantity(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
            {pendingForSelectedRow != null && (
              <p className="text-xs text-slate-400 mt-0.5">Pendiente: {pendingForSelectedRow} u.</p>
            )}
          </div>
        </div>

        {taskHours != null && (
          <p className="text-xs text-slate-500 mb-2">
            Esta tarea representa <strong className="text-slate-700">{taskHours} hs</strong>.
            {availableForSelected != null && (
              <> Total si la confirmás: <strong className={hoursSoFar + taskHours > availableForSelected ? 'text-rose-600' : 'text-slate-700'}>
                {Math.round((hoursSoFar + taskHours) * 100) / 100} / {availableForSelected} hs
              </strong>{hoursSoFar + taskHours > availableForSelected ? ' — supera la disponibilidad' : ''}.</>
            )}
          </p>
        )}

        <button onClick={addTask} className="mt-2 bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700">
          Asignar tarea
        </button>
      </div>

      <h2 className="font-semibold text-slate-700 mb-3">Tareas del {planDate}</h2>
      {Object.keys(tasksByOperator).length === 0 ? (
        <p className="text-slate-400">Todavía no hay tareas asignadas para esta fecha.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(tasksByOperator).map(([name, group]) => {
            const totalHours = hoursProgrammedFor(group.id)
            const avail = availability[group.id]
            return (
              <div key={name} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-slate-700 truncate" title={name}>{name}</p>
                  <p className={`text-xs shrink-0 ${avail != null && totalHours > avail ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
                    {totalHours} / {avail ?? '—'} hs programadas
                  </p>
                </div>

                {/* ===== VERSIÓN PC: tabla (visible desde md hacia arriba) ===== */}
                <table className="w-full text-sm table-fixed hidden md:table">
                  <thead>
                    <tr className="text-left text-slate-400 text-xs">
                      <th className="py-1 w-[120px]">Sector</th>
                      <th className="py-1">OP / Producto</th>
                      <th className="py-1 text-center w-[65px]">Objetivo</th>
                      <th className="py-1 text-center w-[65px]">Real</th>
                      <th className="py-1 w-[160px]">Obs.</th>
                      <th className="py-1 w-[55px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tasks.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100 align-top">
                        <td className="py-2">{t.sectors?.name}{t.components?.name ? ` — ${t.components.name}` : ''}</td>
                        <td className="py-2 leading-tight">
                          <div className="text-xs text-slate-400">#{t.orders?.order_number}</div>
                          <div className="text-slate-700">{t.orders?.products?.name}</div>
                        </td>
                        <td className="py-2 text-center font-medium">{t.target_quantity}</td>
                        <td className="py-2 text-center">
                          <input
                            type="number"
                            defaultValue={t.actual_quantity ?? ''}
                            placeholder="—"
                            onBlur={(e) => saveActual(t.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            className="w-16 text-center rounded-md border border-slate-300 py-1"
                          />
                        </td>
                        <td className="py-2">
                          <input
                            type="text"
                            defaultValue={t.notes ?? ''}
                            placeholder="Ej: reunión 20 min"
                            onBlur={(e) => saveNotes(t.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            className="w-full rounded-md border border-slate-300 py-1 px-2 text-xs"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button onClick={() => deleteTask(t.id)} className="text-xs text-rose-500 hover:underline">Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* ===== VERSIÓN CELULAR: tarjetas (visible solo debajo de md) ===== */}
                <div className="md:hidden grid grid-cols-1 gap-3">
                  {group.tasks.map((t) => (
                    <div key={t.id} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">{t.sectors?.name}{t.components?.name ? ` — ${t.components.name}` : ''}</p>
                          <p className="text-sm font-medium text-slate-700 break-words">
                            #{t.orders?.order_number} — {t.orders?.products?.name}
                          </p>
                        </div>
                        <button onClick={() => deleteTask(t.id)} className="text-xs text-rose-500 hover:underline shrink-0">Eliminar</button>
                      </div>

                      <div className="flex items-center gap-4 mb-2">
                        <div>
                          <p className="text-[10px] text-slate-400">Objetivo</p>
                          <p className="text-sm font-semibold text-slate-700">{t.target_quantity}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">Real</p>
                          <input
                            type="number"
                            defaultValue={t.actual_quantity ?? ''}
                            placeholder="—"
                            onBlur={(e) => saveActual(t.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            className="w-16 text-center rounded-md border border-slate-300 py-1 text-sm"
                          />
                        </div>
                      </div>

                      <input
                        type="text"
                        defaultValue={t.notes ?? ''}
                        placeholder="Obs. (ej: reunión 20 min)"
                        onBlur={(e) => saveNotes(t.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        className="w-full rounded-md border border-slate-300 py-1.5 px-2 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}