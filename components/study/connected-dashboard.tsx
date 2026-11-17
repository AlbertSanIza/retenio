'use client'

import { api } from '@/convex/_generated/api'
import { ConvexProvider, ConvexReactClient, useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Dashboard } from './dashboard'
import { UploadBank } from './upload-bank'

class ApprovalBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    render() {
        return this.state.failed ? (
            <Dashboard approvals={{ ids: undefined, ready: false, unavailable: true, retry: () => this.setState({ failed: false }) }} />
        ) : (
            this.props.children
        )
    }
}

function ReactiveDashboard() {
    const { results: reviews, status, loadMore } = usePaginatedQuery(api.reviews.page, {}, { initialNumItems: 500 })
    const banks = useQuery(api.library.collections)
    const rate = useMutation(api.reviews.submit)
    useEffect(() => {
        if (status === 'CanLoadMore') loadMore(500)
    }, [status, loadMore])
    const ids = status === 'Exhausted' ? reviews.filter((r) => r.approved).map((r) => r.cardId) : undefined
    const mutate = useMutation(api.approvals.setApproval)
    const connection = useConvexConnectionState()
    const [connectionDelayed, setConnectionDelayed] = useState(false)
    useEffect(() => {
        const timer = setTimeout(() => setConnectionDelayed(true), 5000)
        return () => clearTimeout(timer)
    }, [])
    return (
        <Dashboard
            importButton={<UploadBank />}
            catalogRevision={JSON.stringify(banks?.map((b) => b.activeImportId))}
            approvals={{
                ids,
                reviews,
                rate: (cardId, rating, requestId) => rate({ cardId, rating, requestId }),
                ready: ids !== undefined && connection.isWebSocketConnected,
                unavailable: !connection.isWebSocketConnected && (connection.hasEverConnected || connectionDelayed),
                save: (cardId, approved) => mutate({ cardId, approved })
            }}
        />
    )
}

function ConfiguredDashboard({ url }: { url: string }) {
    const [client] = useState(() => new ConvexReactClient(url))
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => {
        clearTimeout(closeTimer.current)
        // Defer disposal so React's development effect replay can reuse this client.
        return () => {
            closeTimer.current = setTimeout(() => {
                void client.close()
            }, 0)
        }
    }, [client])
    return (
        <ConvexProvider client={client}>
            <ReactiveDashboard />
        </ConvexProvider>
    )
}

const subscribeToHydration = () => () => {}

export function ConnectedDashboard() {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    // Client components also render on the server. Never initialize Convex's
    // WebSocket client there; effects cannot dispose of server-rendered clients.
    const hydrated = useSyncExternalStore(
        subscribeToHydration,
        () => true,
        () => false
    )
    if (url && !hydrated) return <Dashboard approvals={{ ids: undefined, ready: false, unavailable: false }} />
    return (
        <ApprovalBoundary>
            {url ? <ConfiguredDashboard url={url} /> : <Dashboard approvals={{ ids: undefined, ready: false, unavailable: true }} />}
        </ApprovalBoundary>
    )
}
