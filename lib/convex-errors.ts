import { ConvexError } from 'convex/values'

export function convexErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof ConvexError)) return fallback
    const detail = error.data
    if (typeof detail === 'string') return detail
    return detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : fallback
}
