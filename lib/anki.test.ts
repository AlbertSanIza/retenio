import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAnkiTools, sampleCards, toQuizCard } from './anki'
import { loadCatalog } from './anki-data'

const { getAnkiImage, getRandomQuestions } = createAnkiTools(async () => (await loadCatalog('data')).cards.map((card) => card.id))

describe('Anki sampling', () => {
    test('samples without repeats, respects exclusions, and preserves the source', () => {
        const cards = Array.from({ length: 30 }, (_, index) => ({ id: String(index) }))
        const before = structuredClone(cards)
        const selected = sampleCards(cards, 10, ['0', '1', '2'])
        expect(selected).toHaveLength(10)
        expect(new Set(selected.map((card) => card.id)).size).toBe(10)
        expect(selected.every((card) => !['0', '1', '2'].includes(card.id))).toBe(true)
        expect(cards).toEqual(before)
        expect(() => sampleCards(cards, 31)).toThrow('available')
    })

    test('enforces the 1–10 count limit', async () => {
        for (const count of [0, -1, 1.5, 11]) {
            expect((await getRandomQuestions({ count })).isError).toBe(true)
        }
    })
})

describe('Imported deck and MCP images', () => {
    test('returns 10 cards without image data and preserves on-demand image retrieval', async () => {
        const result = await getRandomQuestions({ count: 10 })
        expect(result.isError).toBeUndefined()
        const first = result.content[0]
        if (first.type !== 'text') throw new Error('Expected card metadata')
        const metadata = JSON.parse(first.text)
        expect(Object.keys(metadata)).toEqual(['cards'])
        expect(metadata.cards).toHaveLength(10)
        expect(new Set(metadata.cards.map((card: { id: string }) => card.id)).size).toBe(10)
        expect(result.content).toHaveLength(1)
        expect(metadata.includedImageIds).toBeUndefined()
        expect(metadata.deferredImageIds).toBeUndefined()
        const catalog = await loadCatalog('data')
        for (const card of metadata.cards) {
            expect(Object.keys(card)).toEqual(['id', 'categories', 'question', 'answer'])
            expect(card.categories.length).toBeGreaterThan(0)
            expect(card.question.text.length).toBeGreaterThan(0)
            expect(card.answer.text.length).toBeGreaterThan(0)
            for (const id of [...(card.question.imageIds ?? []), ...(card.answer.imageIds ?? [])]) {
                expect(catalog.media[id]).toBeDefined()
            }
        }
        const imageId = metadata.cards[0].answer.imageIds[0]
        const fetched = await getAnkiImage({ imageId })
        expect(fetched.isError).toBeUndefined()
        const image = fetched.content[1]
        if (image.type !== 'image') throw new Error('Expected MCP image content')
        expect(image.mimeType).toBe('image/jpeg')
        expect(createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')).toBe(imageId)
    })

    test('removes presentation noise without changing source content or losing image references', async () => {
        const catalog = await loadCatalog('data')
        const original = catalog.cards[0]
        const imageId = original.answer.imageIds[0]
        const fixture = {
            ...original,
            deck: 'Sketchy Pharm::2 Cardiovascular & Renal::2 Diuretics::2.1 - Acetazolamide, mannitol',
            question: { text: '§\n\nWhat does ↑ mean?', imageIds: [] },
            answer: {
                text: `§\nWhat does ↑ mean?\n\nIncrease\n\n[Image: ${imageId}]\n\nKeep this explanation and § symbol.`,
                imageIds: [imageId]
            }
        }
        const before = structuredClone(fixture)
        expect(toQuizCard(fixture)).toEqual({
            id: fixture.id,
            categories: ['Cardiovascular & Renal', 'Diuretics', 'Acetazolamide, mannitol'],
            question: { text: 'What does ↑ mean?' },
            answer: { text: 'Increase\n\nKeep this explanation and § symbol.', imageIds: [imageId] }
        })
        expect(fixture).toEqual(before)
        expect(toQuizCard({ ...fixture, deck: 'Pharmacology' }).categories).toEqual(['Pharmacology'])
        expect(toQuizCard({ ...fixture, deck: '' }).categories).toBeUndefined()
        expect(toQuizCard({ ...fixture, answer: { text: 'What does ↑ mean? is part of this explanation.', imageIds: [] } }).answer).toEqual({
            text: 'What does ↑ mean? is part of this explanation.'
        })
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

    test('Acetazolamide contains only its specific answer and Extra 8 image', async () => {
        const catalog = await loadCatalog('data')
        const cardId = 'sketchy-pharm:1476210878808'
        const result = await getRandomQuestions({ count: 1, excludeCardIds: catalog.cards.filter((card) => card.id !== cardId).map((card) => card.id) })
        expect(result.isError).toBeUndefined()
        const content = result.content[0]
        if (content.type !== 'text') throw new Error('Expected card metadata')
        expect(JSON.parse(content.text).cards).toEqual([
            {
                id: cardId,
                categories: ['Cardiovascular & Renal', 'Diuretics', 'Acetazolamide, mannitol'],
                question: { text: 'What acid/base disorder does Acetazolamide cause?' },
                answer: {
                    text: 'Normal anion gap metabolic acidosis\n\n(Remember, anion gap acidosis is due to production of volatile organic acids such as in diabetic ketoacidosis)',
                    imageIds: ['5242187d47e06f71c02a393953ec9710f1b5b8038780d9a09b0537a46c9d4201']
                }
            }
        ])
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

describe('MCP approval gate', () => {
    test('samples only approved existing cards and applies exclusions afterward', async () => {
        const catalog = await loadCatalog('data')
        const card = catalog.cards[0]
        const tools = createAnkiTools(async () => [card.id, 'deleted-collection:999'])
        const result = await tools.getRandomQuestions({ count: 1 })
        const content = result.content[0]
        if (content.type !== 'text') throw new Error('Expected text')
        expect(JSON.parse(content.text).cards.map((item: { id: string }) => item.id)).toEqual([card.id])
        expect((await tools.getRandomQuestions({ count: 2 })).isError).toBe(true)
        expect((await tools.getRandomQuestions({ count: 1, excludeCardIds: [card.id] })).isError).toBe(true)
    })

    test('revocation takes effect on the next question and image call', async () => {
        const catalog = await loadCatalog('data')
        const card = catalog.cards[0]
        let approved = [card.id]
        const tools = createAnkiTools(async () => approved)
        const imageId = card.answer.imageIds[0]
        expect((await tools.getAnkiImage({ imageId })).isError).toBeUndefined()
        approved = []
        const result = await tools.getRandomQuestions({ count: 1 })
        expect(result.isError).toBe(true)
        expect(result.content[0]).toEqual({ type: 'text', text: expect.stringContaining('No approved questions yet') })
        expect((await tools.getAnkiImage({ imageId })).isError).toBe(true)
    })

    test('allows shared images only while at least one referencing card is approved', async () => {
        const catalog = await loadCatalog('data')
        const byImage = new Map<string, string[]>()
        for (const card of catalog.cards)
            for (const id of new Set([...card.question.imageIds, ...card.answer.imageIds])) {
                byImage.set(id, [...(byImage.get(id) ?? []), card.id])
            }
        const [imageId, cardIds] = [...byImage].find(([, ids]) => ids.length > 1)!
        const tools = createAnkiTools(async () => [cardIds[1]])
        expect((await tools.getAnkiImage({ imageId })).isError).toBeUndefined()
        const privateImage = [...byImage].find(([, ids]) => !ids.includes(cardIds[1]))![0]
        expect((await tools.getAnkiImage({ imageId: privateImage })).isError).toBe(true)
    })

    test('database failures never fall back to the full catalog', async () => {
        const tools = createAnkiTools(async () => {
            throw new Error('Test database unavailable')
        })
        expect((await tools.getRandomQuestions({ count: 1 })).isError).toBe(true)
        expect((await tools.getAnkiImage({ imageId: '0'.repeat(64) })).isError).toBe(true)
    })
})
