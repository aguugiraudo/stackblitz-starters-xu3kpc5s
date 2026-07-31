'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function SortableCard({ order, onEdit, onDelete }: { order: any; onEdit: (o: any) => void; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: order.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style}
      className="bg-white border border-slate-200 rounded-xl p-4 mb-3 shadow-sm flex items-start justify-between gap-3">
      <div {...attributes} {...listeners} className="flex-1 cursor-grab active:cursor-grabbing">
        <p className="text-xs font-semibold text-slate-400">N° OP {order.order_number}</p>
        <p className="text-lg font-semibold text-slate-800">{order.products?.name || 'Producto no encontrado'}</p>
        <p className="text-sm text-slate-500">Cliente: {order.client_name}</p>
        <p className="text-sm text-slate-500">Cantidad: {order.lot_quantity}</p>
        {order.notes && <p className="text-sm text-slate-400 italic mt-1">Obs: {order.notes}</p>}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button onClick={() => onEdit(order)} className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-md hover:bg-slate-200">Editar</button>
        <button onClick={() => onDelete(order.id)} className="text-xs bg-rose-50 text-rose-600 px-3 py-1 rounded-md hover:bg-rose-100">Eliminar</button>
      </div>
    </div>
  )
}

export default function Home() {
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
    setOrderNumber(''); setProductId(''); setProductSearch(''); setClientName(''); setQuantity(''); setNotes('')
    fetchAll()
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

  async function handleComplete(orderId: string) {
    const { error } = await supabase.from('orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', orderId)
    if (error) { alert('Error al completar la OP: ' + error.message); return }
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

      <h2 className="font-semibold text-slate-700 mb-3">Cola de Producción — arrastrá para priorizar</h2>
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
                  <div className="flex-1"><SortableCard order={order} onEdit={openEdit} onDelete={handleDelete} /></div>
                  <button onClick={() => handleComplete(order.id)}
                    className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 mb-3">
                    Completar
                  </button>
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
              <button onClick={() => handleReopen(order.id)} className="text-xs bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-300 shrink-0">
                Reabrir
              </button>
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
    </main>
  )
}