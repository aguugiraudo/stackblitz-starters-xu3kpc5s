'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/', label: 'Cola de Producción' },
  { href: '/control-general', label: 'Avance de Producción' },
  { href: '/plan-diario', label: 'Plan Diario' },
  { href: '/balance-mensual', label: 'Capacidad Mensual' },
  { href: '/plan-turnos', label: 'Turnos y Operarios' },
  { href: '/rendimiento', label: 'Rendimiento de Operarios' },
  { href: '/historial', label: 'Historial de Órdenes' },
  { href: '/base-datos', label: 'Catálogo de Productos' },
]

export default function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <nav className="bg-slate-900 sticky top-0 z-40">
      <div className="flex items-center justify-between px-4 md:px-6 h-14">
        <span className="text-red-500 font-bold tracking-wide">TROYA</span>

        {/* Menú desktop */}
        <div className="hidden md:flex items-center gap-5 overflow-x-auto">
          {tabs.map((t) => {
            const active = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`text-sm whitespace-nowrap pb-1 border-b-2 transition ${
                  active
                    ? 'text-white font-medium border-blue-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </div>

        {/* Botón hamburguesa (solo celular) */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-slate-300 p-2"
          aria-label="Abrir menú"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* Menú desplegable en celular */}
      {open && (
        <div className="md:hidden bg-slate-800 border-t border-slate-700 px-4 py-2">
          {tabs.map((t) => {
            const active = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={() => setOpen(false)}
                className={`block py-2.5 text-sm border-b border-slate-700 last:border-0 ${
                  active ? 'text-white font-medium' : 'text-slate-300'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
      )}
    </nav>
  )
}