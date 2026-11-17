import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { card, rating } from './cardFields'

export default defineSchema({
    approvals: defineTable({
        cardId: v.string(),
        approved: v.boolean(),
        updatedAt: v.number(),
        dueAt: v.optional(v.number()),
        rating: v.optional(rating),
        lastReviewId: v.optional(v.string()),
        reviewCount: v.optional(v.number())
    })
        .index('by_cardId', ['cardId'])
        .index('by_approved', ['approved']),
    collections: defineTable({
        key: v.string(),
        name: v.string(),
        activeImportId: v.optional(v.id('imports')),
        pendingImportId: v.optional(v.id('imports')),
        cardCount: v.number(),
        updatedAt: v.number()
    }).index('by_key', ['key']),
    imports: defineTable({
        collectionKey: v.string(),
        name: v.string(),
        digest: v.string(),
        status: v.union(v.literal('uploading'), v.literal('ready'), v.literal('failed')),
        expectedCards: v.number(),
        expectedImages: v.number(),
        cardsWritten: v.number(),
        imagesWritten: v.number(),
        baseImportId: v.optional(v.id('imports')),
        createdAt: v.number()
    }).index('by_collection', ['collectionKey']),
    cards: defineTable({ importId: v.id('imports'), card, digest: v.string() }).index('by_import_card', ['importId', 'card.id']),
    media: defineTable({ hash: v.string(), storageId: v.id('_storage'), mimeType: v.string(), bytes: v.number() })
        .index('by_hash', ['hash'])
        .index('by_storage', ['storageId']),
    importImages: defineTable({ importId: v.id('imports'), hash: v.string() })
        .index('by_import_hash', ['importId', 'hash'])
        .index('by_hash', ['hash'])
})
