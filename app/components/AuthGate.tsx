'use client'
import { useEffect, useState, createContext, useContext } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Role = 'perfil_1' | 'perfil_2' | 'perfil_3' | 'perfil_4'

const AuthContext = createContext<{ role: Role | null; fullName: string; logout: () => void }>({
  role: null, fullName: '', logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null)
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      if (pathname !== '/login') router.push('/login')
      setLoading(false)
      return
    }
    const { data: userData } = await supabase
      .from('app_users').select('*').eq('id', session.user.id).eq('active', true).maybeSingle()

    if (!userData) {
      await supabase.auth.signOut()
      router.push('/login')
      setLoading(false)
      return
    }
    setRole(userData.role)
    setFullName(userData.full_name)
    setLoading(false)
  }

  useEffect(() => { checkSession() }, [pathname])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (pathname === '/login') return <>{children}</>
  if (loading) return <main className="min-h-screen flex items-center justify-center text-slate-400">Cargando...</main>
  if (!role) return null

  return (
    <AuthContext.Provider value={{ role, fullName, logout }}>
      {children}
    </AuthContext.Provider>
  )
}