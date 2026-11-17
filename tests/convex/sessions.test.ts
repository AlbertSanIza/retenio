/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'
const modules = import.meta.glob('../../convex/**/*.ts')
const card = {
    id: 'session-bank:1',
    collectionId: 'session-bank',
    categories: ['Topic'],
    question: { text: 'Original question?', imageIds: [] },
    answer: { text: 'Original answer', imageIds: [] },
    source: { cardId: '1', noteId: '2', noteGuid: 'guid', templateOrdinal: 0 }
}
const retention = 3 * 24 * 60 * 60_000
async function setup() {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const t = convexTest(schema, modules)
    const importId = await t.run(async (ctx) => {
        const id = await ctx.db.insert('imports', {
            collectionKey: 'session-bank',
            name: 'Bank',
            digest: 'a'.repeat(64),
            status: 'ready',
            expectedCards: 1,
            expectedImages: 0,
            cardsWritten: 1,
            imagesWritten: 0,
            createdAt: Date.now()
        })
        await ctx.db.insert('collections', { key: 'session-bank', name: 'Bank', activeImportId: id, cardCount: 1, updatedAt: Date.now() })
        await ctx.db.insert('cards', { importId: id, card, digest: 'b'.repeat(64) })
        await ctx.db.insert('approvals', { cardId: card.id, approved: true, updatedAt: Date.now() })
        return id
    })
    return { t, importId }
}
afterEach(() => vi.useRealTimers())
test('records exact snapshots once per request and preserves them across bank edits', async () => {
    const { t } = await setup(),
        args = { cardIds: [card.id], requestId: 'session-request-one' }
    const first = await t.mutation(api.sessions.record, args)
    expect(await t.mutation(api.sessions.record, args)).toEqual(first)
    await t.run(async (ctx) => {
        const row = (await ctx.db.query('cards').first())!
        await ctx.db.patch(row._id, { card: { ...card, answer: { text: 'Updated answer', imageIds: [] } } })
    })
    const session = await t.query(api.sessions.get, { sessionId: first.sessionId })
    expect(session!.entries[0].card.answer.text).toBe('Original answer')
    expect(session!.entries[0].card).not.toHaveProperty('source')
    expect((await t.query(api.sessions.list, { paginationOpts: { numItems: 20, cursor: null } })).page).toHaveLength(1)
})
test('only due approved questions are recorded and failures write nothing', async () => {
    const { t } = await setup()
    await expect(t.mutation(api.sessions.record, { cardIds: [card.id, card.id], requestId: 'duplicate-question-request' })).rejects.toThrow('Invalid')
    await t.mutation(api.approvals.setApproval, { cardId: card.id, approved: false })
    await expect(t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'unapproved-question-request' })).rejects.toThrow('no longer due')
    await t.mutation(api.reviews.submit, { cardId: card.id, rating: 'easy', requestId: 'website-review-request' })
    await expect(t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'not-due-question-request' })).rejects.toThrow('no longer due')
    expect(await t.run((ctx) => ctx.db.query('agentSessions').collect())).toEqual([])
})
test('ratings use the shared schedule and retries cannot overwrite a newer review', async () => {
    const { t } = await setup(),
        { sessionId } = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'first-review-session' })
    const saved = await t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'hard' })
    expect(saved.rating).toBe('hard')
    expect(saved.alreadyReviewed).toBe(false)
    const firstRow = (await t.run((ctx) => ctx.db.query('approvals').first()))!
    expect(saved.dueAt - firstRow.updatedAt).toBe(6 * 60000)
    expect(await t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'easy' })).toEqual({ ...saved, alreadyReviewed: true })
    vi.setSystemTime(saved.dueAt)
    const newer = await t.mutation(api.reviews.submit, { cardId: card.id, rating: 'good', requestId: 'a-later-website-review' })
    await t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'again' })
    expect((await t.run((ctx) => ctx.db.query('approvals').first()))!.dueAt).toBe(newer.dueAt)
    expect((await t.query(api.sessions.list, { paginationOpts: { numItems: 20, cursor: null } })).page[0].reviewedCount).toBe(1)
})
test('a review in another session or removal cannot be bypassed through history', async () => {
    const { t } = await setup()
    const a = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'session-a-request' })
    const b = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'session-b-request' })
    await t.mutation(api.sessions.rate, { sessionId: a.sessionId, cardId: card.id, rating: 'good' })
    await expect(t.mutation(api.sessions.rate, { sessionId: b.sessionId, cardId: card.id, rating: 'again' })).rejects.toThrow('not due')
    await expect(t.mutation(api.sessions.rate, { sessionId: b.sessionId, cardId: 'session-bank:99', rating: 'again' })).rejects.toThrow('not part')
    await t.mutation(api.approvals.setApproval, { cardId: card.id, approved: false })
    await expect(t.mutation(api.sessions.rate, { sessionId: b.sessionId, cardId: card.id, rating: 'again' })).rejects.toThrow('no longer in')
})
test('72-hour expiry hides history and deletes snapshots while retaining review state', async () => {
    const { t } = await setup(),
        { sessionId } = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'expiring-session-request' })
    await t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'easy' })
    const session = await t.query(api.sessions.get, { sessionId })
    vi.setSystemTime(session!.expiresAt)
    expect(await t.query(api.sessions.get, { sessionId })).toBeNull()
    expect((await t.query(api.sessions.list, { paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([])
    await expect(t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'good' })).rejects.toThrow('expired')
    await t.mutation(internal.sessions.expire, { sessionId })
    expect(await t.run((ctx) => ctx.db.query('sessionCards').collect())).toEqual([])
    expect((await t.run((ctx) => ctx.db.query('approvals').first()))!.rating).toBe('easy')
})
test('session images survive old-bank cleanup and are reclaimed after the last reference expires', async () => {
    const { t, importId } = await setup(),
        hash = 'c'.repeat(64)
    const storageId = await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob(['picture'], { type: 'image/png' }))
        await ctx.db.insert('media', { hash, storageId, bytes: 7, mimeType: 'image/png' })
        await ctx.db.insert('importImages', { importId, hash })
        const row = (await ctx.db.query('cards').first())!
        await ctx.db.patch(row._id, { card: { ...card, answer: { text: 'Answer', imageIds: [hash] } } })
        return storageId
    })
    const a = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'image-session-one' })
    vi.setSystemTime(Date.now() + 1000)
    const b = await t.mutation(api.sessions.record, { cardIds: [card.id], requestId: 'image-session-two' })
    await t.run(async (ctx) => {
        const collection = (await ctx.db.query('collections').first())!
        await ctx.db.patch(collection._id, { activeImportId: undefined })
    })
    await t.mutation(internal.imports.cleanup, { importId })
    await t.mutation(internal.imports.cleanup, { importId })
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true)
    const first = await t.query(api.sessions.get, { sessionId: a.sessionId })
    vi.setSystemTime(first!.expiresAt)
    await t.mutation(internal.sessions.expire, { sessionId: a.sessionId })
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true)
    vi.setSystemTime(Date.now() + retention)
    await t.mutation(internal.sessions.expire, { sessionId: b.sessionId })
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) === null)).toBe(true)
})

test('malformed and wrong-table session IDs give actionable errors without changing reviews', async () => {
    const { t, importId } = await setup()
    for (const sessionId of ['not-a-session', importId]) {
        await expect(t.mutation(api.sessions.rate, { sessionId, cardId: card.id, rating: 'good' })).rejects.toThrow('Request a fresh batch')
    }
    expect((await t.run((ctx) => ctx.db.query('approvals').first()))!.dueAt).toBeUndefined()
})
