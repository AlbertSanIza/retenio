import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
    approvals: defineTable({
        cardId: v.string(),
        approved: v.boolean(),
        updatedAt: v.number()
    })
        .index('by_cardId', ['cardId'])
        .index('by_approved', ['approved'])
})
