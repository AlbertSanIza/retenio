import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { isDue } from '../lib/review-schedule'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { card, rating } from './cardFields'
import { activeCard } from './library'
import { deleteUnusedImage } from './media'
import { getReview, saveReview } from './reviews'

const sessionSummary = v.object({ id: v.id('agentSessions'), createdAt: v.number(), expiresAt: v.number(), count: v.number(), reviewedCount: v.number() })
const sessionEntry = v.object({
    card: card.omit('source'),
    rating: v.optional(rating),
    reviewedAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    currentDueAt: v.optional(v.number()),
    approved: v.boolean(),
    available: v.boolean()
})
const retention = 3 * 24 * 60 * 60_000
export const record = mutation({
    args: { cardIds: v.array(v.string()), requestId: v.string() },
    returns: v.object({ sessionId: v.id('agentSessions'), cards: v.array(card) }),
    handler: async (ctx, { cardIds, requestId }) => {
        if (requestId.length < 16 || requestId.length > 100 || cardIds.length < 1 || cardIds.length > 10 || new Set(cardIds).size !== cardIds.length)
            throw new ConvexError('Invalid practice session')
        // Keep recording idempotent for callers recovering a lost mutation response.
        const existing = await ctx.db
            .query('agentSessions')
            .withIndex('by_request', (q) => q.eq('requestId', requestId))
            .unique()
        if (existing) {
            if (existing.expiresAt <= Date.now()) throw new ConvexError('This practice session has expired')
            const entries = await ctx.db
                .query('sessionCards')
                .withIndex('by_session', (q) => q.eq('sessionId', existing._id))
                .take(10)
            if (JSON.stringify(entries.map((e) => e.card.id)) !== JSON.stringify(cardIds)) throw new ConvexError('Session request changed')
            return { sessionId: existing._id, cards: entries.map((e) => e.card) }
        }
        const cards = []
        for (const cardId of cardIds) {
            const current = await activeCard(ctx, cardId)
            const review = await getReview(ctx, cardId)
            if (!current || !review?.approved || !isDue(review.dueAt, Date.now()))
                throw new ConvexError('A question is no longer due for agent practice. Request a fresh batch.')
            cards.push(current.card)
        }
        // Bound the snapshot write and tool response even for unusually long cards.
        if (new TextEncoder().encode(JSON.stringify(cards)).length > 800_000)
            throw new ConvexError('These questions are too large for one session. Request fewer questions.')
        const now = Date.now()
        const sessionId = await ctx.db.insert('agentSessions', { requestId, createdAt: now, expiresAt: now + retention, count: cards.length, reviewedCount: 0 })
        for (const [position, card] of cards.entries()) await ctx.db.insert('sessionCards', { sessionId, position, card })
        const images = new Set(cards.flatMap((c) => [...c.question.imageIds, ...c.answer.imageIds]))
        for (const hash of images) await ctx.db.insert('sessionImages', { sessionId, hash })
        await ctx.scheduler.runAfter(retention, internal.sessions.expire, { sessionId })
        return { sessionId, cards }
    }
})
export const list = query({
    args: { paginationOpts: paginationOptsValidator, asOf: v.number() },
    returns: paginationResultValidator(sessionSummary),
    handler: async (ctx, { paginationOpts, asOf }) => {
        const result = await ctx.db
            .query('agentSessions')
            .withIndex('by_expiry', (q) => q.gt('expiresAt', asOf))
            .order('desc')
            .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 20) })
        return {
            ...result,
            page: result.page.map(({ _id, createdAt, expiresAt, count, reviewedCount }) => ({ id: _id, createdAt, expiresAt, count, reviewedCount }))
        }
    }
})
export const get = query({
    args: { sessionId: v.id('agentSessions'), asOf: v.number() },
    returns: v.union(v.null(), v.object({ ...sessionSummary.omit('count', 'reviewedCount').fields, entries: v.array(sessionEntry) })),
    handler: async (ctx, { sessionId, asOf }) => {
        const session = await ctx.db.get(sessionId)
        if (!session || session.expiresAt <= asOf) return null
        const entries = await ctx.db
            .query('sessionCards')
            .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
            .take(10)
        return {
            id: sessionId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            entries: await Promise.all(
                entries.map(async (entry) => {
                    const current = await activeCard(ctx, entry.card.id)
                    const review = await getReview(ctx, entry.card.id)
                    const { id, collectionId, categories, question, answer } = entry.card
                    return {
                        card: { id, collectionId, categories, question, answer },
                        rating: entry.rating,
                        reviewedAt: entry.reviewedAt,
                        dueAt: entry.dueAt,
                        currentDueAt: review?.dueAt,
                        approved: review?.approved ?? false,
                        available: !!current
                    }
                })
            )
        }
    }
})
export const rate = mutation({
    args: { sessionId: v.string(), cardId: v.string(), rating },
    returns: v.object({ rating, dueAt: v.number(), alreadyReviewed: v.boolean() }),
    handler: async (ctx, { sessionId: rawSessionId, cardId, rating }) => {
        const sessionId = ctx.db.normalizeId('agentSessions', rawSessionId)
        if (!sessionId) throw new ConvexError('This practice session was not found or has expired. Request a fresh batch.')
        const session = await ctx.db.get(sessionId)
        if (!session || session.expiresAt <= Date.now()) throw new ConvexError('This practice session has expired')
        const entry = await ctx.db
            .query('sessionCards')
            .withIndex('by_session_card', (q) => q.eq('sessionId', sessionId).eq('card.id', cardId))
            .unique()
        if (!entry) throw new ConvexError('This question was not part of the session')
        if (entry.rating) return { rating: entry.rating, dueAt: entry.dueAt!, alreadyReviewed: true }
        const review = await getReview(ctx, cardId)
        if (!review?.approved) throw new ConvexError('This question is no longer in agent practice')
        const { dueAt } = await saveReview(ctx, { cardId, rating, requestId: `session:${sessionId}` })
        await ctx.db.patch(entry._id, { rating, dueAt, reviewedAt: Date.now() })
        await ctx.db.patch(sessionId, { reviewedCount: session.reviewedCount + 1 })
        return { rating, dueAt, alreadyReviewed: false }
    }
})
export const expire = internalMutation({
    args: { sessionId: v.id('agentSessions') },
    returns: v.null(),
    handler: async (ctx, { sessionId }): Promise<null> => {
        const session = await ctx.db.get(sessionId)
        if (!session || session.expiresAt > Date.now()) return null
        for (const entry of await ctx.db
            .query('sessionCards')
            .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
            .take(10))
            await ctx.db.delete(entry._id)
        for (const image of await ctx.db
            .query('sessionImages')
            .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
            .take(1000)) {
            await ctx.db.delete(image._id)
            await deleteUnusedImage(ctx, image.hash)
        }
        await ctx.db.delete(sessionId)
        return null
    }
})
