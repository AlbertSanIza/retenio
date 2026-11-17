import { fetchQuery } from 'convex/nextjs'
import { api } from '../convex/_generated/api'

export async function getApprovedCardIds(): Promise<string[]> {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    if (!url) throw new Error('Convex is not configured')
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
        // Never cache eligibility: revocations apply to the next MCP call.
        return await Promise.race([
            fetchQuery(api.approvals.list, {}, { url }),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Approval lookup timed out')), 5000)
            })
        ])
    } finally {
        clearTimeout(timeout)
    }
}
