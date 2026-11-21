import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { reviewIntervals, type ReviewRating } from '../lib/review-schedule'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { rating, reviewState } from './cardFields'
import { activeCard } from './library'

export function getReview(ctx: QueryCtx, cardId: string) {
    return ctx.db
        .query('approvals')
        .withIndex('by_cardId', (q) => q.eq('cardId', cardId))
        .unique()
}
export const page = query({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(reviewState),
    handler: async (ctx, { paginationOpts }) => {
        const result = await ctx.db.query('approvals').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 500) })
        return { ...result, page: result.page.map(({ cardId, approved, dueAt, rating, updatedAt }) => ({ cardId, approved, dueAt, rating, updatedAt })) }
    }
})
export async function saveReview(ctx: MutationCtx, { cardId, rating, requestId }: { cardId: string; rating: ReviewRating; requestId: string }) {
    if (requestId.length < 16 || requestId.length > 100) throw new ConvexError('Invalid review request')
    if (!(await activeCard(ctx, cardId))) throw new ConvexError('This question is no longer available')
    const previous = await getReview(ctx, cardId)
    if (previous?.lastReviewId === requestId) return { dueAt: previous.dueAt! }
    const now = Date.now()
    if (previous?.dueAt && previous.dueAt > now)
        throw new ConvexError({ code: 'NOT_DUE', message: 'This question is not due yet; its previous review was saved.', dueAt: previous.dueAt })
    const dueAt = now + reviewIntervals[rating].delay
    const fields = { approved: true, updatedAt: now, dueAt, rating, lastReviewId: requestId, reviewCount: (previous?.reviewCount ?? 0) + 1 }
    if (previous) await ctx.db.patch(previous._id, fields)
    else await ctx.db.insert('approvals', { cardId, ...fields })
    return { dueAt }
}
export const submit = mutation({
    args: { cardId: v.string(), rating, requestId: v.string() },
    returns: v.object({ dueAt: v.number() }),
    handler: saveReview
})
