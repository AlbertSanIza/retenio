import type { MutationCtx } from './_generated/server'
export async function deleteUnusedImage(ctx: MutationCtx, hash: string) {
    if (
        await ctx.db
            .query('importImages')
            .withIndex('by_hash', (q) => q.eq('hash', hash))
            .first()
    )
        return
    if (
        await ctx.db
            .query('sessionImages')
            .withIndex('by_hash', (q) => q.eq('hash', hash))
            .first()
    )
        return
    const image = await ctx.db
        .query('media')
        .withIndex('by_hash', (q) => q.eq('hash', hash))
        .unique()
    if (image) {
        await ctx.storage.delete(image.storageId)
        await ctx.db.delete(image._id)
    }
}
