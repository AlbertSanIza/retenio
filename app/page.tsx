import { ConnectedDashboard } from '@/components/study/connected-dashboard'
import { Dashboard } from '@/components/study/dashboard'
import { Suspense } from 'react'

export default function HomePage() {
    return (
        <Suspense fallback={<Dashboard approvals={{ ids: undefined, ready: false, unavailable: false }} />}>
            <ConnectedDashboard />
        </Suspense>
    )
}
