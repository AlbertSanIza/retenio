'use client'
import { useQuery } from 'convex/react'

import { api } from '@/convex/_generated/api'

export default function HomePage() {
    const tasks = useQuery(api.tasks.get)
    return (
        <div className="fixed inset-0 flex flex-col items-center justify-center text-7xl">
            Retenio
            <div className="flex flex-col items-center justify-center text-base">
                {tasks?.map(({ _id, text }) => (
                    <div key={_id}>{text}</div>
                ))}
            </div>
        </div>
    )
}
