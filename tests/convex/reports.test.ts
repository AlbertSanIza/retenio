/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import schema from '../../convex/schema'
const modules = import.meta.glob('../../convex/**/*.ts')
async function setup() {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
        const importId = await ctx.db.insert('imports', {
            collectionKey: 'test',
            name: 'Test',
            digest: 'a'.repeat(64),
            status: 'ready',
            expectedCards: 1,
            expectedImages: 0,
            cardsWritten: 1,
            imagesWritten: 0,
            createdAt: Date.now()
        })
        await ctx.db.insert('collections', { key: 'test', name: 'Test', activeImportId: importId, cardCount: 1, updatedAt: Date.now() })
        await ctx.db.insert('cards', {
            importId,
            digest: 'b'.repeat(64),
            card: {
                id: 'test:1',
                collectionId: 'test',
                categories: ['Topic'],
                question: { text: 'Question?', imageIds: [] },
                answer: { text: 'Answer.', imageIds: [] },
                source: { cardId: '1', noteId: '2', noteGuid: 'guid', templateOrdinal: 0 }
            }
        })
        await ctx.db.insert('approvals', { cardId: 'test:1', approved: true, updatedAt: Date.now(), dueAt: Date.now() + 600000 })
    })
    return t
}
const args = { cardId: 'test:1', reason: 'image' as const, note: '  Cannot see the diagram  ' }
afterEach(() => vi.useRealTimers())
test('reports deduplicate without changing the imported card or review schedule', async () => {
    const t = await setup()
    const before = await t.run(async (ctx) => ({ cards: await ctx.db.query('cards').collect(), reviews: await ctx.db.query('approvals').collect() }))
    await Promise.all([t.mutation(api.reports.submit, args), t.mutation(api.reports.submit, args)])
    await t.mutation(api.reports.submit, { ...args, note: 'A retry must not overwrite the report' })
    const reports = await t.query(api.reports.list, { paginationOpts: { cursor: null, numItems: 10 } })
    expect(reports.page).toHaveLength(1)
    expect(reports.page[0]).toMatchObject({ question: 'Question?', note: 'Cannot see the diagram', reason: 'image' })
    expect(await t.run(async (ctx) => ({ cards: await ctx.db.query('cards').collect(), reviews: await ctx.db.query('approvals').collect() }))).toEqual(before)
})
test('invalid or missing cards and oversized notes cannot create reports', async () => {
    const t = await setup()
    await expect(t.mutation(api.reports.submit, { ...args, cardId: 'x'.repeat(201) })).rejects.toThrow('Invalid question ID')
    await expect(t.mutation(api.reports.submit, { ...args, cardId: 'test:999' })).rejects.toThrow('no longer')
    await expect(t.mutation(api.reports.submit, { ...args, note: 'x'.repeat(501) })).rejects.toThrow('500')
    expect((await t.query(api.reports.list, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([])
})
test('resolution is idempotent and a later report reuses the row after a short cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    const t = await setup()
    await t.mutation(api.reports.submit, args)
    const row = (await t.run((ctx) => ctx.db.query('reports').first()))!
    await t.mutation(api.reports.resolve, { id: row._id })
    await t.mutation(api.reports.resolve, { id: row._id })
    expect((await t.query(api.reports.list, { paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([])
    await expect(t.mutation(api.reports.submit, args)).rejects.toThrow('wait a few seconds')
    vi.setSystemTime(Date.now() + 10001)
    await t.mutation(api.reports.submit, { ...args, reason: 'answer', note: 'New issue' })
    const rows = await t.run((ctx) => ctx.db.query('reports').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ _id: row._id, resolved: false, note: 'New issue', reason: 'answer' })
})

test('reopened reports sort before reports with newer creation dates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    const t = await setup()
    await t.mutation(api.reports.submit, args)
    const first = (await t.run((ctx) => ctx.db.query('reports').first()))!
    await t.mutation(api.reports.resolve, { id: first._id })
    vi.setSystemTime(Date.now() + 5000)
    await t.run((ctx) =>
        ctx.db.insert('reports', {
            cardId: 'test:2',
            question: 'Another question',
            categories: [],
            reason: 'confusing',
            note: '',
            resolved: false,
            updatedAt: Date.now()
        })
    )
    vi.setSystemTime(Date.now() + 10000)
    await t.mutation(api.reports.submit, args)
    const result = await t.query(api.reports.list, { paginationOpts: { cursor: null, numItems: 10 } })
    expect(result.page.map((r) => r.cardId)).toEqual(['test:1', 'test:2'])
})
