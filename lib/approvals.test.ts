import { expect, test } from 'bun:test'
import { getApprovedCardIds } from './approvals'

test('a missing Convex URL rejects rather than approving every card', async () => {
    const original = process.env.NEXT_PUBLIC_CONVEX_URL
    delete process.env.NEXT_PUBLIC_CONVEX_URL
    try {
        await expect(getApprovedCardIds()).rejects.toThrow('not configured')
    } finally {
        if (original === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL
        else process.env.NEXT_PUBLIC_CONVEX_URL = original
    }
})

test('a stalled approval backend fails within the five-second lookup limit', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    const original = process.env.NEXT_PUBLIC_CONVEX_URL
    process.env.NEXT_PUBLIC_CONVEX_URL = server.url.toString()
    try {
        await expect(getApprovedCardIds()).rejects.toThrow('timed out')
    } finally {
        if (original === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL
        else process.env.NEXT_PUBLIC_CONVEX_URL = original
        await server.stop(true)
    }
}, 10000)
