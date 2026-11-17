import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getAnkiImage, getRandomQuestions, sampleCards } from './anki'
import { loadCatalog } from './anki-data'

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
        const catalog = await loadCatalog('data')
        const first = catalog.cards.find((card) => card.id === 'sketchy-pharm:1475690805188')!
        const file = JSON.parse(await readFile('data/sketchy-pharm/questions/1475690805188.json', 'utf8'))
        expect(first.id).toBe(file.id)
        expect(first.collectionId).toBe('sketchy-pharm')
        expect(first.question.text).toContain('What plant is Digoxin derived from?')
        expect(first.answer.text).toContain('Foxglove plant')
        const sibling = catalog.cards.find((card) => card.source.noteId === first.source.noteId && card.id !== first.id)!
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

describe('Collection file loading', () => {
    test('namespaces matching Anki IDs across collections and validates references', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'anki-collections-'))
        try {
            const original = JSON.parse(await readFile('data/sketchy-pharm/questions/1475690805188.json', 'utf8'))
            for (const id of ['first', 'second']) {
                const directory = path.join(root, id)
                await mkdir(path.join(directory, 'questions'), { recursive: true })
                await writeFile(path.join(directory, 'collection.json'), JSON.stringify({ schemaVersion: 1, id, name: id, source: { type: 'anki-apkg' } }))
                await writeFile(
                    path.join(directory, 'questions', `${original.source.cardId}.json`),
                    JSON.stringify({ ...original, collectionId: id, id: `${id}:${original.source.cardId}` })
                )
            }
            const catalog = await loadCatalog(root)
            expect(catalog.cards.map((card) => card.id)).toEqual(['first:1475690805188', 'second:1475690805188'])
            expect(Object.keys(catalog.media)).toHaveLength(Object.keys(original.images).length)

            const file = path.join(root, 'second', 'questions', `${original.source.cardId}.json`)
            const question = { ...original, collectionId: 'second', id: `second:${original.source.cardId}` }
            await writeFile(file, JSON.stringify({ ...question, images: {} }))
            await expect(loadCatalog(root)).rejects.toThrow('Missing image reference')
            await writeFile(file, JSON.stringify({ ...question, id: 'first:1475690805188' }))
            await expect(loadCatalog(root)).rejects.toThrow('identity')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
