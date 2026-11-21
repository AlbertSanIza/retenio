import { api } from '../convex/_generated/api'
import { readAllPages } from './async'
import { convexQuery } from './convex-server'
import type { ReviewState } from './review-schedule'
export async function getReviewStates(): Promise<ReviewState[]> {
    return readAllPages((cursor) => convexQuery(api.reviews.page, { paginationOpts: { numItems: 500, cursor } }))
}
