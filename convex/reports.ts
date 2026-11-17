import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { activeCard } from './library'

import { reportReason } from './cardFields'
export const submit = mutation({
    args: { cardId: v.string(), reason: reportReason, note: v.string() },
    handler: async (ctx, { cardId, reason, note }) => {
        if (cardId.length > 200) throw new ConvexError('Invalid question ID.')
        if (note.length > 500) throw new ConvexError('Keep your note within 500 characters.')
        const current = await activeCard(ctx, cardId)
        if (!current) throw new ConvexError('This question is no longer in the library.')
        const previous = await ctx.db
            .query('reports')
            .withIndex('by_card', (q) => q.eq('cardId', cardId))
            .unique()
        // One open report per question. Retrying a lost response cannot overwrite it.
        if (previous && !previous.resolved) return { alreadyReported: true }
        if (previous && Date.now() - previous.updatedAt < 10_000) throw new ConvexError('Please wait a few seconds before reporting this question again.')
        const fields = {
            reason,
            note: note.trim(),
            question: current.card.question.text.slice(0, 2000),
            categories: current.card.categories,
            resolved: false,
            updatedAt: Date.now()
        }
        if (previous) await ctx.db.patch(previous._id, fields)
        else await ctx.db.insert('reports', { cardId, ...fields })
        return { alreadyReported: false }
    }
})
export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: (ctx, { paginationOpts }) =>
        ctx.db
            .query('reports')
            .withIndex('by_resolved', (q) => q.eq('resolved', false))
            .order('desc')
            .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 20) })
})
export const resolve = mutation({
    args: { id: v.id('reports') },
    handler: async (ctx, { id }) => {
        const report = await ctx.db.get(id)
        if (report && !report.resolved) await ctx.db.patch(id, { resolved: true, updatedAt: Date.now() })
    }
})
