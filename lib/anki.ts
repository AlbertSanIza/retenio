import { createHash, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { loadCatalog, type Catalog } from './anki-data'

export const randomQuestionsSchema = z.object({
    count: z.number().int().min(1).max(10).describe('Number of distinct random cards to return (1–10).'),
    excludeCardIds: z.array(z.string()).max(5000).default([]).describe('Previously seen card IDs to avoid repeating during a quiz.')
})

export const imageInputSchema = z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/) })

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type ToolResult = { content: Content[]; isError?: boolean }

const dataDirectory = path.join(process.cwd(), 'data')
// Leave room for JSON metadata and the MCP envelope within a serverless response.
const maxImageResponseBytes = 3_000_000
let catalogPromise: Promise<Catalog> | undefined

async function getCatalog() {
    catalogPromise ??= loadCatalog(dataDirectory).catch((error) => {
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

export function toQuizCard(card: Catalog['cards'][number]) {
    function cleanSide(side: typeof card.question) {
        const text = side.text
            .replace(/^§[ \t]*\n/, '')
            .replace(/\[Image: ([a-f0-9]{64})\]/g, (marker, id: string) => (side.imageIds.includes(id) ? '' : marker))
            .replace(/\n(?:[ \t]*\n)+/g, '\n\n')
            .trim()
        return { text, ...(side.imageIds.length > 0 && { imageIds: side.imageIds }) }
    }
    const question = cleanSide(card.question)
    const answer = cleanSide(card.answer)
    // Anki's FrontSide commonly repeats the question before the answer.
    if (question.text && answer.text.startsWith(`${question.text}\n`)) {
        answer.text = answer.text.slice(question.text.length).trim()
    }
    return { id: card.id, question, answer }
}

async function imageContent(catalog: Catalog, imageId: string): Promise<Content[]> {
    const image = catalog.media[imageId]
    if (!image) throw new Error('Unknown image ID')
    const data = await readFile(image.url)
    if (data.length !== image.bytes || createHash('sha256').update(data).digest('hex') !== imageId) {
        throw new Error('Image contents do not match the imported metadata')
    }
    if (Math.ceil(data.length / 3) * 4 > maxImageResponseBytes) throw new Error('Image is too large for an MCP response')
    return [
        { type: 'text', text: `Image ${imageId}: ${image.filename}` },
        { type: 'image', mimeType: image.mimeType, data: data.toString('base64') }
    ]
}

export async function getRandomQuestions(input: z.input<typeof randomQuestionsSchema>): Promise<ToolResult> {
    const parsed = randomQuestionsSchema.safeParse(input)
    if (!parsed.success) return toolError('Provide an integer count from 1 to 10 and optional excludeCardIds.')
    try {
        const catalog = await getCatalog()
        const { count, excludeCardIds } = parsed.data
        const availableCount = catalog.cards.filter((card) => !excludeCardIds.includes(card.id)).length
        if (count > availableCount) {
            return toolError(`Only ${availableCount} cards remain after exclusions. Request fewer cards or reset excludeCardIds.`)
        }
        const cards = sampleCards(catalog.cards, count, excludeCardIds)
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        cards: cards.map(toQuizCard)
                    })
                }
            ]
        }
    } catch (error) {
        console.error('Unable to load Anki cards:', error)
        return toolError(
            'Unable to load the Anki collections. Verify data/<collection>/collection.json, questions/, and images/ are included in the deployment.'
        )
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
