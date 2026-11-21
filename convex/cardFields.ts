import { v } from 'convex/values'
export const side = v.object({ text: v.string(), imageIds: v.array(v.string()) })
export const card = v.object({
    id: v.string(),
    collectionId: v.string(),
    categories: v.array(v.string()),
    question: side,
    answer: side,
    source: v.object({ cardId: v.string(), noteId: v.string(), noteGuid: v.string(), templateOrdinal: v.number() })
})
export const rating = v.union(v.literal('again'), v.literal('hard'), v.literal('good'), v.literal('easy'))

export const reportReason = v.union(v.literal('confusing'), v.literal('answer'), v.literal('image'))

export const reviewState = v.object({
    cardId: v.string(),
    approved: v.boolean(),
    updatedAt: v.number(),
    dueAt: v.optional(v.number()),
    rating: v.optional(rating)
})
