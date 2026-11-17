import { api } from '../convex/_generated/api'
import { convexQuery } from './convex-server'
import type { ReviewState } from './review-schedule'
export async function getReviewStates(): Promise<ReviewState[]> {
    const states: ReviewState[] = []
    let cursor: string | null = null
    for (;;) {
        const page: { page: ReviewState[]; isDone: boolean; continueCursor: string } = await convexQuery(api.reviews.page, {
            paginationOpts: { numItems: 500, cursor }
        })
        states.push(...page.page)
        if (page.isDone) return states
        cursor = page.continueCursor
    }
}
export async function getApprovedCardIds() {
    return (await getReviewStates()).filter((row) => row.approved).map((row) => row.cardId)
}
