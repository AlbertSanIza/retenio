/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import { api } from '../../convex/_generated/api'
import schema from '../../convex/schema'

const modules = import.meta.glob('../../convex/**/*.ts')

const createTest = () => convexTest(schema, modules)

async function approvedIds(t: ReturnType<typeof createTest>) {
    const result = await t.query(api.reviews.page, { paginationOpts: { cursor: null, numItems: 500 } })
    return result.page.filter((r) => r.approved).map((r) => r.cardId)
}

test('starts empty, persists approvals, and revokes them', async () => {
    const t = createTest()
    expect(await approvedIds(t)).toEqual([])
    await t.mutation(api.approvals.setApproval, { cardId: 'sketchy-pharm:123', approved: true })
    expect(await approvedIds(t)).toEqual(['sketchy-pharm:123'])
    await t.mutation(api.approvals.setApproval, { cardId: 'sketchy-pharm:123', approved: false })
    expect(await approvedIds(t)).toEqual([])
})

test('repeated approvals are idempotent and do not create duplicate rows', async () => {
    const t = createTest()
    await Promise.all(Array.from({ length: 3 }, () => t.mutation(api.approvals.setApproval, { cardId: 'sketchy-pharm:123', approved: true })))
    expect(await approvedIds(t)).toEqual(['sketchy-pharm:123'])
    const rows = await t.run((ctx) => ctx.db.query('approvals').collect())
    expect(rows).toHaveLength(1)
    await t.mutation(api.approvals.setApproval, { cardId: 'sketchy-pharm:123', approved: true })
    expect((await t.run((ctx) => ctx.db.query('approvals').collect()))[0].updatedAt).toBe(rows[0].updatedAt)
})

test('rejects malformed IDs and ignores repeated removal', async () => {
    const t = createTest()
    for (const cardId of ['../bad', 'card:0', '', 'a'.repeat(201)]) {
        await expect(t.mutation(api.approvals.setApproval, { cardId, approved: true })).rejects.toThrow('Invalid question ID')
    }
    await t.mutation(api.approvals.setApproval, { cardId: 'sketchy-pharm:123', approved: false })
    expect(await t.run((ctx) => ctx.db.query('approvals').collect())).toEqual([])
})
