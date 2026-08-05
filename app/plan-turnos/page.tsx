'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../components/AuthGate'

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

const SERVICE_VALUE = '__SERVICIO__'

export default function PlanTurnosPage() {
  const { role } = useAuth()
  const canEdit = role === 'perfil_1' || role === 'perfil_2'

  const [operators, setOperators] = useState<any[]>([])
  const [newOperatorName, setNewOperatorName] = useState('')

  const [sectors, setSectors] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [progressRows, setProgressRows] = useState<any[]>([])

  const [planDate, setPlanDate] = useState(today())
  const [tasks, setTasks] = useState<any[]>([])
  const [serviceTasks, setServiceTasks] = useState<any[]>([])
  const [availability, setAvailability] = useState<Record<string, number>>({})

  const [fOperator, setFOperator] = useState('')
  const [fOperatorSearch, setFOperatorSearch] = useState('')
  const [showOperatorList, setShowOperatorList] = useState(false)
  const [fAvailableHours, setFAvailableHours] = useState('')
  const [fSector, setFSector] = useState('')
  const [fOrder, setFOrder] = useState('') // puede ser un id de OP, o SERVICE_VALUE
  const [fComponent, setFComponent] = useState('')
  const [fQuantity, setFQuantity] = useState('')

  const [fServiceHours, setFServiceHours] = useState('')
  const [fServiceQty, setFServiceQty] = useState('')
  const [fServiceNotes, setFServiceNotes] = useState('')

  const [clockTask, setClockTask] = useState<any | null>(null)
  const [clockStart, setClockStart] = useState('')
  const [clockEnd, setClockEnd] = useState('')
  const [clockResult, setClockResult] = useState<{ type: 'ok' | 'more' | 'less'; diffPerUnit: number; newMinutes: number } | null>(null)

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

    const { data: serviceData } = await supabase
      .from('service_tasks')
      .select('*, operators(full_name), sectors(name)')
      .eq('plan_date', planDate)
      .order('created_at')
    setServiceTasks(serviceData || [])

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

  const isService = fOrder === SERVICE_VALUE

  const ordersForSector = fSector
    ? orders.filter((o) => progressRows.some((r) => r.order_id === o.id && r.sector_id === fSector && r.quantity_completed < r.quantity_required))
    : []

  const rowsForOrderSector = (fSector && fOrder && !isService)
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
    const opHours = tasks.filter((t) => t.operator_id === operatorId)
      .reduce((sum, t) => sum + Number(t.hours_assigned || 0), 0)
    const svcHours = serviceTasks.filter((t) => t.operator_id === operatorId)
      .reduce((sum, t) => sum + Number(t.hours_assigned || 0), 0)
    return Math.round((opHours + svcHours) * 100) / 100
  }

  const hoursSoFar = fOperator ? hoursProgrammedFor(fOperator) : 0
  const availableForSelected = fOperator ? availability[fOperator] : undefined

  function resetForm() {
    setFSector(''); setFOrder(''); setFComponent(''); setFQuantity('')
    setFServiceHours(''); setFServiceQty(''); setFServiceNotes('')
  }

  async function handleAssign() {
    if (!fOperator || !fSector || !fOrder) {
      alert('Completá operario, sector y elegí una OP o Servicio.')
      return
    }
    if (availability[fOperator] == null) {
      alert('Primero cargá las horas disponibles de este operario para esta fecha.')
      return
    }

    if (isService) {
      if (!fServiceHours) {
        alert('Completá las horas dedicadas al servicio.')
        return
      }
      const { error } = await supabase.from('service_tasks').insert({
        operator_id: fOperator,
        plan_date: planDate,
        sector_id: fSector,
        hours_assigned: parseFloat(fServiceHours),
        quantity_services: fServiceQty ? parseInt(fServiceQty, 10) : null,
        notes: fServiceNotes || null,
      })
      if (error) { alert('Error al asignar el servicio: ' + error.message); return }
    } else {
      if (!fQuantity) {
        alert('Completá la cantidad a programar.')
        return
      }
      if (needsComponent && !fComponent) {
        alert('Este sector tiene componentes — elegí cuál.')
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
        catalog_time_id: selectedRow?.catalog_time_id ?? null,
      })
      if (error) { alert('Error al asignar la tarea: ' + error.message); return }
    }

    resetForm()
    fetchTasksAndAvailability(); fetchStatic()
  }

  async function deleteServiceTask(id: string) {
    if (!confirm('¿Eliminar este servicio asignado?')) return
    await supabase.from('service_tasks').delete().eq('id', id)
    fetchTasksAndAvailability()
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

  function openClock(task: any) {
    setClockTask(task)
    setClockStart(task.actual_start_time ? task.actual_start_time.slice(0, 5) : '')
    setClockEnd(task.actual_end_time ? task.actual_end_time.slice(0, 5) : '')
    setClockResult(null)
  }

  function closeClock() {
    setClockTask(null)
    setClockResult(null)
  }

  async function computeClock() {
    if (!clockTask || !clockStart || !clockEnd) {
      alert('Completá hora de inicio y hora de fin.')
      return
    }
    if (clockTask.actual_quantity == null || clockTask.actual_quantity <= 0) {
      alert('Primero cargá la cantidad Real de esta tarea.')
      return
    }
    const [sh, sm] = clockStart.split(':').map(Number)
    const [eh, em] = clockEnd.split(':').map(Number)
    const startMin = sh * 60 + sm
    const endMin = eh * 60 + em
    const duration = endMin - startMin
    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la de inicio.')
      return
    }

    await supabase.from('operator_daily_tasks').update({
      actual_start_time: clockStart, actual_end_time: clockEnd,
    }).eq('id', clockTask.id)

    const perUnit = duration / clockTask.actual_quantity
    const standard = clockTask.standard_time_minutes || 0
    const diff = perUnit - standard
    const tolerance = Math.max(0.3, standard * 0.05)

    if (Math.abs(diff) <= tolerance) {
      setClockResult({ type: 'ok', diffPerUnit: 0, newMinutes: perUnit })
    } else if (diff > 0) {
      setClockResult({ type: 'more', diffPerUnit: Math.round(diff * 10) / 10, newMinutes: Math.round(perUnit * 10) / 10 })
    } else {
      setClockResult({ type: 'less', diffPerUnit: Math.round(Math.abs(diff) * 10) / 10, newMinutes: Math.round(perUnit * 10) / 10 })
    }

    fetchTasksAndAvailability()
  }

  async function confirmTimeUpdate() {
    if (!clockTask || !clockResult || !clockTask.catalog_time_id) {
      alert('No se pudo identificar el tiempo estándar a actualizar.')
      return
    }
    const oldMinutes = clockTask.standard_time_minutes
    const newMinutes = clockResult.newMinutes

    const { error: e1 } = await supabase.from('catalog_times')
      .update({ standard_time_minutes: newMinutes })
      .eq('id', clockTask.catalog_time_id)
    if (e1) { alert('Error al actualizar el tiempo: ' + e1.message); return }

    await supabase.from('standard_time_updates').insert({
      catalog_time_id: clockTask.catalog_time_id,
      task_id: clockTask.id,
      operator_id: clockTask.operator_id,
      old_minutes: oldMinutes,
      new_minutes: newMinutes,
    })

    closeClock()
    fetchStatic(); fetchTasksAndAvailability()
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  const tasksByOperator: Record<string, { id: string; tasks: any[]; services: any[] }> = {}
  tasks.forEach((t) => {
    const name = t.operators?.full_name || 'Sin asignar'
    if (!tasksByOperator[name]) tasksByOperator[name] = { id: t.operator_id, tasks: [], services: [] }
    tasksByOperator[name].tasks.push(t)
  })
  serviceTasks.forEach((t) => {
    const name = t.operators?.full_name || 'Sin asignar'
    if (!tasksByOperator[name]) tasksByOperator[name] = { id: t.operator_id, tasks: [], services: [] }
    tasksByOperator[name].services.push(t)
  })

  const ClockButton = ({ t }: { t: any }) => (
    canEdit ? (
      <button onClick={() => openClock(t)} title="Registrar hora de inicio/fin"
        className={`text-sm ${t.actual_start_time ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'}`}>
        🕐
      </button>
    ) : (
      <span title="Hora de inicio/fin" className={`text-sm ${t.actual_start_time ? 'text-blue-600' : 'text-slate-300'}`}>
        🕐
      </span>
    )
  )

  return (
    <main className="p-4 md:p-6 max-w-6xl mx-auto overflow-x-hidden">
      <h1 className="text-xl md:text-2xl font-semibold text-slate-800 mb-1">Turnos y Operarios</h1>
      <p className="text-sm text-slate-500 mb-6">Asigná tareas diarias por operario y registrá lo realmente producido.</p>

      {!canEdit && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
          Modo solo lectura — no tenés permisos para editar este módulo.
        </div>
      )}

      {canEdit && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-5 mb-6">
          <h2 className="font-semibold text-slate-700 mb-3">Operarios</h2>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <input placeholder="Nombre y apellido" value={newOperatorName} onChange={(e) => setNewOperatorName(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-0" />
            <button onClick={addOperator} className="bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700 shrink-0">
              Agregar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {operators.map((op) => (
              <span key={op.id} className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 rounded-full pl-3 pr-1 py-1 text-xs max-w-full sm:max-w-[220px]">
                <span className="truncate" title={op.full_name}>{op.full_name}</span>
                <button onClick={() => deactivateOperator(op.id)} className="text-slate-400 hover:text-rose-600 rounded-full w-4 h-4 flex items-center justify-center shrink-0">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-medium text-slate-700">Fecha</label>
        <input type="date" value={planDate} onChange={(e) => { setPlanDate(e.target.value); setFOperator(''); setFOperatorSearch('') }}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
      </div>

      {canEdit && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-5 mb-6">
          <h2 className="font-semibold text-slate-700 mb-3">Asignar tarea</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="relative min-w-0">
              <input
                placeholder="Buscar operario..."
                value={fOperatorSearch}
                onChange={(e) => { setFOperatorSearch(e.target.value); setFOperator(''); setShowOperatorList(true) }}
                onFocus={() => setShowOperatorList(true)}
                title={fOperatorSearch}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full min-w-0 truncate"
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

            <div className="flex gap-1 min-w-0">
              <input placeholder={`Hs disponibles el ${formatDateShort(planDate)}`} type="number" step={0.5} value={fAvailableHours}
                onChange={(e) => setFAvailableHours(e.target.value)}
                disabled={!fOperator}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-0 disabled:bg-slate-50" />
              <button onClick={saveAvailability} disabled={!fOperator}
                className="text-xs bg-slate-700 text-white px-3 rounded-md hover:bg-slate-800 disabled:opacity-40 shrink-0">
                Guardar
              </button>
            </div>

            {fOperator && (
              <div className="flex items-center text-sm min-w-0">
                <span className={`font-medium ${availableForSelected != null && hoursSoFar > availableForSelected ? 'text-rose-600' : 'text-slate-700'}`}>
                  {hoursSoFar} / {availableForSelected ?? '—'} hs programadas
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <select value={fSector} onChange={(e) => { setFSector(e.target.value); setFOrder(''); setFComponent('') }}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm min-w-0 truncate w-full">
              <option value="">Sector...</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <select
              value={fOrder}
              onChange={(e) => { setFOrder(e.target.value); setFComponent('') }}
              disabled={!fSector}
              className={`border rounded-md px-2 py-1.5 text-sm disabled:bg-slate-50 min-w-0 truncate w-full ${
                isService ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-slate-300'
              }`}
            >
              <option value="">OP / Servicio...</option>
              <option value={SERVICE_VALUE}>🔧 Servicio (sin OP)</option>
              {ordersForSector.length > 0 && (
                <optgroup label="Órdenes pendientes">
                  {ordersForSector.map((o) => <option key={o.id} value={o.id}>#{o.order_number} — {o.products?.name}</option>)}
                </optgroup>
              )}
            </select>

            {!isService && needsComponent ? (
              <select value={fComponent} onChange={(e) => setFComponent(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm min-w-0 truncate w-full">
                <option value="">Componente...</option>
                {rowsForOrderSector.map((r) => <option key={r.component_id} value={r.component_id}>{r.component_name}</option>)}
              </select>
            ) : !isService ? <div className="hidden md:block" /> : null}

            {isService ? (
              <input placeholder="Horas dedicadas" type="number" step={0.5} value={fServiceHours}
                onChange={(e) => setFServiceHours(e.target.value)} className="border border-blue-300 rounded-md px-2 py-1.5 text-sm w-full min-w-0" />
            ) : (
              <div className="min-w-0">
                <input placeholder="Cantidad a programar" type="number" value={fQuantity}
                  max={pendingForSelectedRow ?? undefined}
                  onChange={(e) => setFQuantity(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full min-w-0" />
                {pendingForSelectedRow != null && (
                  <p className="text-xs text-slate-400 mt-0.5">Pendiente: {pendingForSelectedRow} u.</p>
                )}
              </div>
            )}
          </div>

          {isService && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
              <input placeholder="Cantidad de servicios (opcional)" type="number" value={fServiceQty}
                onChange={(e) => setFServiceQty(e.target.value)} className="border border-blue-200 rounded-md px-2 py-1.5 text-sm w-full min-w-0" />
              <input placeholder="Obs. (opcional)" value={fServiceNotes} onChange={(e) => setFServiceNotes(e.target.value)}
                className="border border-blue-200 rounded-md px-2 py-1.5 text-sm w-full min-w-0" />
            </div>
          )}

          {!isService && taskHours != null && (
            <p className="text-xs text-slate-500 mb-2">
              Esta tarea representa <strong className="text-slate-700">{taskHours} hs</strong>.
              {availableForSelected != null && (
                <> Total si la confirmás: <strong className={hoursSoFar + taskHours > availableForSelected ? 'text-rose-600' : 'text-slate-700'}>
                  {Math.round((hoursSoFar + taskHours) * 100) / 100} / {availableForSelected} hs
                </strong>{hoursSoFar + taskHours > availableForSelected ? ' — supera la disponibilidad' : ''}.</>
              )}
            </p>
          )}
          {isService && fServiceHours && availableForSelected != null && (
            <p className="text-xs text-slate-500 mb-2">
              Total si confirmás: <strong className={hoursSoFar + parseFloat(fServiceHours || '0') > availableForSelected ? 'text-rose-600' : 'text-slate-700'}>
                {Math.round((hoursSoFar + parseFloat(fServiceHours || '0')) * 100) / 100} / {availableForSelected} hs
              </strong>
            </p>
          )}

          <button onClick={handleAssign} className={`mt-2 w-full sm:w-auto text-white px-4 py-2 rounded-md text-sm font-medium ${
            isService ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}>
            {isService ? 'Asignar servicio' : 'Asignar tarea'}
          </button>
        </div>
      )}

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
                <div className="flex items-center justify-between mb-2 gap-2">
                  <p className="font-semibold text-slate-700 truncate min-w-0" title={name}>{name}</p>
                  <p className={`text-xs shrink-0 ${avail != null && totalHours > avail ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
                    {totalHours} / {avail ?? '—'} hs programadas
                  </p>
                </div>

                {group.tasks.length > 0 && (
                  <>
                    <table className="w-full text-sm table-fixed hidden md:table mb-2">
                      <thead>
                        <tr className="text-left text-slate-400 text-xs">
                          <th className="py-1 w-[120px]">Sector</th>
                          <th className="py-1">OP / Producto</th>
                          <th className="py-1 text-center w-[65px]">Objetivo</th>
                          <th className="py-1 text-center w-[80px]">Real</th>
                          <th className="py-1 w-[150px]">Obs.</th>
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
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  defaultValue={t.actual_quantity ?? ''}
                                  placeholder="—"
                                  onBlur={(e) => saveActual(t.id, e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  disabled={!canEdit}
                                  className="w-14 text-center rounded-md border border-slate-300 py-1 disabled:bg-slate-50 disabled:text-slate-400"
                                />
                                <ClockButton t={t} />
                              </div>
                            </td>
                            <td className="py-2">
                              <input
                                type="text"
                                defaultValue={t.notes ?? ''}
                                placeholder="Ej: reunión 20 min"
                                onBlur={(e) => saveNotes(t.id, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                disabled={!canEdit}
                                className="w-full rounded-md border border-slate-300 py-1 px-2 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            </td>
                            <td className="py-2 text-right">
                              {canEdit && (
                                <button onClick={() => deleteTask(t.id)} className="text-xs text-rose-500 hover:underline">Eliminar</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="md:hidden flex flex-col gap-3 mb-2">
                      {group.tasks.map((t) => (
                        <div key={t.id} className="border border-slate-200 rounded-lg p-3 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-400">{t.sectors?.name}{t.components?.name ? ` — ${t.components.name}` : ''}</p>
                              <p className="text-sm font-medium text-slate-700 break-words">
                                #{t.orders?.order_number} — {t.orders?.products?.name}
                              </p>
                            </div>
                            {canEdit && (
                              <button onClick={() => deleteTask(t.id)} className="text-xs text-rose-500 hover:underline shrink-0">Eliminar</button>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mb-2">
                            <div>
                              <p className="text-[10px] text-slate-400">Objetivo</p>
                              <p className="text-sm font-semibold text-slate-700">{t.target_quantity}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">Real</p>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  defaultValue={t.actual_quantity ?? ''}
                                  placeholder="—"
                                  onBlur={(e) => saveActual(t.id, e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  disabled={!canEdit}
                                  className="w-14 text-center rounded-md border border-slate-300 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                                />
                                <ClockButton t={t} />
                              </div>
                            </div>
                          </div>
                          <input
                            type="text"
                            defaultValue={t.notes ?? ''}
                            placeholder="Obs. (ej: reunión 20 min)"
                            onBlur={(e) => saveNotes(t.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            disabled={!canEdit}
                            className="w-full rounded-md border border-slate-300 py-1.5 px-2 text-xs min-w-0 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {group.services.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-blue-600 mb-1.5">Servicios</p>
                    <div className="flex flex-col gap-2">
                      {group.services.map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm text-slate-700">
                              {s.sectors?.name} — <strong>{s.hours_assigned} hs</strong>
                              {s.quantity_services != null && ` — ${s.quantity_services} servicios`}
                            </p>
                            {s.notes && <p className="text-xs text-slate-500 italic">"{s.notes}"</p>}
                          </div>
                          {canEdit && (
                            <button onClick={() => deleteServiceTask(s.id)} className="text-xs text-rose-500 hover:underline shrink-0">Eliminar</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {clockTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeClock}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">Registrar horario</h3>
                <p className="text-xs text-slate-500">{clockTask.sectors?.name}{clockTask.components?.name ? ` — ${clockTask.components.name}` : ''}</p>
              </div>
              <button onClick={closeClock} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {!clockResult ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-slate-500">Hora inicio</label>
                    <input type="time" value={clockStart} onChange={(e) => setClockStart(e.target.value)}
                      className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Hora fin</label>
                    <input type="time" value={clockEnd} onChange={(e) => setClockEnd(e.target.value)}
                      className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
                  </div>
                </div>
                <button onClick={computeClock} className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700">
                  Calcular
                </button>
              </>
            ) : clockResult.type === 'ok' ? (
              <div className="text-center">
                <p className="text-sm text-slate-600 mb-4">El tiempo real está en línea con el tiempo estándar. Sin novedad.</p>
                <button onClick={closeClock} className="w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
                  Cerrar
                </button>
              </div>
            ) : clockResult.type === 'more' ? (
              <div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
                  Tardó <strong>{clockResult.diffPerUnit} min más</strong> por pieza de lo estimado.
                </div>
                <button onClick={closeClock} className="w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
                  Cerrar
                </button>
              </div>
            ) : (
              <div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 text-sm text-emerald-800">
                  {clockTask.operators?.full_name} tardó <strong>{clockResult.diffPerUnit} min menos</strong> por pieza de lo registrado.
                  ¿Actualizar el tiempo estándar a {clockResult.newMinutes} min?
                </div>
                <div className="flex gap-2">
                  <button onClick={closeClock} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">
                    No, dejar igual
                  </button>
                  <button onClick={confirmTimeUpdate} className="flex-1 bg-emerald-600 text-white rounded-md py-2 text-sm font-medium hover:bg-emerald-700">
                    Sí, actualizar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}