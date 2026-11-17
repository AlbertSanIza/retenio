/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'
import { reviewIntervals } from '../../lib/review-schedule'
const modules = import.meta.glob('../../convex/**/*.ts')
const card = {
    id: 'test-bank:1',
    collectionId: 'test-bank',
    categories: ['Topic'],
    question: { text: 'Question?', imageIds: [] },
    answer: { text: 'Answer', imageIds: [] },
    source: { cardId: '1', noteId: '2', noteGuid: 'guid', templateOrdinal: 0 }
}
const digest = 'a'.repeat(64)
function setup() {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    return convexTest(schema, modules)
}
type T = ReturnType<typeof setup>
async function begin(t: T, extra = {}) {
    return t.mutation(api.imports.begin, { key: 'test-bank', name: 'Test bank', digest, expectedCards: 1, expectedImages: 0, ...extra })
}
async function publish(t: T) {
    const job = await begin(t)
    await t.mutation(api.imports.addCards, { importId: job.importId, cards: [{ card, digest }] })
    await t.mutation(api.imports.finish, { importId: job.importId })
    return job.importId
}
afterEach(() => vi.useRealTimers())
test('publishes atomically, resumes retries and prevents incomplete publication', async () => {
    const t = setup(),
        job = await begin(t)
    expect(await begin(t)).toEqual(job)
    expect((await t.query(api.library.collections))[0].activeImportId).toBeUndefined()
    await expect(t.mutation(api.imports.finish, { importId: job.importId })).rejects.toThrow('incomplete')
    await t.mutation(api.imports.addCards, { importId: job.importId, cards: [{ card, digest }] })
    await t.mutation(api.imports.addCards, { importId: job.importId, cards: [{ card, digest }] })
    await t.mutation(api.imports.finish, { importId: job.importId })
    expect((await t.query(api.library.collections))[0].cardCount).toBe(1)
    expect((await begin(t, { baseImportId: job.importId })).alreadyImported).toBe(true)
})
test('all four ratings use server time, persist and reject early or duplicate reviews', async () => {
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
        const t = setup()
        await publish(t)
        const request = { cardId: card.id, rating, requestId: `review-request-${rating}` }
        const first = await t.mutation(api.reviews.submit, request)
        expect(first.dueAt - (await t.run((ctx) => ctx.db.query('approvals').first()))!.updatedAt).toBe(reviewIntervals[rating].delay)
        expect(await t.mutation(api.reviews.submit, request)).toEqual(first)
        await expect(t.mutation(api.reviews.submit, { ...request, requestId: 'a-different-request-id' })).rejects.toThrow('not due')
        const rows = await t.run((ctx) => ctx.db.query('approvals').collect())
        expect(rows[0].reviewCount).toBe(1)
        expect(rows[0].approved).toBe(true)
        vi.setSystemTime(first.dueAt)
        await t.mutation(api.reviews.submit, { ...request, requestId: 'a-different-request-id' })
        expect((await t.run((ctx) => ctx.db.query('approvals').collect()))[0].reviewCount).toBe(2)
    }
})
test('reimport preserves review dates and card identity; cancelled replacements preserve the bank', async () => {
    const t = setup(),
        original = await publish(t)
    const review = await t.mutation(api.reviews.submit, { cardId: card.id, rating: 'easy', requestId: 'unique-review-request' })
    const job = await begin(t, { digest: 'b'.repeat(64), baseImportId: original })
    await expect(
        t.mutation(api.imports.addCards, { importId: job.importId, cards: [{ card: { ...card, source: { ...card.source, noteGuid: 'other' } }, digest }] })
    ).rejects.toThrow('collision')
    await t.mutation(api.imports.addCards, {
        importId: job.importId,
        cards: [{ card: { ...card, answer: { text: 'Updated answer', imageIds: [] } }, digest: 'b'.repeat(64) }]
    })
    expect((await t.query(api.library.collections))[0].activeImportId).toBe(original)
    await t.mutation(api.imports.finish, { importId: job.importId })
    expect((await t.run((ctx) => ctx.db.query('approvals').collect()))[0].dueAt).toBe(review.dueAt)
    const canceled = await begin(t, { digest: 'c'.repeat(64), baseImportId: job.importId })
    await t.mutation(api.imports.cancel, { importId: canceled.importId })
    await t.mutation(internal.imports.cleanup, { importId: canceled.importId })
    expect((await t.query(api.library.collections))[0].activeImportId).toBe(job.importId)
})
test('image references are required and shared storage survives cleanup of a failed import', async () => {
    const t = setup(),
        hash = 'd'.repeat(64)
    const storageId = await t.run(async (ctx) => {
        const id = await ctx.storage.store(new Blob(['image'], { type: 'image/png' }))
        await ctx.db.insert('media', { hash, storageId: id, mimeType: 'image/png', bytes: 5 })
        return id
    })
    const first = await begin(t, { expectedImages: 1 })
    const withImage = { ...card, answer: { text: 'Answer', imageIds: [hash] } }
    await expect(t.mutation(api.imports.addCards, { importId: first.importId, cards: [{ card: withImage, digest }] })).rejects.toThrow('Upload all')
    expect((await t.mutation(api.imports.prepareImage, { importId: first.importId, hash })).uploadUrl).toBeNull()
    await t.mutation(api.imports.addCards, { importId: first.importId, cards: [{ card: withImage, digest }] })
    await t.mutation(api.imports.finish, { importId: first.importId })
    const next = await begin(t, { digest: 'b'.repeat(64), expectedImages: 1, baseImportId: first.importId })
    await t.mutation(api.imports.prepareImage, { importId: next.importId, hash })
    await t.mutation(api.imports.cancel, { importId: next.importId })
    await t.mutation(internal.imports.cleanup, { importId: next.importId })
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull()
    expect((await t.query(api.library.image, { hash }))?.bytes).toBe(5)
})
test('rejects stale concurrent imports and reviews for nonexistent cards', async () => {
    const t = setup()
    await publish(t)
    await expect(begin(t, { digest: 'b'.repeat(64) })).rejects.toThrow('changed')
    await expect(t.mutation(api.reviews.submit, { cardId: 'test-bank:999', rating: 'good', requestId: 'unique-review-request' })).rejects.toThrow('no longer')
})

