import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { getReview } from './reviews'

// One intentionally shared library. Reveal-before-approve is a UI learning flow,
// not authentication: anyone with access can curate this public library.
export const setApproval = mutation({
    args: { cardId: v.string(), approved: v.boolean() },
    returns: v.null(),
    handler: async (ctx, { cardId, approved }) => {
        if (cardId.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*:[1-9][0-9]*$/.test(cardId)) {
            throw new ConvexError('Invalid question ID')
        }
        const existing = await getReview(ctx, cardId)
        if (existing) {
            if (existing.approved !== approved) await ctx.db.patch(existing._id, { approved, updatedAt: Date.now() })
        } else if (approved) {
            await ctx.db.insert('approvals', { cardId, approved, updatedAt: Date.now() })
        }
        return null
    }
})
