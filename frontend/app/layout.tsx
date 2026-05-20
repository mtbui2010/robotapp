import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RobotApp v2',
  description: 'Robot control dashboard powered by pyconnect',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
