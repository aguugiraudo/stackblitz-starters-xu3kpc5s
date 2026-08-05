import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Nav from './components/Nav'
import AuthGate from './components/AuthGate'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TROYA Gestión',
  description: 'Sistema de producción Troya',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <AuthGate>
          <Nav />
          {children}
        </AuthGate>
      </body>
    </html>
  )
}