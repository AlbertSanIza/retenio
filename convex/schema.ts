import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { card, rating, reportReason } from './cardFields'

export default defineSchema({
    reports: defineTable({
        cardId: v.string(),
        question: v.string(),
        categories: v.array(v.string()),
        reason: reportReason,
        note: v.string(),
        resolved: v.boolean(),
        updatedAt: v.number()
    })
        .index('by_card', ['cardId'])
        .index('by_resolved', ['resolved', 'updatedAt']),
    agentSessions: defineTable({ requestId: v.string(), createdAt: v.number(), expiresAt: v.number(), count: v.number(), reviewedCount: v.number() })
        .index('by_request', ['requestId'])
        .index('by_expiry', ['expiresAt']),
    sessionCards: defineTable({
        sessionId: v.id('agentSessions'),
        position: v.number(),
        card,
        rating: v.optional(rating),
        reviewedAt: v.optional(v.number()),
        dueAt: v.optional(v.number())
    })
        .index('by_session', ['sessionId', 'position'])
        .index('by_session_card', ['sessionId', 'card.id']),
    sessionImages: defineTable({ sessionId: v.id('agentSessions'), hash: v.string() })
        .index('by_session', ['sessionId'])
        .index('by_hash', ['hash']),
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
