import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const collectionIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const ankiIdSchema = z.string().regex(/^[1-9][0-9]*$/)
const imageIdSchema = z.string().regex(/^[a-f0-9]{64}$/)
const sideSchema = z.object({ text: z.string().min(1), imageIds: z.array(imageIdSchema) })
const imageSchema = z.object({
    file: z.string().regex(/^images\/[a-f0-9]{64}\.(jpg|png|gif|webp)$/),
    filename: z.string(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    bytes: z.number().int().positive()
})
const collectionSchema = z.object({
    schemaVersion: z.literal(1),
    id: collectionIdSchema,
    name: z.string().min(1),
    source: z.object({ type: z.literal('anki-apkg') })
})
const questionSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string(),
    collectionId: collectionIdSchema,
    source: z.object({
        type: z.literal('anki'),
        cardId: ankiIdSchema,
        noteId: ankiIdSchema,
        noteGuid: z.string().min(1),
        modelId: ankiIdSchema,
        templateOrdinal: z.number().int().nonnegative()
    }),
    deck: z.string(),
    tags: z.array(z.string()),
    question: sideSchema,
    answer: sideSchema,
    images: z.record(imageIdSchema, imageSchema)
})

export type Catalog = {
    cards: Omit<z.infer<typeof questionSchema>, 'images'>[]
    media: Record<string, z.infer<typeof imageSchema> & { url: URL }>
}

// The files are the imported source of truth; this index exists only in memory.
// No scheduling, votes, or per-user state is read from or written to these files.
export async function loadCatalog(dataDirectory: string): Promise<Catalog> {
    const catalog: Catalog = { cards: [], media: {} }
    const entries = await readdir(dataDirectory, { withFileTypes: true })
    const folders = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort()
    const ids = new Set<string>()
    for (const folder of folders) {
        const directory = path.join(dataDirectory, folder)
        const collection = collectionSchema.parse(JSON.parse(await readFile(path.join(directory, 'collection.json'), 'utf8')))
        if (collection.id !== folder) throw new Error(`Collection ID must match its folder: ${folder}`)
        const questionDirectory = path.join(directory, 'questions')
        const files = (await readdir(questionDirectory)).filter((file) => file.endsWith('.json')).sort()
        if (!files.length) throw new Error(`Collection has no questions: ${folder}`)
        // Bound open files when a collection contains thousands of questions.
        for (let offset = 0; offset < files.length; offset += 32) {
            const batch = files.slice(offset, offset + 32)
            const questions = await Promise.all(
                batch.map(async (file) => questionSchema.parse(JSON.parse(await readFile(path.join(questionDirectory, file), 'utf8'))))
            )
            for (const [index, question] of questions.entries()) {
                if (
                    question.collectionId !== collection.id ||
                    question.id !== `${collection.id}:${question.source.cardId}` ||
                    batch[index] !== `${question.source.cardId}.json` ||
                    ids.has(question.id)
                ) {
                    throw new Error(`Question identity does not match its collection/file: ${batch[index]}`)
                }
                ids.add(question.id)
                const { images, ...card } = question
                for (const imageId of [...card.question.imageIds, ...card.answer.imageIds]) {
                    if (!images[imageId]) throw new Error(`Missing image reference in ${question.id}: ${imageId}`)
                }
                for (const [imageId, image] of Object.entries(images)) {
                    if (!image.file.startsWith(`images/${imageId}.`)) throw new Error(`Image ID must match its file: ${imageId}`)
                    const existing = catalog.media[imageId]
                    if (existing && (existing.bytes !== image.bytes || existing.mimeType !== image.mimeType)) {
                        throw new Error(`Conflicting metadata for image: ${imageId}`)
                    }
                    catalog.media[imageId] ??= { ...image, url: new URL(image.file, pathToFileURL(directory + path.sep)) }
                }
                catalog.cards.push(card)
            }
        }
    }
    if (!catalog.cards.length) throw new Error('No imported questions found')
    return catalog
}
