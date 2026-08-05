'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../components/AuthGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CatalogoProductosPage() {
  const { role } = useAuth()
  const canEdit = role === 'perfil_1'

  const [products, setProducts] = useState<any[]>([])
  const [sectors, setSectors] = useState<any[]>([])
  const [matrix, setMatrix] = useState<any[]>([])

  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)

  const [productTimes, setProductTimes] = useState<any[]>([])
  const [components, setComponents] = useState<any[]>([])
  const [componentTimes, setComponentTimes] = useState<any[]>([])

  const [newProductCode, setNewProductCode] = useState('')
  const [newProductName, setNewProductName] = useState('')
  const [showNewProduct, setShowNewProduct] = useState(false)

  const [emptySectorInput, setEmptySectorInput] = useState<Record<string, string>>({})
  const [modalSector, setModalSector] = useState<{ id: string; name: string } | null>(null)
  const [newComponentName, setNewComponentName] = useState('')
  const [newComponentQty, setNewComponentQty] = useState('1')
  const [newComponentTime, setNewComponentTime] = useState('')

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const [timeHistoryModal, setTimeHistoryModal] = useState<{ catalogTimeId: string; entries: any[] } | null>(null)

  const [loading, setLoading] = useState(true)

  async function fetchOverview() {
    const { data: productsData } = await supabase.from('products').select('*').order('name')
    setProducts(productsData || [])
    const { data: sectorsData } = await supabase.from('sectors').select('*').order('sequence_no')
    setSectors(sectorsData || [])
    const { data: matrixData } = await supabase.from('product_sector_times').select('*')
    setMatrix(matrixData || [])
  }

  async function fetchProductDetail(productId: string) {
    const { data: timesData } = await supabase
      .from('catalog_times').select('*').eq('target_type', 'product').eq('product_id', productId)
    setProductTimes(timesData || [])

    const { data: compsData } = await supabase
      .from('components').select('*').eq('product_id', productId).order('name')
    setComponents(compsData || [])

    const compIds = (compsData || []).map((c: any) => c.id)
    if (compIds.length > 0) {
      const { data: compTimesData } = await supabase
        .from('catalog_times').select('*').eq('target_type', 'component').in('component_id', compIds)
      setComponentTimes(compTimesData || [])
    } else {
      setComponentTimes([])
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchOverview().then(() => setLoading(false))
  }, [])

  async function selectProduct(p: any) {
    setSelectedProduct(p)
    setLoading(true)
    await fetchProductDetail(p.id)
    setLoading(false)
  }

  function backToMatrix() {
    setSelectedProduct(null)
    fetchOverview()
  }

  const filteredProducts = search.length > 0
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.code.includes(search))
    : products

  async function createProduct() {
    if (!newProductCode.trim() || !newProductName.trim()) {
      alert('Completá código y nombre.')
      return
    }
    const { error } = await supabase.from('products').insert({ code: newProductCode.trim(), name: newProductName.trim() })
    if (error) { alert('Error al crear el producto: ' + error.message); return }
    setNewProductCode(''); setNewProductName(''); setShowNewProduct(false)
    fetchOverview()
  }

  function openDeleteModal() {
    setDeleteConfirmText('')
    setShowDeleteModal(true)
  }

  async function confirmDeleteProduct() {
    if (!selectedProduct) return
    if (deleteConfirmText.trim() !== selectedProduct.name) return
    const { error } = await supabase.from('products').delete().eq('id', selectedProduct.id)
    if (error) {
      alert('No se pudo eliminar: probablemente ya tiene Órdenes de Producción creadas. Detalle: ' + error.message)
      return
    }
    setShowDeleteModal(false)
    setSelectedProduct(null)
    fetchOverview()
  }

  async function saveCategory(value: string) {
    if (!selectedProduct) return
    await supabase.from('products').update({ category: value || 'OTROS' }).eq('id', selectedProduct.id)
    setSelectedProduct({ ...selectedProduct, category: value || 'OTROS' })
  }

  async function savePrice(value: string) {
    if (!selectedProduct) return
    const val = value ? parseFloat(value) : null
    await supabase.from('products').update({ price: val }).eq('id', selectedProduct.id)
    setSelectedProduct({ ...selectedProduct, price: val })
  }

  function sectorInfo(sectorId: string) {
    const productRow = productTimes.find((t) => t.sector_id === sectorId)
    const compRows = componentTimes.filter((t) => t.sector_id === sectorId)
    return { productRow, compRows }
  }

  async function saveProductTime(sectorId: string, existingId: string | null, minutes: number) {
    if (!selectedProduct) return
    if (existingId) {
      await supabase.from('catalog_times').update({ standard_time_minutes: minutes }).eq('id', existingId)
    } else {
      await supabase.from('catalog_times').insert({
        sector_id: sectorId, target_type: 'product', product_id: selectedProduct.id, standard_time_minutes: minutes,
      })
    }
    fetchProductDetail(selectedProduct.id)
  }

  async function saveComponentTime(rowId: string, minutes: number) {
    await supabase.from('catalog_times').update({ standard_time_minutes: minutes }).eq('id', rowId)
    if (selectedProduct) fetchProductDetail(selectedProduct.id)
  }

  async function saveComponentQty(componentId: string, qty: number) {
    await supabase.from('components').update({ qty_per_product: qty }).eq('id', componentId)
    if (selectedProduct) fetchProductDetail(selectedProduct.id)
  }

  async function addComponent() {
    if (!selectedProduct || !modalSector) return
    if (!newComponentName.trim() || !newComponentTime) {
      alert('Completá nombre y tiempo del componente.')
      return
    }
    const codeSlug = newComponentName.trim().toUpperCase().replace(/\s+/g, '-') + '-' + Date.now().toString().slice(-4)
    const { data: comp, error: e1 } = await supabase.from('components').insert({
      product_id: selectedProduct.id, code: codeSlug, name: newComponentName.trim(),
      qty_per_product: parseFloat(newComponentQty || '1'),
    }).select().single()
    if (e1) { alert('Error al crear el componente: ' + e1.message); return }

    await supabase.from('catalog_times').insert({
      sector_id: modalSector.id, target_type: 'component', component_id: comp.id,
      standard_time_minutes: parseFloat(newComponentTime),
    })

    setNewComponentName(''); setNewComponentQty('1'); setNewComponentTime('')
    fetchProductDetail(selectedProduct.id)
  }

  async function openTimeHistory(catalogTimeId: string) {
    const { data } = await supabase
      .from('standard_time_updates')
      .select('*, operators(full_name)')
      .eq('catalog_time_id', catalogTimeId)
      .order('created_at', { ascending: false })
    setTimeHistoryModal({ catalogTimeId, entries: data || [] })
  }

  const matrixByProduct: Record<string, Record<string, number | null>> = {}
  matrix.forEach((row) => {
    if (!matrixByProduct[row.product_id]) matrixByProduct[row.product_id] = {}
    matrixByProduct[row.product_id][row.sector_id] = row.total_minutes
  })

  function totalHoursFor(productId: string) {
    const bySector = matrixByProduct[productId] || {}
    const totalMin = Object.values(bySector).reduce((sum: number, v) => sum + (v || 0), 0)
    return Math.round((totalMin / 60) * 100) / 100
  }

  if (loading && !selectedProduct && products.length === 0) return <main className="p-6 text-slate-500">Cargando...</main>

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Catálogo de Productos</h1>
      <p className="text-sm text-slate-500 mb-6">Tiempos estándar por producto y sector. Click en un producto para editar el detalle.</p>

      {!canEdit && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
          Modo solo lectura — no tenés permisos para editar este módulo.
        </div>
      )}

      {!selectedProduct ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <input
              placeholder="Buscar por nombre o código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm w-80"
            />
            {canEdit && (
              <button onClick={() => setShowNewProduct(true)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700">
                + Nuevo producto
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-left">
                  <th className="p-3 font-medium min-w-[180px]">Producto</th>
                  <th className="p-3 font-medium text-center w-[80px]">Total (hs)</th>
                  {sectors.map((s) => (
                    <th key={s.id} className="p-3 font-medium text-center w-[90px]">{s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const bySector = matrixByProduct[p.id] || {}
                  return (
                    <tr key={p.id} onClick={() => selectProduct(p)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                      <td className="p-3 text-slate-700">
                        <span className="text-xs text-slate-400 mr-2">{p.code}</span>{p.name}
                      </td>
                      <td className="p-3 text-center font-semibold text-slate-700">{totalHoursFor(p.id)}</td>
                      {sectors.map((s) => (
                        <td key={s.id} className="p-3 text-center text-slate-600">
                          {bySector[s.id] != null ? Math.round(bySector[s.id]! * 100) / 100 : '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-1">
            <button onClick={backToMatrix} className="text-xs text-slate-500 hover:text-slate-700 underline">← Volver al listado</button>
          </div>
          <h2 className="font-semibold text-slate-700 mt-2 mb-1">{selectedProduct.name}</h2>
          <p className="text-xs text-slate-400 mb-4">Código: {selectedProduct.code}</p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs text-slate-500">Categoría</label>
              <input
                defaultValue={selectedProduct.category || ''}
                onBlur={(e) => saveCategory(e.target.value)}
                placeholder="Ej: FOGONEROS"
                disabled={!canEdit}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Precio</label>
              <input
                type="number"
                defaultValue={selectedProduct.price ?? ''}
                onBlur={(e) => savePrice(e.target.value)}
                placeholder="Sin definir"
                disabled={!canEdit}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-200">
                <th className="py-2">Sector</th>
                <th className="py-2 text-center">Tiempo estándar</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((sector) => {
                const { productRow, compRows } = sectorInfo(sector.id)
                const hasComponents = compRows.length > 0
                const componentTotal = compRows.reduce((sum, r) => {
                  const comp = components.find((c) => c.id === r.component_id)
                  const qty = comp?.qty_per_product ?? 1
                  return sum + r.standard_time_minutes * qty
                }, 0)

                return (
                  <tr key={sector.id} className="border-b border-slate-100">
                    <td className="py-3 font-medium text-slate-700">{sector.name}</td>
                    <td className="py-3 text-center">
                      {hasComponents ? (
                        <span className="text-slate-700 text-sm font-medium">
                          {Math.round(componentTotal * 100) / 100} min
                          <span className="text-slate-400 font-normal"> ({compRows.length} componentes)</span>
                        </span>
                      ) : productRow ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              defaultValue={productRow.standard_time_minutes}
                              onBlur={(e) => saveProductTime(sector.id, productRow.id, parseFloat(e.target.value || '0'))}
                              disabled={!canEdit}
                              className="w-20 text-center rounded-md border border-slate-300 py-1 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                            <span className="text-xs text-slate-400">min</span>
                          </div>
                          <button onClick={() => openTimeHistory(productRow.id)} className="text-[10px] text-slate-400 hover:text-slate-600 underline">
                            ver historial
                          </button>
                        </div>
                      ) : canEdit ? (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            placeholder="Sin configurar"
                            value={emptySectorInput[sector.id] || ''}
                            onChange={(e) => setEmptySectorInput((prev) => ({ ...prev, [sector.id]: e.target.value }))}
                            className="w-28 text-center rounded-md border border-dashed border-slate-300 py-1 text-slate-400"
                          />
                          <button
                            onClick={() => saveProductTime(sector.id, null, parseFloat(emptySectorInput[sector.id] || '0'))}
                            className="text-xs bg-slate-700 text-white px-2 py-1 rounded-md hover:bg-slate-800"
                          >
                            Guardar
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">Sin configurar</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {hasComponents && (
                        <button onClick={() => setModalSector({ id: sector.id, name: sector.name })} className="text-xs text-slate-500 hover:text-slate-700 underline">
                          Ver detalle
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {canEdit && (
            <div className="mt-8 pt-4 border-t border-dashed border-rose-200">
              <p className="text-xs text-rose-400 mb-2">Zona de peligro</p>
              <button onClick={openDeleteModal} className="text-xs text-rose-500 border border-rose-200 px-3 py-1.5 rounded-md hover:bg-rose-50">
                Eliminar este producto...
              </button>
            </div>
          )}
        </div>
      )}

      {showNewProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowNewProduct(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-4">Nuevo producto</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Código</label>
                <input value={newProductCode} onChange={(e) => setNewProductCode(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Nombre</label>
                <input value={newProductName} onChange={(e) => setNewProductName(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowNewProduct(false)} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={createProduct} className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700">
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {modalSector && selectedProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setModalSector(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-1">
              <div>
                <h3 className="font-semibold text-slate-800">{modalSector.name}</h3>
                <p className="text-sm text-slate-500">{selectedProduct.name}</p>
              </div>
              <button onClick={() => setModalSector(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
              {componentTimes.filter((t) => t.sector_id === modalSector.id).map((t) => {
                const comp = components.find((c) => c.id === t.component_id)
                if (!comp) return null
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <div>
                      <p className="text-sm text-slate-700">{comp.name}</p>
                      <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                        <span>Cantidad por producto:</span>
                        <input
                          type="number"
                          defaultValue={comp.qty_per_product}
                          onBlur={(e) => saveComponentQty(comp.id, parseFloat(e.target.value || '1'))}
                          disabled={!canEdit}
                          className="w-14 text-center rounded border border-slate-300 py-0.5 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          defaultValue={t.standard_time_minutes}
                          onBlur={(e) => saveComponentTime(t.id, parseFloat(e.target.value || '0'))}
                          disabled={!canEdit}
                          className="w-16 text-center rounded-md border border-slate-300 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <span className="text-xs text-slate-400">min</span>
                      </div>
                      <button onClick={() => openTimeHistory(t.id)} className="text-[10px] text-slate-400 hover:text-slate-600 underline">
                        ver historial
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {canEdit && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-xs font-medium text-slate-600 mb-2">Agregar componente nuevo</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <input placeholder="Nombre" value={newComponentName} onChange={(e) => setNewComponentName(e.target.value)}
                    className="col-span-1 border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
                  <input placeholder="Cant./prod" type="number" value={newComponentQty} onChange={(e) => setNewComponentQty(e.target.value)}
                    className="border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
                  <input placeholder="Minutos" type="number" value={newComponentTime} onChange={(e) => setNewComponentTime(e.target.value)}
                    className="border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
                </div>
                <button onClick={addComponent} className="w-full bg-emerald-600 text-white rounded-md py-1.5 text-xs font-medium hover:bg-emerald-700">
                  Agregar
                </button>
              </div>
            )}

            <button onClick={() => setModalSector(null)} className="mt-4 w-full bg-slate-800 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-900">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {showDeleteModal && selectedProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border-2 border-rose-200">
            <h3 className="font-semibold text-rose-700 text-lg mb-2">Eliminar producto</h3>
            <p className="text-sm text-slate-600 mb-1">
              Esto borra <strong>{selectedProduct.name}</strong>, todos sus componentes y tiempos estándar. No se puede deshacer.
            </p>
            <p className="text-sm text-slate-500 mb-3">
              Para confirmar, escribí el nombre exacto del producto:
            </p>
            <p className="text-xs bg-slate-100 rounded px-2 py-1 mb-2 font-mono text-slate-700">{selectedProduct.name}</p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full mb-4"
              placeholder="Escribí el nombre acá"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={confirmDeleteProduct}
                disabled={deleteConfirmText.trim() !== selectedProduct.name}
                className="flex-1 bg-rose-600 text-white rounded-md py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {timeHistoryModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setTimeHistoryModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-semibold text-slate-800">Historial de este tiempo</h3>
              <button onClick={() => setTimeHistoryModal(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            {timeHistoryModal.entries.length === 0 ? (
              <p className="text-sm text-slate-400">Todavía no hubo actualizaciones para este tiempo.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {timeHistoryModal.entries.map((e: any) => (
                  <div key={e.id} className="border-b border-slate-100 pb-2 text-sm">
                    <p className="text-slate-700">
                      {e.old_minutes} min → <strong className="text-emerald-700">{e.new_minutes} min</strong>
                    </p>
                    <p className="text-xs text-slate-400">
                      {e.operators?.full_name} — {new Date(e.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
