import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import { card } from './cardFields'
import { deleteUnusedImage } from './media'

const day = 24 * 60 * 60_000
const hashPattern = /^[a-f0-9]{64}$/
async function uploading(ctx: MutationCtx, importId: Id<'imports'>) {
    const job = await ctx.db.get(importId)
    if (!job || job.status !== 'uploading' || Date.now() - job.createdAt > day)
        throw new ConvexError('This import has expired or was cancelled. Please upload again.')
    const collection = await ctx.db
        .query('collections')
        .withIndex('by_key', (q) => q.eq('key', job.collectionKey))
        .unique()
    if (collection?.pendingImportId !== importId) throw new ConvexError('This import was replaced by another upload')
    return { job, collection }
}
async function linkImage(ctx: MutationCtx, importId: Id<'imports'>, hash: string) {
    const existing = await ctx.db
        .query('importImages')
        .withIndex('by_import_hash', (q) => q.eq('importId', importId).eq('hash', hash))
        .unique()
    if (!existing) {
        const job = await ctx.db.get(importId)
        if (!job || job.imagesWritten >= job.expectedImages) throw new ConvexError('Too many images in this import')
        await ctx.db.insert('importImages', { importId, hash })
        await ctx.db.patch(importId, { imagesWritten: job.imagesWritten + 1 })
    }
}
export const begin = mutation({
    args: {
        key: v.string(),
        name: v.string(),
        digest: v.string(),
        expectedCards: v.number(),
        expectedImages: v.number(),
        baseImportId: v.optional(v.id('imports'))
    },
    handler: async (ctx, args) => {
        if (
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.key) ||
            args.key.length > 80 ||
            !args.name.trim() ||
            args.name.length > 100 ||
            !hashPattern.test(args.digest)
        )
            throw new ConvexError('Invalid question bank details')
        if (
            !Number.isInteger(args.expectedCards) ||
            args.expectedCards < 1 ||
            args.expectedCards > 50_000 ||
            !Number.isInteger(args.expectedImages) ||
            args.expectedImages < 0 ||
            args.expectedImages > 50_000
        )
            throw new ConvexError('A bank supports up to 50,000 questions and images')
        let collection = await ctx.db
            .query('collections')
            .withIndex('by_key', (q) => q.eq('key', args.key))
            .unique()
        if (collection?.activeImportId !== args.baseImportId) throw new ConvexError('The bank changed while preparing this import. Please retry.')
        if (collection?.activeImportId) {
            const active = await ctx.db.get(collection.activeImportId)
            if (active?.digest === args.digest) return { importId: active._id, alreadyImported: true }
        }
        if (collection?.pendingImportId) {
            const pending = await ctx.db.get(collection.pendingImportId)
            if (pending?.status === 'uploading' && pending.digest === args.digest && Date.now() - pending.createdAt < day)
                return { importId: pending._id, alreadyImported: false }
            if (pending) {
                await ctx.db.patch(pending._id, { status: 'failed' })
                await ctx.scheduler.runAfter(0, internal.imports.cleanup, { importId: pending._id })
            }
        }
        const importId = await ctx.db.insert('imports', {
            collectionKey: args.key,
            name: args.name.trim(),
            digest: args.digest,
            expectedCards: args.expectedCards,
            expectedImages: args.expectedImages,
            cardsWritten: 0,
            imagesWritten: 0,
            status: 'uploading',
            createdAt: Date.now(),
            ...(collection?.activeImportId && { baseImportId: collection.activeImportId })
        })
        if (!collection) {
            const id = await ctx.db.insert('collections', {
                key: args.key,
                name: args.name.trim(),
                pendingImportId: importId,
                cardCount: 0,
                updatedAt: Date.now()
            })
            collection = (await ctx.db.get(id))!
        } else await ctx.db.patch(collection._id, { pendingImportId: importId })
        await ctx.scheduler.runAfter(day, internal.imports.expire, { importId })
        return { importId, alreadyImported: false }
    }
})
export const prepareImage = mutation({
    args: { importId: v.id('imports'), hash: v.string() },
    handler: async (ctx, { importId, hash }) => {
        await uploading(ctx, importId)
        if (!hashPattern.test(hash)) throw new ConvexError('Invalid image identifier')
        const existing = await ctx.db
            .query('media')
            .withIndex('by_hash', (q) => q.eq('hash', hash))
            .unique()
        if (existing) {
            await linkImage(ctx, importId, hash)
            return { uploadUrl: null }
        }
        return { uploadUrl: await ctx.storage.generateUploadUrl() }
    }
})
export const finishImage = mutation({
    args: { importId: v.id('imports'), hash: v.string(), storageId: v.id('_storage') },
    handler: async (ctx, { importId, hash, storageId }) => {
        await uploading(ctx, importId)
        const metadata = await ctx.db.system.get(storageId)
        if (!metadata || !hashPattern.test(hash)) throw new ConvexError('Uploaded image is missing')
        const digest = hashPattern.test(metadata.sha256)
            ? metadata.sha256
            : Array.from(atob(metadata.sha256), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
        if (digest !== hash || metadata.size > 16 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(metadata.contentType ?? ''))
            throw new ConvexError('Uploaded image does not match its contents or supported format')
        const existing = await ctx.db
            .query('media')
            .withIndex('by_hash', (q) => q.eq('hash', hash))
            .unique()
        if (!existing) await ctx.db.insert('media', { hash, storageId, mimeType: metadata.contentType!, bytes: metadata.size })
        else if (existing.storageId !== storageId) await ctx.storage.delete(storageId)
        await linkImage(ctx, importId, hash)
    }
})
export const addCards = mutation({
    args: { importId: v.id('imports'), cards: v.array(v.object({ card, digest: v.string() })) },
    handler: async (ctx, { importId, cards }) => {
        const { job } = await uploading(ctx, importId)
        if (new TextEncoder().encode(JSON.stringify(cards)).length > 1_000_000) throw new ConvexError('Question batch is too large')
        if (!cards.length || cards.length > 25) throw new ConvexError('Import questions in batches of up to 25')
        let added = 0
        for (const item of cards) {
            const c = item.card
            if (
                c.collectionId !== job.collectionKey ||
                c.id !== `${job.collectionKey}:${c.source.cardId}` ||
                !/^[1-9][0-9]*$/.test(c.source.cardId) ||
                !/^[1-9][0-9]*$/.test(c.source.noteId) ||
                !Number.isInteger(c.source.templateOrdinal) ||
                c.source.templateOrdinal < 0 ||
                !c.source.noteGuid ||
                c.source.noteGuid.length > 100 ||
                !hashPattern.test(item.digest)
            )
                throw new ConvexError('Invalid question identity')
            if (
                c.categories.length > 20 ||
                c.categories.some((p) => p.length > 300) ||
                c.question.text.length > 100_000 ||
                c.answer.text.length > 100_000 ||
                (!c.question.text && !c.question.imageIds.length) ||
                (!c.answer.text && !c.answer.imageIds.length)
            )
                throw new ConvexError('Invalid question content')
            const images = [...new Set([...c.question.imageIds, ...c.answer.imageIds])]
            if (images.length > 100) throw new ConvexError('Too many images on one question')
            for (const hash of images) {
                if (
                    !hashPattern.test(hash) ||
                    !(await ctx.db
                        .query('importImages')
                        .withIndex('by_import_hash', (q) => q.eq('importId', importId).eq('hash', hash))
                        .unique())
                )
                    throw new ConvexError('Upload all question images before importing questions')
            }
            if (job.baseImportId) {
                const previous = await ctx.db
                    .query('cards')
                    .withIndex('by_import_card', (q) => q.eq('importId', job.baseImportId!).eq('card.id', c.id))
                    .unique()
                if (
                    previous &&
                    (previous.card.source.noteGuid !== c.source.noteGuid ||
                        previous.card.source.noteId !== c.source.noteId ||
                        previous.card.source.templateOrdinal !== c.source.templateOrdinal)
                )
                    throw new ConvexError(`Question ID collision: ${c.id}. Import this as a different bank.`)
            }
            const previous = await ctx.db
                .query('cards')
                .withIndex('by_import_card', (q) => q.eq('importId', importId).eq('card.id', c.id))
                .unique()
            if (previous && previous.digest !== item.digest) throw new ConvexError('An import cannot change while it is uploading')
            if (!previous) {
                await ctx.db.insert('cards', { importId, ...item })
                added++
            }
        }
        if (job.cardsWritten + added > job.expectedCards) throw new ConvexError('Too many questions in this import')
        await ctx.db.patch(importId, { cardsWritten: job.cardsWritten + added })
    }
})
export const finish = mutation({
    args: { importId: v.id('imports') },
    handler: async (ctx, { importId }) => {
        const already = await ctx.db.get(importId)
        if (already?.status === 'ready') return null
        const { job, collection } = await uploading(ctx, importId)
        if (job.cardsWritten !== job.expectedCards || job.imagesWritten !== job.expectedImages)
            throw new ConvexError('The upload is incomplete. Please retry it.')
        if (collection.activeImportId !== job.baseImportId) throw new ConvexError('The bank changed during this upload. Please retry it.')
        // The pointer changes atomically; readers never see a partially imported bank.
        await ctx.db.patch(importId, { status: 'ready' })
        await ctx.db.patch(collection._id, {
            name: job.name,
            activeImportId: importId,
            pendingImportId: undefined,
            cardCount: job.cardsWritten,
            updatedAt: Date.now()
        })
        if (job.baseImportId) await ctx.scheduler.runAfter(day, internal.imports.cleanup, { importId: job.baseImportId })
        return null
    }
})
export const cancel = mutation({
    args: { importId: v.id('imports') },
    handler: async (ctx, { importId }) => {
        const job = await ctx.db.get(importId)
        if (!job || job.status !== 'uploading') return
        await ctx.db.patch(importId, { status: 'failed' })
        const collection = await ctx.db
            .query('collections')
            .withIndex('by_key', (q) => q.eq('key', job.collectionKey))
            .unique()
        if (collection?.pendingImportId === importId) {
            if (collection.activeImportId) await ctx.db.patch(collection._id, { pendingImportId: undefined })
            else await ctx.db.delete(collection._id)
        }
        await ctx.scheduler.runAfter(0, internal.imports.cleanup, { importId })
    }
})
export const expire = internalMutation({
    args: { importId: v.id('imports') },
    handler: async (ctx, { importId }): Promise<null> => {
        const job = await ctx.db.get(importId)
        if (job?.status === 'uploading') {
            await ctx.db.patch(importId, { status: 'failed' })
            const collection = await ctx.db
                .query('collections')
                .withIndex('by_key', (q) => q.eq('key', job.collectionKey))
                .unique()
            if (collection?.pendingImportId === importId) {
                if (collection.activeImportId) await ctx.db.patch(collection._id, { pendingImportId: undefined })
                else await ctx.db.delete(collection._id)
            }
            await ctx.scheduler.runAfter(0, internal.imports.cleanup, { importId })
        }
        return null
    }
})
export const cleanup = internalMutation({
    args: { importId: v.id('imports') },
    handler: async (ctx, { importId }): Promise<null> => {
        const job = await ctx.db.get(importId)
        if (!job || job.status === 'uploading') return null
        const collection = await ctx.db
            .query('collections')
            .withIndex('by_key', (q) => q.eq('key', job.collectionKey))
            .unique()
        if (collection?.activeImportId === importId) return null
        const cards = await ctx.db
            .query('cards')
            .withIndex('by_import_card', (q) => q.eq('importId', importId))
            .take(100)
        for (const row of cards) await ctx.db.delete(row._id)
        if (cards.length) {
            await ctx.scheduler.runAfter(0, internal.imports.cleanup, { importId })
            return null
        }
        const images = await ctx.db
            .query('importImages')
            .withIndex('by_import_hash', (q) => q.eq('importId', importId))
            .take(50)
        for (const row of images) {
            await ctx.db.delete(row._id)
            await deleteUnusedImage(ctx, row.hash)
        }
        if (images.length) await ctx.scheduler.runAfter(0, internal.imports.cleanup, { importId })
        else await ctx.db.delete(importId)
        return null
    }
})

export const discardUploadedImage = mutation({
    args: { storageId: v.id('_storage') },
    handler: async (ctx, { storageId }) => {
        // Only discard an unlinked upload; a file used by any bank is never deleted here.
        const linked = await ctx.db
            .query('media')
            .withIndex('by_storage', (q) => q.eq('storageId', storageId))
            .first()
        if (!linked) await ctx.storage.delete(storageId)
    }
})
