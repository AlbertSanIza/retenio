import { describe, expect, test } from 'bun:test'
import { ConvexError } from 'convex/values'
import { createHash } from 'node:crypto'
import { createAnkiTools, sampleCards } from './anki'
import type { BankCard } from './bank-types'
import type { ReviewState } from './review-schedule'
const bytes = Buffer.from('fixture image'),
    hash = createHash('sha256').update(bytes).digest('hex')
const cards: BankCard[] = Array.from({ length: 12 }, (_, i) => ({
    id: `bank:${i + 1}`,
    collectionId: 'bank',
    categories: ['Topic'],
    question: { text: `Question ${i}`, imageIds: [] },
    answer: { text: `Answer ${i}`, imageIds: [hash] },
    source: { cardId: `${i + 1}`, noteId: `${i + 1}`, noteGuid: `guid${i}`, templateOrdinal: 0 }
}))
function fixture() {
    let states: ReviewState[] = cards.map((c) => ({ cardId: c.id, approved: true, updatedAt: 0 }))
    let now = 1000
    const dependencies = {
        catalog: async () => ({ cards }),
        record: async (ids: string[]) => ({ sessionId: 'session-fixture', cards: ids.map((id) => cards.find((c) => c.id === id)!) }),
        rate: async () => ({ rating: 'good', dueAt: 601000, alreadyReviewed: false }),
        reviews: async () => states,
        image: async () => ({ url: 'https://storage.test/image', bytes: bytes.length, mimeType: 'image/png' }),
        fetch: async () => new Response(bytes),
        now: () => now
    }
    return {
        dependencies,
        tools: createAnkiTools(dependencies),
        setStates: (value: ReviewState[]) => {
            states = value
        },
        setNow: (value: number) => {
            now = value
        }
    }
}
describe('MCP practice and due gates', () => {
    test('samples uniformly without repeats, exclusions or source mutation', () => {
        const before = structuredClone(cards),
            selected = sampleCards(cards, 10, ['bank:1'])
        expect(selected).toHaveLength(10)
        expect(new Set(selected.map((c) => c.id)).size).toBe(10)
        expect(selected.some((c) => c.id === 'bank:1')).toBe(false)
        expect(cards).toEqual(before)
        expect(() => sampleCards(cards, 13)).toThrow('available')
    })
    test('enforces 1–10 and returns only concise text with optional image IDs', async () => {
        const { tools } = fixture()
        for (const count of [0, -1, 1.5, 11]) expect((await tools.getRandomQuestions({ count })).isError).toBe(true)
        const result = await tools.getRandomQuestions({ count: 10 })
        expect(result.content).toHaveLength(1)
        const content = result.content[0]
        if (content.type !== 'text') throw Error('Expected text')
        const parsed = JSON.parse(content.text)
        expect(parsed.sessionId).toBe('session-fixture')
        expect(parsed.cards).toHaveLength(10)
        expect(Object.keys(parsed.cards[0])).toEqual(['id', 'categories', 'question', 'answer'])
        expect(parsed.cards[0].question.imageIds).toBeUndefined()
        expect(parsed.cards[0].answer.imageIds).toEqual([hash])
    })
    test('future-due cards and their images stay hidden until the exact due time', async () => {
        const f = fixture()
        f.setStates([{ cardId: 'bank:1', approved: true, dueAt: 2000, updatedAt: 0 }])
        expect((await f.tools.getRandomQuestions({ count: 1 })).isError).toBe(true)
        expect((await f.tools.getAnkiImage({ imageId: hash })).isError).toBe(true)
        f.setNow(2000)
        expect((await f.tools.getRandomQuestions({ count: 1 })).isError).toBeUndefined()
        expect((await f.tools.getAnkiImage({ imageId: hash })).content[0]).toEqual({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') })
        f.setStates([{ cardId: 'bank:1', approved: false, updatedAt: 0 }])
        expect((await f.tools.getAnkiImage({ imageId: hash })).isError).toBe(true)
    })
    test('shared image remains available through another due card; stale IDs do not count', async () => {
        const f = fixture()
        f.setStates([
            { cardId: 'bank:1', approved: true, dueAt: 2000, updatedAt: 0 },
            { cardId: 'bank:2', approved: true, updatedAt: 0 },
            { cardId: 'gone:1', approved: true, updatedAt: 0 }
        ])
        expect((await f.tools.getAnkiImage({ imageId: hash })).isError).toBeUndefined()
        expect((await f.tools.getRandomQuestions({ count: 2 })).isError).toBe(true)
        expect((await f.tools.getRandomQuestions({ count: 1, excludeCardIds: ['bank:2'] })).isError).toBe(true)
    })
    test('missing and failed state lookups fail closed for both tools', async () => {
        const f = fixture(),
            tools = createAnkiTools({
                ...f.dependencies,
                reviews: async () => {
                    throw Error('Unavailable')
                }
            })
        expect((await tools.getRandomQuestions({ count: 1 })).isError).toBe(true)
        expect((await tools.getAnkiImage({ imageId: hash })).isError).toBe(true)
    })
    test('rejects malformed or unknown image IDs, oversized images and corrupt storage', async () => {
        const f = fixture()
        for (const imageId of ['../file', '0'.repeat(64)]) expect((await f.tools.getAnkiImage({ imageId })).isError).toBe(true)
        expect(
            (
                await createAnkiTools({ ...f.dependencies, image: async () => ({ url: 'x', bytes: 3_000_000, mimeType: 'image/png' }) }).getAnkiImage({
                    imageId: hash
                })
            ).isError
        ).toBe(true)
        expect((await createAnkiTools({ ...f.dependencies, fetch: async () => new Response('wrong') }).getAnkiImage({ imageId: hash })).isError).toBe(true)
    })
})

test('question batches are only returned after history is saved', async () => {
    const f = fixture(),
        batches: string[][] = []
    const tools = createAnkiTools({
        ...f.dependencies,
        record: async (ids) => {
            batches.push(ids)
            return { sessionId: 'saved-session', cards: ids.map((id) => cards.find((c) => c.id === id)!) }
        }
    })
    const result = await tools.getRandomQuestions({ count: 2 })
    const content = result.content[0]
    if (content.type !== 'text') throw Error('Expected text')
    expect(JSON.parse(content.text).sessionId).toBe('saved-session')
    expect(batches[0]).toHaveLength(2)
    expect(
        (
            await createAnkiTools({
                ...f.dependencies,
                record: async () => {
                    throw Error('History unavailable')
                }
            }).getRandomQuestions({ count: 1 })
        ).isError
    ).toBe(true)
})
test('MCP exposes valid learner ratings and reports the actual saved schedule', async () => {
    const f = fixture(),
        calls: unknown[] = []
    const tools = createAnkiTools({
        ...f.dependencies,
        rate: async (input) => {
            calls.push(input)
            return { rating: 'hard', dueAt: 360000, alreadyReviewed: true }
        }
    })
    expect((await tools.rateQuestion({ sessionId: 's', cardId: 'bank:1', rating: 'bad' as 'again' })).isError).toBe(true)
    const result = await tools.rateQuestion({ sessionId: 's', cardId: 'bank:1', rating: 'hard' })
    const content = result.content[0]
    if (content.type !== 'text') throw Error('Expected text')
    expect(JSON.parse(content.text)).toEqual({ rating: 'hard', dueAt: '1970-01-01T00:06:00.000Z', alreadyReviewed: true })
    expect(calls).toHaveLength(1)
})

test('invalid session errors tell the agent to request a fresh batch instead of retrying', async () => {
    const tools = createAnkiTools({
        rate: async () => {
            throw new ConvexError('This practice session was not found or has expired. Request a fresh batch.')
        }
    })
    const result = await tools.rateQuestion({ sessionId: 'not-a-session', cardId: 'bank:1', rating: 'good' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'This practice session was not found or has expired. Request a fresh batch.' }])
})
