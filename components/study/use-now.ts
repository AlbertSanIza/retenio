'use client'
import { useEffect, useState } from 'react'

/** Hydration-safe clock for due labels; scheduling decisions stay on the server. */
export function useNow() {
    const [now, setNow] = useState(0)
    useEffect(() => {
        const initial = setTimeout(() => setNow(Date.now()), 0)
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => {
            clearTimeout(initial)
            clearInterval(timer)
        }
    }, [])
    return now
}
