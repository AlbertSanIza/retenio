import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'

export async function activeCard(ctx: QueryCtx, cardId: string) {
    const key = cardId.split(':')[0]
    const collection = await ctx.db
        .query('collections')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique()
    if (!collection?.activeImportId) return null
    return ctx.db
        .query('cards')
        .withIndex('by_import_card', (q) => q.eq('importId', collection.activeImportId!).eq('card.id', cardId))
        .unique()
}
export const collections = query({
    args: {},
    handler: async (ctx) => {
        return (await ctx.db.query('collections').collect()).map(({ key, name, activeImportId, pendingImportId, cardCount }) => ({
            key,
            name,
            activeImportId,
            pendingImportId,
            cardCount
        }))
    }
})
export const page = query({
    args: { importId: v.id('imports'), paginationOpts: paginationOptsValidator },
    handler: async (ctx, { importId, paginationOpts }) => {
        const job = await ctx.db.get(importId)
        if (!job || job.status !== 'ready') throw new Error('This bank is not ready yet')
        const result = await ctx.db
            .query('cards')
            .withIndex('by_import_card', (q) => q.eq('importId', importId))
            .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 20), maximumBytesRead: 1_000_000 })
        return { ...result, page: result.page.map((row) => row.card) }
    }
})
export const image = query({
    args: { hash: v.string() },
    handler: async (ctx, { hash }) => {
        if (!/^[a-f0-9]{64}$/.test(hash)) return null
        const media = await ctx.db
            .query('media')
            .withIndex('by_hash', (q) => q.eq('hash', hash))
            .unique()
        if (!media) return null
        const url = await ctx.storage.getUrl(media.storageId)
        return url ? { url, bytes: media.bytes, mimeType: media.mimeType } : null
    }
})
