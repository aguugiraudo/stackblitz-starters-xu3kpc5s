'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: any) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { setError('Email o contraseña incorrectos.'); return }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">TROYA Gestión</h1>
        <p className="text-sm text-slate-500 mb-6">Iniciá sesión para continuar.</p>

        <div className="space-y-3 mb-4">
          <input
            type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full" required
          />
          <input
            type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full" required
          />
        </div>

        {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-slate-900 text-white rounded-md py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </main>
  )
}