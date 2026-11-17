import { expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { ConnectedDashboard } from './connected-dashboard'

test('server rendering never opens a Convex WebSocket, even with a configured URL', () => {
    const originalUrl = process.env.NEXT_PUBLIC_CONVEX_URL
    const originalWebSocket = globalThis.WebSocket
    let connections = 0
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud'
    globalThis.WebSocket = class {
        constructor() {
            connections++
            throw new Error('A WebSocket must not be created during server rendering')
        }
    } as unknown as typeof WebSocket
    try {
        for (let i = 0; i < 2; i++) {
            expect(renderToString(<ConnectedDashboard />)).toContain('Connecting your practice set')
        }
        expect(connections).toBe(0)
    } finally {
        globalThis.WebSocket = originalWebSocket
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL
        else process.env.NEXT_PUBLIC_CONVEX_URL = originalUrl
    }
})
