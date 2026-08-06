'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../components/AuthGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function currentMonthValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

function mondaysInMonth(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1)
  const last = new Date(year, monthIndex + 1, 0)
  const mondays: Date[] = []
  const d = new Date(first)
  while (d <= last) {
    if (d.getDay() === 1) mondays.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return mondays
}

function shortDate(iso: string) {
  return iso.split('-').reverse().slice(0, 2).join('/')
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default function RendimientoPage() {
  const { role } = useAuth()
  const canEdit = role === 'perfil_1'

  const [monthValue, setMonthValue] = useState(currentMonthValue())
  const [operators, setOperators] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [exceptions, setExceptions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingBonus, setEditingBonus] = useState<string | null>(null)
  const [weekModalInfo, setWeekModalInfo] = useState<{ operatorId: string; operatorName: string; monday: Date } | null>(null)
  const [monthModalOperator, setMonthModalOperator] = useState<any | null>(null)
  const [dayModalInfo, setDayModalInfo] = useState<{ operatorId: string; operatorName: string; date: string } | null>(null)
  const [exceptionReason, setExceptionReason] = useState('')

  const [bonusSettingsId, setBonusSettingsId] = useState<string | null>(null)
  const [targetPercent, setTargetPercent] = useState(95)
  const [editingTarget, setEditingTarget] = useState(false)

  const [year, monthNum] = monthValue.split('-').map(Number)
  const monthIndex = monthNum - 1
  const mondays = mondaysInMonth(year, monthIndex)
  const rangeStart = mondays.length > 0 ? toISO(mondays[0]) : toISO(new Date(year, monthIndex, 1))
  const rangeEndDate = mondays.length > 0 ? new Date(mondays[mondays.length - 1]) : new Date(year, monthIndex, 1)
  rangeEndDate.setDate(rangeEndDate.getDate() + 6)
  const rangeEnd = toISO(rangeEndDate)

  async function fetchAll() {
    setLoading(true)
    const { data: opsData } = await supabase.from('operators').select('*').eq('active', true).order('full_name')
    setOperators(opsData || [])

    const { data: taskData } = await supabase
      .from('operator_daily_tasks')
      .select('*, orders(order_number, products(name)), sectors(name), components(name)')
      .gte('plan_date', rangeStart)
      .lte('plan_date', rangeEnd)
    setTasks(taskData || [])

    const { data: excData } = await supabase
      .from('bonus_week_exceptions')
      .select('*')
      .gte('week_monday', rangeStart)
      .lte('week_monday', rangeEnd)
    setExceptions(excData || [])

    const { data: settingsData } = await supabase.from('bonus_settings').select('*').limit(1).maybeSingle()
    if (settingsData) {
      setBonusSettingsId(settingsData.id)
      setTargetPercent(Number(settingsData.target_percent))
    }

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [monthValue])

  function weekDates(monday: Date) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return toISO(d)
    })
  }

  function dayStatus(operatorId: string, date: string) {
    const dayTasks = tasks.filter((t) => t.operator_id === operatorId && t.plan_date === date)
    if (dayTasks.length === 0) return null
    const anyPending = dayTasks.some((t) => t.actual_quantity == null)
    if (anyPending) return 'pending'
    const targetMin = dayTasks.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const realMin = dayTasks.reduce((s, t) => s + (t.actual_quantity || 0) * (t.standard_time_minutes || 0), 0)
    return realMin >= targetMin ? 'met' : 'not-met'
  }

  function findException(operatorId: string, monday: Date) {
    return exceptions.find((e) => e.operator_id === operatorId && e.week_monday === toISO(monday))
  }

  function naturalWeekStatus(operatorId: string, monday: Date) {
    const dates = weekDates(monday)
    const statuses = dates.map((d) => dayStatus(operatorId, d)).filter((s) => s !== null)
    if (statuses.length === 0) return 'no-work'
    if (statuses.includes('pending')) return 'pending'
    if (statuses.includes('not-met')) return 'not-met'
    return 'met'
  }

  function effectiveWeekStatus(operatorId: string, monday: Date) {
    const exc = findException(operatorId, monday)
    if (exc) return 'exception'
    return naturalWeekStatus(operatorId, monday)
  }

  async function saveMonthlyBonus(operatorId: string, value: string) {
    const parsed = parseFloat(value || '0')
    await supabase.from('operators').update({ weekly_bonus_amount: parsed }).eq('id', operatorId)
    setEditingBonus(null)
    fetchAll()
  }

  async function saveTargetPercent(value: string) {
    const parsed = parseFloat(value || '0')
    setTargetPercent(parsed)
    setEditingTarget(false)
    if (bonusSettingsId) {
      await supabase.from('bonus_settings').update({ target_percent: parsed }).eq('id', bonusSettingsId)
    } else {
      const { data } = await supabase.from('bonus_settings').insert({ target_percent: parsed }).select().single()
      if (data) setBonusSettingsId(data.id)
    }
  }

  async function approveException() {
    if (!weekModalInfo || !exceptionReason.trim()) {
      alert('Escribí un motivo para la excepción.')
      return
    }
    const { error } = await supabase.from('bonus_week_exceptions').insert({
      operator_id: weekModalInfo.operatorId,
      week_monday: toISO(weekModalInfo.monday),
      reason: exceptionReason.trim(),
    })
    if (error) { alert('Error al guardar la excepción: ' + error.message); return }
    setExceptionReason('')
    fetchAll()
  }

  async function removeException(exceptionId: string) {
    if (!confirm('¿Quitar esta excepción? La semana volverá a contar según el resultado real.')) return
    await supabase.from('bonus_week_exceptions').delete().eq('id', exceptionId)
    fetchAll()
  }

  function statusBadge(status: string, clickable = true, size: 'sm' | 'md' = 'md') {
    const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'
    const base = `inline-flex items-center justify-center ${sizeClass} rounded-full font-bold transition ${
      clickable ? 'cursor-pointer hover:ring-2 hover:ring-offset-1' : ''
    }`
    if (status === 'met') return <span className={`${base} bg-emerald-100 text-emerald-700 hover:ring-emerald-300`}>✓</span>
    if (status === 'exception') return <span className={`${base} bg-blue-100 text-blue-700 hover:ring-blue-300`} title="Excepción aprobada">★</span>
    if (status === 'not-met') return <span className={`${base} bg-rose-100 text-rose-700 hover:ring-rose-300`}>✕</span>
    if (status === 'pending') return <span className={`${base} bg-amber-100 text-amber-700 hover:ring-amber-300`}>⏳</span>
    return <span className={`${base} bg-slate-100 text-slate-300 hover:ring-slate-200`}>—</span>
  }

  function monthSummary(operatorId: string) {
    const monthDates = mondays.flatMap((m) => weekDates(m)).filter((d) => {
      const dd = new Date(d)
      return dd.getMonth() === monthIndex
    })
    const monthTasks = tasks.filter((t) => t.operator_id === operatorId && monthDates.includes(t.plan_date))

    const daysWorked = new Set(monthTasks.map((t) => t.plan_date)).size
    const objetivoMin = monthTasks.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const closedTasks = monthTasks.filter((t) => t.actual_quantity != null)
    const realMin = closedTasks.reduce((s, t) => s + (t.actual_quantity || 0) * (t.standard_time_minutes || 0), 0)
    const objetivoMinClosed = closedTasks.reduce((s, t) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
    const cumplimientoPct = objetivoMinClosed > 0 ? Math.round((realMin / objetivoMinClosed) * 1000) / 10 : null

    const weekStatuses = mondays.map((m) => effectiveWeekStatus(operatorId, m))
    const weeksMet = weekStatuses.filter((s) => s === 'met' || s === 'exception').length

    return { daysWorked, objetivoHoras: Math.round((objetivoMin / 60) * 10) / 10, realHoras: Math.round((realMin / 60) * 10) / 10, cumplimientoPct, weeksMet, totalWeeks: mondays.length }
  }

  if (loading) return <main className="p-6 text-slate-500">Cargando...</main>

  const weekModalDates = weekModalInfo ? weekDates(weekModalInfo.monday) : []
  const weekModalException = weekModalInfo ? findException(weekModalInfo.operatorId, weekModalInfo.monday) : null
  const weekModalNaturalStatus = weekModalInfo ? naturalWeekStatus(weekModalInfo.operatorId, weekModalInfo.monday) : null

  const monthLabel = `${MONTH_NAMES[monthIndex]} ${year}`
  const monthSum = monthModalOperator ? monthSummary(monthModalOperator.id) : null
  const dayModalTasks = dayModalInfo ? tasks.filter((t) => t.operator_id === dayModalInfo.operatorId && t.plan_date === dayModalInfo.date) : []

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Rendimiento de Operarios</h1>
      <p className="text-sm text-slate-500 mb-1">Premio mensual por cumplimiento de producción.</p>
      <p className="text-xs text-slate-400 mb-6">Click en el nombre para ver el mes completo. Click en una semana o un día para ver el detalle.</p>

      {!canEdit && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
          Modo solo lectura — no tenés permisos para editar este módulo.
        </div>
      )}

      <div className="flex items-center gap-6 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Mes</label>
          <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">% objetivo para cobrar</label>
          {canEdit ? (
            editingTarget ? (
              <input
                type="number"
                defaultValue={targetPercent}
                autoFocus
                onBlur={(e) => saveTargetPercent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="w-20 text-center rounded-md border border-slate-300 py-1"
              />
            ) : (
              <button onClick={() => setEditingTarget(true)} className="text-sm font-semibold text-slate-700 border border-slate-300 rounded-md px-3 py-1 hover:bg-slate-50">
                {targetPercent}%
              </button>
            )
          ) : (
            <span className="text-sm font-semibold text-slate-700">{targetPercent}%</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
        <table className="text-sm border-collapse table-fixed w-full">
          <colgroup>
            <col style={{ width: '190px' }} />
            {mondays.map((_, i) => <col key={i} style={{ width: '70px' }} />)}
            <col style={{ width: '100px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '120px' }} />
          </colgroup>
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="p-3 font-medium text-left">Operario</th>
              {mondays.map((m, i) => (
                <th key={i} className="p-2 font-medium text-center border-l border-slate-700">
                  <div>Sem. {i + 1}</div>
                  <div className="text-[10px] font-normal text-slate-400">{shortDate(toISO(m))}</div>
                </th>
              ))}
              <th className="p-3 font-medium text-center border-l border-slate-700">Cumplim. mes</th>
              <th className="p-3 font-medium text-center">Premio mensual</th>
              <th className="p-3 font-medium text-center">Premio a cobrar</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((op) => {
              const weekStatuses = mondays.map((m) => effectiveWeekStatus(op.id, m))
              const monthSum = monthSummary(op.id)
              const cumplimiento = monthSum.cumplimientoPct
              const meetsTarget = cumplimiento != null && cumplimiento >= targetPercent
              const premioACobrar = meetsTarget ? Number(op.weekly_bonus_amount || 0) : 0

              return (
                <tr key={op.id} className="border-t border-slate-100">
                  <td className="p-3">
                    <button onClick={() => setMonthModalOperator(op)} className="font-medium text-slate-700 hover:text-blue-600 hover:underline truncate block w-full text-left" title={op.full_name}>
                      {op.full_name}
                    </button>
                  </td>
                  {mondays.map((m, i) => (
                    <td key={i} className="p-2 text-center border-l border-slate-100">
                      <button onClick={() => { setWeekModalInfo({ operatorId: op.id, operatorName: op.full_name, monday: m }); setExceptionReason('') }}>
                        {statusBadge(weekStatuses[i], true, 'sm')}
                      </button>
                    </td>
                  ))}
                  <td className={`p-3 text-center border-l border-slate-100 font-semibold ${
                    cumplimiento == null ? 'text-slate-300' : meetsTarget ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {cumplimiento != null ? `${cumplimiento}%` : '—'}
                  </td>
                  <td className="p-3 text-center">
                    {canEdit ? (
                      editingBonus === op.id ? (
                        <input
                          type="number"
                          defaultValue={op.weekly_bonus_amount}
                          autoFocus
                          onBlur={(e) => saveMonthlyBonus(op.id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          className="w-24 text-center rounded-md border border-slate-300 py-1"
                        />
                      ) : (
                        <button onClick={() => setEditingBonus(op.id)} className="text-slate-600 hover:underline">
                          ${Number(op.weekly_bonus_amount || 0).toLocaleString('es-AR')}
                        </button>
                      )
                    ) : (
                      <span className="text-slate-500">
                        ${Number(op.weekly_bonus_amount || 0).toLocaleString('es-AR')}
                      </span>
                    )}
                  </td>
                  <td className={`p-3 text-center font-semibold ${meetsTarget ? 'text-emerald-700' : 'text-slate-400'}`}>
                    ${premioACobrar.toLocaleString('es-AR')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">{statusBadge('met', false, 'sm')} Día cumplido</span>
        <span className="flex items-center gap-1.5">{statusBadge('exception', false, 'sm')} Excepción aprobada</span>
        <span className="flex items-center gap-1.5">{statusBadge('not-met', false, 'sm')} No cumplida</span>
        <span className="flex items-center gap-1.5">{statusBadge('pending', false, 'sm')} Falta cerrar días</span>
        <span className="flex items-center gap-1.5">{statusBadge('no-work', false, 'sm')} Sin tareas esa semana</span>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        El premio ya no se calcula por semana: es un único premio mensual que se cobra completo si el Cumplimiento del mes llega al {targetPercent}% o más. Las semanas siguen mostrándose como resumen visual del avance.
      </p>

      {weekModalInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setWeekModalInfo(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">{weekModalInfo.operatorName}</h3>
                <p className="text-sm text-slate-500">Semana del {shortDate(toISO(weekModalInfo.monday))}</p>
              </div>
              <button onClick={() => setWeekModalInfo(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
              {weekModalDates.map((d, i) => {
                const status = dayStatus(weekModalInfo.operatorId, d)
                const dayTasks = tasks.filter((t) => t.operator_id === weekModalInfo.operatorId && t.plan_date === d)
                return (
                  <button key={d} onClick={() => setDayModalInfo({ operatorId: weekModalInfo.operatorId, operatorName: weekModalInfo.operatorName, date: d })}
                    className="w-full text-left border-b border-slate-100 pb-2 hover:bg-slate-50 rounded px-1 -mx-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{DAY_LABELS[i]} {shortDate(d)}</p>
                        <p className="text-xs text-slate-400">{dayTasks.length} tarea(s)</p>
                      </div>
                      {statusBadge(status || 'no-work', false)}
                    </div>
                  </button>
                )
              })}
            </div>

            {weekModalException ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-medium text-blue-700 mb-1">★ Excepción aprobada</p>
                <p className="text-sm text-slate-700 mb-2">"{weekModalException.reason}"</p>
                {canEdit && (
                  <button onClick={() => removeException(weekModalException.id)} className="text-xs text-rose-500 hover:underline">
                    Quitar excepción
                  </button>
                )}
              </div>
            ) : weekModalNaturalStatus === 'not-met' && canEdit ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">Esta semana no se cumplió automáticamente. Si corresponde una excepción, escribí el motivo:</p>
                <textarea
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  placeholder="Ej: reunión de personal, se descontaron 20 minutos"
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-2"
                  rows={2}
                />
                <button onClick={approveException} className="w-full bg-blue-600 text-white rounded-md py-1.5 text-sm font-medium hover:bg-blue-700">
                  Aprobar excepción (cuenta como cumplida)
                </button>
              </div>
            ) : null}

            <button onClick={() => setWeekModalInfo(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {monthModalOperator && monthSum && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setMonthModalOperator(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <h3 className="font-semibold text-slate-800 text-lg">{monthModalOperator.full_name}</h3>
                <p className="text-sm text-slate-500">Resumen de {monthLabel}</p>
              </div>
              <button onClick={() => setMonthModalOperator(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Días trabajados</p>
                <p className="text-xl font-semibold text-slate-700">{monthSum.daysWorked}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Cumplimiento del mes</p>
                <p className={`text-xl font-semibold ${monthSum.cumplimientoPct == null ? 'text-slate-400' : monthSum.cumplimientoPct >= targetPercent ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {monthSum.cumplimientoPct != null ? `${monthSum.cumplimientoPct}%` : '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Horas objetivo / reales</p>
                <p className="text-xl font-semibold text-slate-700">{monthSum.objetivoHoras} / {monthSum.realHoras}</p>
              </div>
              <div className={`rounded-lg p-3 ${monthSum.cumplimientoPct != null && monthSum.cumplimientoPct >= targetPercent ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                <p className={`text-xs ${monthSum.cumplimientoPct != null && monthSum.cumplimientoPct >= targetPercent ? 'text-emerald-600' : 'text-slate-400'}`}>Premio del mes</p>
                <p className={`text-xl font-semibold ${monthSum.cumplimientoPct != null && monthSum.cumplimientoPct >= targetPercent ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {monthSum.cumplimientoPct != null && monthSum.cumplimientoPct >= targetPercent
                    ? `$${Number(monthModalOperator.weekly_bonus_amount || 0).toLocaleString('es-AR')}`
                    : '$0'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {monthSum.cumplimientoPct != null && monthSum.cumplimientoPct >= targetPercent
                    ? `Superó el objetivo de ${targetPercent}%`
                    : `No llegó al objetivo de ${targetPercent}%`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {mondays.map((m, i) => {
                const status = effectiveWeekStatus(monthModalOperator.id, m)
                const dates = weekDates(m)
                return (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">Semana {i + 1} — {shortDate(toISO(m))}</p>
                      {statusBadge(status, false, 'sm')}
                    </div>
                    <div className="flex gap-1">
                      {dates.map((d, di) => {
                        const dStatus = dayStatus(monthModalOperator.id, d)
                        return (
                          <button key={d}
                            onClick={() => setDayModalInfo({ operatorId: monthModalOperator.id, operatorName: monthModalOperator.full_name, date: d })}
                            className="flex-1 flex flex-col items-center gap-0.5"
                          >
                            <span className="text-[9px] text-slate-400">{DAY_LABELS[di]}</span>
                            {statusBadge(dStatus || 'no-work', true, 'sm')}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <button onClick={() => setMonthModalOperator(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL: detalle de un día puntual (Programado vs Real + resumen de horas/cumplimiento) */}
      {dayModalInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setDayModalInfo(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">{dayModalInfo.operatorName}</h3>
                <p className="text-sm text-slate-500">{shortDate(dayModalInfo.date)}</p>
              </div>
              <button onClick={() => setDayModalInfo(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {dayModalTasks.length === 0 ? (
              <p className="text-sm text-slate-400">Sin tareas asignadas este día.</p>
            ) : (
              <>
                {(() => {
                  const hoursAssigned = dayModalTasks.reduce((s: number, t: any) => s + Number(t.hours_assigned || 0), 0)
                  const targetMin = dayModalTasks.reduce((s: number, t: any) => s + t.target_quantity * (t.standard_time_minutes || 0), 0)
                  const anyPending = dayModalTasks.some((t: any) => t.actual_quantity == null)
                  const realMin = dayModalTasks.reduce((s: number, t: any) => s + (t.actual_quantity != null ? t.actual_quantity * (t.standard_time_minutes || 0) : 0), 0)
                  const cumplimiento = !anyPending && targetMin > 0 ? Math.round((realMin / targetMin) * 1000) / 10 : null
                  return (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-400">Horas programadas</p>
                        <p className="text-lg font-semibold text-slate-700">{hoursAssigned}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-400">Cumplimiento del día</p>
                        <p className={`text-lg font-semibold ${cumplimiento == null ? 'text-slate-400' : cumplimiento >= 100 ? 'text-emerald-600' : cumplimiento >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {cumplimiento != null ? `${cumplimiento}%` : 'sin cerrar'}
                        </p>
                      </div>
                    </div>
                  )
                })()}

                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {dayModalTasks.map((t: any) => {
                    const met = t.actual_quantity != null && t.actual_quantity >= t.target_quantity
                    return (
                      <div key={t.id} className="border border-slate-200 rounded-lg p-3">
                        <p className="text-xs text-slate-400">{t.sectors?.name}{t.components?.name ? ` — ${t.components.name}` : ''}</p>
                        <p className="text-sm text-slate-700 font-medium">#{t.orders?.order_number} — {t.orders?.products?.name}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm">
                          <span className="text-slate-500">Programado: <strong className="text-slate-700">{t.target_quantity}</strong></span>
                          <span className="text-slate-500">Real: <strong className={t.actual_quantity == null ? 'text-amber-600' : met ? 'text-emerald-600' : 'text-rose-600'}>
                            {t.actual_quantity != null ? t.actual_quantity : 'sin cerrar'}
                          </strong></span>
                        </div>
                        {t.notes && <p className="text-xs text-slate-500 italic mt-2">"{t.notes}"</p>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <button onClick={() => setDayModalInfo(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  )
}