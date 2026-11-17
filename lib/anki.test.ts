import { describe, expect, test } from 'bun:test'
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
