import { randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const sideSchema = z.object({ text: z.string(), imageIds: z.array(z.string()) })
const catalogSchema = z.object({
    schemaVersion: z.literal(1),
    source: z.string(),
    cards: z
        .array(
            z.object({
                id: z.string(),
                noteId: z.string(),
                deck: z.string(),
                tags: z.array(z.string()),
                question: sideSchema,
                answer: sideSchema
            })
        )
        .min(1),
    media: z.record(
        z.string().regex(/^[a-f0-9]{64}$/),
        z.object({
            file: z.string().regex(/^[a-f0-9]{64}\.(jpg|png|gif|webp)$/),
            filename: z.string(),
            mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
            bytes: z.number().int().positive()
        })
    )
})

export const randomQuestionsSchema = z.object({
    count: z.number().int().min(1).max(20).describe('Number of distinct random cards to return (1–20).'),
    excludeCardIds: z.array(z.string()).max(5000).default([]).describe('Previously seen card IDs to avoid repeating during a quiz.')
})

export const imageInputSchema = z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/) })

type Catalog = z.infer<typeof catalogSchema>
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type ToolResult = { content: Content[]; isError?: boolean }

const dataDirectory = path.join(process.cwd(), 'data', 'anki')
// next.config.ts explicitly includes these files in the serverless route bundle.
const mediaDirectory = pathToFileURL(path.join(dataDirectory, 'media') + path.sep)
// Leave room for JSON metadata and the MCP envelope within a serverless response.
const inlineImageBudget = 3_000_000
let catalogPromise: Promise<Catalog> | undefined

async function getCatalog() {
    catalogPromise ??= readFile(path.join(dataDirectory, 'cards.json'), 'utf8')
        .then((text) => catalogSchema.parse(JSON.parse(text)))
        .catch((error) => {
            catalogPromise = undefined
            throw error
        })
    return catalogPromise
}

export function sampleCards<T extends { id: string }>(cards: T[], count: number, excludeCardIds: string[] = []): T[] {
    const excluded = new Set(excludeCardIds)
    const available = cards.filter((card) => !excluded.has(card.id))
    if (!Number.isInteger(count) || count < 1 || count > available.length) {
        throw new Error(`Requested ${count} cards, but ${available.length} are available after exclusions. Request fewer cards or reset exclusions.`)
    }
    // Partial Fisher–Yates: uniform sampling without repeats or mutating the catalog.
    for (let index = 0; index < count; index++) {
        const selected = randomInt(index, available.length)
        ;[available[index], available[selected]] = [available[selected], available[index]]
    }
    return available.slice(0, count)
}

function toolError(message: string): ToolResult {
    return { isError: true, content: [{ type: 'text', text: message }] }
}

async function imageContent(catalog: Catalog, imageId: string): Promise<Content[]> {
    const image = catalog.media[imageId]
    if (!image) throw new Error('Unknown image ID')
    const data = await readFile(new URL(image.file, mediaDirectory))
    if (data.length !== image.bytes) throw new Error('Image size does not match the catalog')
    if (Math.ceil(data.length / 3) * 4 > inlineImageBudget) throw new Error('Image is too large for an MCP response')
    return [
        { type: 'text', text: `Image ${imageId}: ${image.filename}` },
        { type: 'image', mimeType: image.mimeType, data: data.toString('base64') }
    ]
}

export async function getRandomQuestions(input: z.input<typeof randomQuestionsSchema>): Promise<ToolResult> {
    const parsed = randomQuestionsSchema.safeParse(input)
    if (!parsed.success) return toolError('Provide an integer count from 1 to 20 and optional excludeCardIds.')
    try {
        const catalog = await getCatalog()
        const { count, excludeCardIds } = parsed.data
        const availableCount = catalog.cards.filter((card) => !excludeCardIds.includes(card.id)).length
        if (count > availableCount) {
            return toolError(`Only ${availableCount} cards remain after exclusions. Request fewer cards or reset excludeCardIds.`)
        }
        const cards = sampleCards(catalog.cards, count, excludeCardIds)
        const imageIds = [...new Set(cards.flatMap((card) => [...card.question.imageIds, ...card.answer.imageIds]))]
        const includedImageIds: string[] = []
        const deferredImageIds: string[] = []
        const images: Content[] = []
        let usedBytes = 0
        for (const imageId of imageIds) {
            const image = catalog.media[imageId]
            if (!image) throw new Error('Card references an unknown image')
            const encodedSize = Math.ceil(image.bytes / 3) * 4
            if (usedBytes + encodedSize > inlineImageBudget) {
                deferredImageIds.push(imageId)
                continue
            }
            images.push(...(await imageContent(catalog, imageId)))
            includedImageIds.push(imageId)
            usedBytes += encodedSize
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        totalCards: catalog.cards.length,
                        count: cards.length,
                        cards,
                        includedImageIds,
                        deferredImageIds,
                        ...(deferredImageIds.length > 0 && {
                            imageInstructions:
                                'Call get_anki_image for each deferredImageId needed. All questions and answers are included; images are deferred to keep responses within transport limits.'
                        })
                    })
                },
                ...images
            ]
        }
    } catch (error) {
        console.error('Unable to load Anki cards:', error)
        return toolError('Unable to load the Anki deck. Verify data/anki/cards.json and its media files are included in the deployment.')
    }
}

export async function getAnkiImage(input: z.input<typeof imageInputSchema>): Promise<ToolResult> {
    const parsed = imageInputSchema.safeParse(input)
    if (!parsed.success) return toolError('Provide an image ID returned by get_random_questions.')
    try {
        const catalog = await getCatalog()
        if (!catalog.media[parsed.data.imageId]) return toolError('Image not found. Use an image ID returned by get_random_questions.')
        return { content: await imageContent(catalog, parsed.data.imageId) }
    } catch (error) {
        console.error('Unable to load Anki image:', error)
        return toolError('Unable to load this image. Verify its media file is included in the deployment.')
    }
}