test('canceling a never-published bank removes it from the picker', async () => {
    const t = setup(),
        job = await begin(t)
    await t.mutation(api.imports.cancel, { importId: job.importId })
    expect(await t.query(api.library.collections)).toEqual([])
})
test('removal changes agent eligibility without resetting the learning schedule', async () => {
    const t = setup()
    await publish(t)
    const saved = await t.mutation(api.reviews.submit, { cardId: card.id, rating: 'easy', requestId: 'test-removal-request' })
    await t.mutation(api.approvals.setApproval, { cardId: card.id, approved: false })
    const row = await t.run((ctx) => ctx.db.query('approvals').first())
    expect(row!.approved).toBe(false)
    expect(row!.dueAt).toBe(saved.dueAt)
})
test('daily collection deletes old orphan uploads but keeps new and linked files', async () => {
    const t = setup()
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob(['old'])))
    const linked = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob(['linked']))
        await ctx.db.insert('media', { hash: 'd'.repeat(64), storageId, bytes: 6, mimeType: 'image/png' })
        return storageId
    })
    vi.setSystemTime(Date.now() + 86_400_001)
    const fresh = await t.run((ctx) => ctx.storage.store(new Blob(['fresh'])))
    await t.mutation(internal.maintenance.orphanedUploads, {})
    expect(await t.run(async (ctx) => (await ctx.storage.get(orphan)) === null)).toBe(true)
    expect(await t.run(async (ctx) => (await ctx.storage.get(linked)) !== null)).toBe(true)
    expect(await t.run(async (ctx) => (await ctx.storage.get(fresh)) !== null)).toBe(true)
})
