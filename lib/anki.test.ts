import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getAnkiImage, getRandomQuestions, sampleCards } from './anki'

describe('Anki sampling', () => {
    test('samples without repeats, respects exclusions, and preserves the source', () => {
        const cards = Array.from({ length: 30 }, (_, index) => ({ id: String(index) }))
        const before = structuredClone(cards)
        const selected = sampleCards(cards, 20, ['0', '1', '2'])
        expect(selected).toHaveLength(20)
        expect(new Set(selected.map((card) => card.id)).size).toBe(20)
        expect(selected.every((card) => !['0', '1', '2'].includes(card.id))).toBe(true)
        expect(cards).toEqual(before)
        expect(() => sampleCards(cards, 31)).toThrow('available')
    })

    test('enforces the 1–20 count limit', async () => {
        for (const count of [0, -1, 1.5, 21]) {
            expect((await getRandomQuestions({ count })).isError).toBe(true)
        }
    })
})

describe('Imported deck and MCP images', () => {
    test('returns 20 cards, matching image blocks, and retrievable deferred images', async () => {
        const result = await getRandomQuestions({ count: 20 })
        expect(result.isError).toBeUndefined()
        const first = result.content[0]
        if (first.type !== 'text') throw new Error('Expected card metadata')
        const metadata = JSON.parse(first.text)
        expect(metadata.totalCards).toBe(1318)
        expect(metadata.cards).toHaveLength(20)
        expect(new Set(metadata.cards.map((card: { id: string }) => card.id)).size).toBe(20)
        for (const card of metadata.cards) {
            expect(card.question.text.length).toBeGreaterThan(0)
            expect(card.answer.text.length).toBeGreaterThan(0)
            for (const id of [...card.question.imageIds, ...card.answer.imageIds]) {
                expect([...metadata.includedImageIds, ...metadata.deferredImageIds]).toContain(id)
            }
        }
        const images = result.content.filter((content) => content.type === 'image')
        expect(images.length).toBe(metadata.includedImageIds.length)
        for (const [index, image] of images.entries()) {
            expect(image.mimeType).toBe('image/jpeg')
            const bytes = Buffer.from(image.data, 'base64')
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.includedImageIds[index])
        }
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4_000_000)
        // Any valid image ID can be fetched separately, whether included or deferred.
        const imageId = metadata.deferredImageIds[0] ?? metadata.includedImageIds[0]
        const fetched = await getAnkiImage({ imageId })
        expect(fetched.isError).toBeUndefined()
        const image = fetched.content[1]
        if (image.type !== 'image') throw new Error('Expected MCP image content')
        expect(createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')).toBe(imageId)
    })

    test('the first two cards from the same note have distinct question/answer pairs', async () => {
        const catalog = JSON.parse(await readFile('data/anki/cards.json', 'utf8'))
        const first = catalog.cards.find((card: { id: string }) => card.id === '1475690805188')
        expect(first.question.text).toContain('What plant is Digoxin derived from?')
        expect(first.answer.text).toContain('Foxglove plant')
        const sibling = catalog.cards.find((card: { noteId: string; id: string }) => card.noteId === first.noteId && card.id !== first.id)
        expect(sibling.question.text).not.toBe(first.question.text)
        expect(sibling.answer.text).not.toBe(first.answer.text)
        const allIds = catalog.cards.map((card: { id: string }) => card.id)
        expect((await getRandomQuestions({ count: 1, excludeCardIds: allIds })).isError).toBe(true)
        const onlyFirst = await getRandomQuestions({ count: 1, excludeCardIds: allIds.filter((id: string) => id !== first.id) })
        const metadata = onlyFirst.content[0]
        if (metadata.type !== 'text') throw new Error('Expected card metadata')
        expect(JSON.parse(metadata.text).cards[0].id).toBe(first.id)
    })

    test('rejects unknown images and path traversal', async () => {
        expect((await getAnkiImage({ imageId: '0'.repeat(64) })).isError).toBe(true)
        expect((await getAnkiImage({ imageId: '../../package.json' })).isError).toBe(true)
    })
})
