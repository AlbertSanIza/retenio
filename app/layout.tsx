import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import '@/app/globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
    title: 'Retenio — Your learning space',
    description: 'Explore your flashcards, study at your own pace, and build a question library for agent practice.'
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
            <body className="flex min-h-full flex-col">{children}</body>
        </html>
    )
}
