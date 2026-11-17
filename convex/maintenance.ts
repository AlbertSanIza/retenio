import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
// Interrupted POSTs can leave files whose storage ID never reached the browser.
// Wait a day before collecting these, so ongoing registrations are not disturbed.
export const orphanedUploads = internalMutation({
    args: { cursor: v.optional(v.string()) },
    handler: async (ctx, { cursor }): Promise<null> => {
        const page = await ctx.db.system.query('_storage').paginate({ numItems: 100, cursor: cursor ?? null })
        for (const file of page.page) {
            if (Date.now() - file._creationTime < 86_400_000) continue
            const linked = await ctx.db
                .query('media')
                .withIndex('by_storage', (q) => q.eq('storageId', file._id))
                .first()
            if (!linked) await ctx.storage.delete(file._id)
        }
        if (!page.isDone) await ctx.scheduler.runAfter(0, internal.maintenance.orphanedUploads, { cursor: page.continueCursor })
        return null
    }
})
