'use client'
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
  return (
    <nav style={{
      display: 'flex', gap: '1.5rem', alignItems: 'center',
      padding: '1rem 2rem', background: '#0f172a', flexWrap: 'wrap'
    }}>
      <span style={{ color: '#ef4444', fontWeight: 'bold', marginRight: '1rem' }}>TROYA</span>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          style={{
            color: pathname === t.href ? '#facc15' : 'white',
            fontWeight: pathname === t.href ? 'bold' : 'normal',
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}