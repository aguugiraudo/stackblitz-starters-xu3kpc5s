'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from './components/AuthGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function SortableCard({ order, onEdit, onDelete, canEdit }: { order: any; onEdit: (o: any) => void; onDelete: (id: string) => void; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: order.id, disabled: !canEdit })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style}
      className="bg-white border border-slate-200 rounded-xl p-4 mb-3 shadow-sm flex items-start justify-between gap-3">
      <div {...(canEdit ? { ...attributes, ...listeners } : {})} className={`flex-1 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''}`}>
        <p className="text-xs font-semibold text-slate-400">N° OP {order.order_number}</p>
        <p className="text-lg font-semibold text-slate-800">{order.products?.name || 'Producto no encontrado'}</p>
        <p className="text-sm text-slate-500">Cliente: {order.client_name}</p>
        <p className="text-sm text-slate-500">Cantidad: {order.lot_quantity}</p>
        {order.notes && <p className="text-sm text-slate-400 italic mt-1">Obs: {order.notes}</p>}
      </div>
      {canEdit && (
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={() => onEdit(order)} className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-md hover:bg-slate-200">Editar</button>
          <button onClick={() => onDelete(order.id)} className="text-xs bg-rose-50 text-rose-600 px-3 py-1 rounded-md hover:bg-rose-100">Eliminar</button>
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const { role } = useAuth()
  const canEdit = role === 'perfil_1' || role === 'perfil_2'

  const [orders, setOrders] = useState<any[]>([])
  const [completedOrders, setCompletedOrders] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [orderNumber, setOrderNumber] = useState('')
  const [productId, setProductId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [clientName, setClientName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')

  const [editingOrder, setEditingOrder] = useState<any | null>(null)
  const [editOrderNumber, setEditOrderNumber] = useState('')
  const [editClientName, setEditClientName] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const [pendingManualComplete, setPendingManualComplete] = useState<{ id: string; order_number: string; avance: number | null } | null>(null)

  // Desglose Láser: se abre después de crear una OP
  const [laserModal, setLaserModal] = useState<{ productId: string; productName: string; qty: number; loteId: string | null } | null>(null)
  const [laserEspesores, setLaserEspesores] = useState<{ id: string | null; espesor_mm: string; nidos: { id: string | null; minutos: string }[] }[]>([])
  const [laserLoading, setLaserLoading] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor))

  async function fetchAll() {
    setLoading(true)
    const { data: activeData } = await supabase
      .from('orders').select('*, products(name)')
      .in('status', ['pending', 'in_progress'])
      .order('priority_rank', { ascending: true, nullsFirst: false })
    setOrders(activeData || [])

    const { data: completedData } = await supabase
      .from('orders').select('*, products(name)')
      .eq('status', 'completed').order('completed_at', { ascending: false })
    setCompletedOrders(completedData || [])

    const { data: productsData } = await supabase.from('products').select('id, code, name').order('name')
    setProducts(productsData || [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const filteredProducts = productSearch.length > 0
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : products

  function selectProduct(p: any) {
    setProductId(p.id); setProductSearch(p.name); setShowSuggestions(false)
  }

  async function handleCreateOrder(e: any) {
    e.preventDefault()
    if (!orderNumber || !productId || !clientName || !quantity) {
      alert('Completá N° OP, Producto (elegilo de la lista), Cliente y Cantidad.')
      return
    }
    const maxRank = orders.length > 0 ? Math.max(...orders.map((o) => o.priority_rank ?? 0)) : 0
    const { error } = await supabase.from('orders').insert({
      order_number: orderNumber, product_id: productId, client_name: clientName,
      lot_quantity: parseInt(quantity, 10), notes: notes || null,
      status: 'pending', priority_rank: maxRank + 1,
    })
    if (error) { alert('Error al crear la OP: ' + error.message); return }

    const createdProductName = productSearch
    const createdQty = parseInt(quantity, 10)
    setOrderNumber(''); setProductId(''); setProductSearch(''); setClientName(''); setQuantity(''); setNotes('')
    fetchAll()
    openLaserBreakdown(productId, createdProductName, createdQty)
  }

  // Abre el desglose láser para Producto+Cantidad: si ya existe uno guardado, lo trae precargado; si no, arranca vacío.
  async function openLaserBreakdown(prodId: string, prodName: string, qty: number) {
    setLaserLoading(true)
    setLaserModal({ productId: prodId, productName: prodName, qty, loteId: null })
    setLaserEspesores([])

    const { data: lote } = await supabase
      .from('laser_lotes').select('id').eq('product_id', prodId).eq('lote_qty', qty).maybeSingle()

    if (lote) {
      const { data: espesores } = await supabase
        .from('laser_espesores').select('*').eq('laser_lote_id', lote.id).order('espesor_mm')
      const loaded = []
      for (const esp of espesores || []) {
        const { data: nidos } = await supabase
          .from('laser_nidos').select('*').eq('laser_espesor_id', esp.id).order('numero')
        loaded.push({
          id: esp.id,
          espesor_mm: String(esp.espesor_mm),
          nidos: (nidos || []).map((n: any) => ({ id: n.id, minutos: String(n.standard_time_minutes) })),
        })
      }
      setLaserEspesores(loaded)
      setLaserModal((prev) => prev && { ...prev, loteId: lote.id })
    } else {
      setLaserEspesores([{ id: null, espesor_mm: '', nidos: [{ id: null, minutos: '' }] }])
    }
    setLaserLoading(false)
  }

  function addEspesorRow() {
    setLaserEspesores((prev) => [...prev, { id: null, espesor_mm: '', nidos: [{ id: null, minutos: '' }] }])
  }

  function removeEspesorRow(index: number) {
    setLaserEspesores((prev) => prev.filter((_, i) => i !== index))
  }

  function updateEspesorMm(index: number, value: string) {
    setLaserEspesores((prev) => prev.map((e, i) => (i === index ? { ...e, espesor_mm: value } : e)))
  }

  function addNidoRow(espesorIndex: number) {
    setLaserEspesores((prev) => prev.map((e, i) =>
      i === espesorIndex ? { ...e, nidos: [...e.nidos, { id: null, minutos: '' }] } : e
    ))
  }

  function removeNidoRow(espesorIndex: number, nidoIndex: number) {
    setLaserEspesores((prev) => prev.map((e, i) =>
      i === espesorIndex ? { ...e, nidos: e.nidos.filter((_, ni) => ni !== nidoIndex) } : e
    ))
  }

  function updateNidoMinutos(espesorIndex: number, nidoIndex: number, value: string) {
    setLaserEspesores((prev) => prev.map((e, i) =>
      i === espesorIndex ? { ...e, nidos: e.nidos.map((n, ni) => (ni === nidoIndex ? { ...n, minutos: value } : n)) } : e
    ))
  }

  async function saveLaserBreakdown() {
    if (!laserModal) return
    setLaserLoading(true)

    let loteId = laserModal.loteId
    if (!loteId) {
      const { data, error } = await supabase.from('laser_lotes')
        .insert({ product_id: laserModal.productId, lote_qty: laserModal.qty })
        .select().single()
      if (error) { alert('Error al guardar el lote: ' + error.message); setLaserLoading(false); return }
      loteId = data.id
    }

    // Reemplazo completo: se borran los espesores existentes (arrastra los nidos) y se recargan desde el formulario
    await supabase.from('laser_espesores').delete().eq('laser_lote_id', loteId)

    for (const esp of laserEspesores) {
      if (!esp.espesor_mm) continue
      const { data: espData, error: espErr } = await supabase.from('laser_espesores')
        .insert({ laser_lote_id: loteId, espesor_mm: parseFloat(esp.espesor_mm) })
        .select().single()
      if (espErr) continue

      const nidosToInsert = esp.nidos
        .filter((n) => n.minutos)
        .map((n, i) => ({ laser_espesor_id: espData.id, numero: i + 1, standard_time_minutes: parseFloat(n.minutos) }))
      if (nidosToInsert.length > 0) {
        await supabase.from('laser_nidos').insert(nidosToInsert)
      }
    }

    setLaserLoading(false)
    setLaserModal(null)
  }

  function skipLaserBreakdown() {
    setLaserModal(null)
  }

  async function handleDragEnd(event: any) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orders.findIndex((o) => o.id === active.id)
    const newIndex = orders.findIndex((o) => o.id === over.id)
    const reordered = arrayMove(orders, oldIndex, newIndex)
    setOrders(reordered)
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('orders').update({ priority_rank: i + 1 }).eq('id', reordered[i].id)
    }
  }

  // Ahora, en vez de completar directo, abre el cartel de confirmación
  async function askComplete(order: any) {
    const { data } = await supabase
      .from('order_weighted_progress')
      .select('avance_percent')
      .eq('order_id', order.id)
      .maybeSingle()
    setPendingManualComplete({
      id: order.id,
      order_number: order.order_number,
      avance: data?.avance_percent ?? null,
    })
  }

  async function confirmManualComplete() {
    if (!pendingManualComplete) return
    const { error } = await supabase.from('orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', pendingManualComplete.id)
    if (error) { alert('Error al completar la OP: ' + error.message); return }
    setPendingManualComplete(null)
    fetchAll()
  }

  function openEdit(order: any) {
    setEditingOrder(order)
    setEditOrderNumber(order.order_number)
    setEditClientName(order.client_name)
    setEditNotes(order.notes || '')
  }

  async function saveEdit() {
    if (!editingOrder) return
    const { error } = await supabase.from('orders').update({
      order_number: editOrderNumber, client_name: editClientName, notes: editNotes || null,
    }).eq('id', editingOrder.id)
    if (error) { alert('Error al guardar: ' + error.message); return }
    setEditingOrder(null)
    fetchAll()
  }

  async function handleDelete(orderId: string) {
    if (!confirm('¿Eliminar esta OP? Esta acción no se puede deshacer.')) return
    const { error } = await supabase.from('orders').delete().eq('id', orderId)
    if (error) { alert('Error al eliminar: ' + error.message); return }
    fetchAll()
  }

  async function handleReopen(orderId: string) {
    if (!confirm('¿Reabrir esta OP? Va a volver a la Cola de Producción.')) return
    const { error } = await supabase.from('orders').update({ status: 'in_progress', completed_at: null }).eq('id', orderId)
    if (error) { alert('Error al reabrir: ' + error.message); return }
    fetchAll()
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Cola de Producción</h1>
      <p className="text-sm text-slate-500 mb-6">Cargá y priorizá las órdenes de producción activas.</p>

      {!canEdit && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
          Modo solo lectura — no tenés permisos para editar este módulo.
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleCreateOrder} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-8">
          <h2 className="font-semibold text-slate-700 mb-3">Nueva Orden de Producción</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input placeholder="N° OP" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <div className="relative">
              <input
                placeholder="Buscar producto..."
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setProductId(''); setShowSuggestions(true) }}
                onFocus={() => setShowSuggestions(true)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full"
              />
              {showSuggestions && productSearch.length > 0 && !productId && (
                <div className="absolute z-20 top-full mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-2 text-xs text-slate-400">Sin resultados</div>
                  ) : filteredProducts.map((p) => (
                    <div key={p.id} onClick={() => selectProduct(p)} className="px-3 py-1.5 text-sm hover:bg-slate-100 cursor-pointer">
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input placeholder="Cantidad" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input placeholder="Cliente" value={clientName} onChange={(e) => setClientName(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input placeholder="Obs (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
            Agregar a la Cola
          </button>
        </form>
      )}

      <h2 className="font-semibold text-slate-700 mb-3">Cola de Producción{canEdit ? ' — arrastrá para priorizar' : ''}</h2>
      {loading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : orders.length === 0 ? (
        <p className="text-slate-400 mb-8">No hay órdenes en curso todavía.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orders.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <div className="mb-8">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center gap-2">
                  <div className="flex-1"><SortableCard order={order} onEdit={openEdit} onDelete={handleDelete} canEdit={canEdit} /></div>
                  {canEdit && (
                    <button onClick={() => askComplete(order)}
                      className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 mb-3">
                      Completar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <h2 className="font-semibold text-slate-700 mb-3 mt-10 border-t pt-6">Historial de Órdenes Completadas</h2>
      {completedOrders.length === 0 ? (
        <p className="text-slate-400">Todavía no hay órdenes completadas.</p>
      ) : (
        <div>
          {completedOrders.map((order) => (
            <div key={order.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400">N° OP {order.order_number} — completada el {new Date(order.completed_at).toLocaleDateString()}</p>
                <p className="font-medium text-slate-700">{order.products?.name}</p>
                <p className="text-sm text-slate-500">Cliente: {order.client_name} — Cantidad: {order.lot_quantity}</p>
                {order.notes && <p className="text-sm italic text-slate-400">Obs: {order.notes}</p>}
              </div>
              {canEdit && (
                <button onClick={() => handleReopen(order.id)} className="text-xs bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-300 shrink-0">
                  Reabrir
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODAL de edición */}
      {editingOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingOrder(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-1">Editar Orden</h3>
            <p className="text-xs text-slate-400 mb-4">Producto y cantidad no se pueden editar acá — si necesitás cambiarlos, eliminá esta OP y creá una nueva.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">N° OP</label>
                <input value={editOrderNumber} onChange={(e) => setEditOrderNumber(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Cliente</label>
                <input value={editClientName} onChange={(e) => setEditClientName(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Obs</label>
                <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditingOrder(null)} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={saveEdit} className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL de confirmación al completar manualmente */}
      {pendingManualComplete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPendingManualComplete(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 text-lg mb-2">¿Completar esta OP?</h3>
            <p className="text-sm text-slate-500 mb-2">
              La orden <strong>#{pendingManualComplete.order_number}</strong> tiene actualmente
              {' '}
              <strong className={pendingManualComplete.avance != null && pendingManualComplete.avance < 100 ? 'text-amber-600' : 'text-slate-700'}>
                {pendingManualComplete.avance != null ? `${pendingManualComplete.avance}%` : 'sin datos'} de avance
              </strong>.
            </p>
            {pendingManualComplete.avance != null && pendingManualComplete.avance < 100 && (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
                Ojo: todavía no llegó al 100%. Si la marcás como completada igual, va a salir de la Cola de Producción y de Turnos y Operarios.
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setPendingManualComplete(null)} className="flex-1 border border-slate-300 rounded-md py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={confirmManualComplete} className="flex-1 bg-emerald-600 text-white rounded-md py-2 text-sm font-medium hover:bg-emerald-700">
                Sí, completar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Desglose Láser al crear una OP nueva */}
      {laserModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
            <div className="mb-4">
              <h3 className="font-semibold text-slate-800 text-lg">Desglose Láser</h3>
              <p className="text-sm text-slate-500">
                {laserModal.productName} — lote de {laserModal.qty} u.
              </p>
              {laserModal.loteId && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 mt-2 inline-block">
                  Ya existía un desglose guardado para este producto y esta cantidad — lo trajimos precargado, podés editarlo.
                </p>
              )}
            </div>

            {laserLoading ? (
              <p className="text-sm text-slate-400">Cargando...</p>
            ) : (
              <div className="space-y-4">
                {laserEspesores.map((esp, espIndex) => (
                  <div key={espIndex} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <label className="text-xs text-slate-500 shrink-0">Espesor</label>
                      <input
                        type="number" step={0.1} placeholder="Ej: 3.2"
                        value={esp.espesor_mm}
                        onChange={(e) => updateEspesorMm(espIndex, e.target.value)}
                        className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-24"
                      />
                      <span className="text-xs text-slate-400">mm</span>
                      <button onClick={() => removeEspesorRow(espIndex)} className="ml-auto text-xs text-rose-500 hover:underline">
                        Quitar espesor
                      </button>
                    </div>

                    <p className="text-xs text-slate-500 mb-2">Nidos (una chapa por nido, con su tiempo de corte)</p>
                    <div className="space-y-2">
                      {esp.nidos.map((nido, nidoIndex) => (
                        <div key={nidoIndex} className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 w-14 shrink-0">Nido {nidoIndex + 1}</span>
                          <input
                            type="number" placeholder="Minutos"
                            value={nido.minutos}
                            onChange={(e) => updateNidoMinutos(espIndex, nidoIndex, e.target.value)}
                            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-28"
                          />
                          <span className="text-xs text-slate-400">min</span>
                          {nido.minutos && (
                            <span className="text-xs text-slate-400 italic">
                              → "Nido {nidoIndex + 1} ({nido.minutos} min)"
                            </span>
                          )}
                          <button onClick={() => removeNidoRow(espIndex, nidoIndex)} className="ml-auto text-xs text-rose-500 hover:underline shrink-0">
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addNidoRow(espIndex)} className="mt-2 text-xs text-blue-600 hover:underline">
                      + Agregar nido (otra chapa) a este espesor
                    </button>
                  </div>
                ))}

                <button onClick={addEspesorRow} className="w-full text-sm text-slate-600 border border-dashed border-slate-300 rounded-md py-2 hover:bg-slate-50">
                  + Agregar otro espesor
                </button>
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button onClick={skipLaserBreakdown} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">
                Omitir por ahora
              </button>
              <button onClick={saveLaserBreakdown} disabled={laserLoading} className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                Guardar desglose
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}