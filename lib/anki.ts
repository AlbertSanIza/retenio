import { createHash, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Catalog } from './anki-data'
import { getApprovedCardIds } from './approvals'
import { getCatalog } from './catalog'
import { toQuizCard } from './quiz'
export { toQuizCard } from './quiz'

export const randomQuestionsSchema = z.object({
    count: z.number().int().min(1).max(10).describe('Number of distinct random cards to return (1–10).'),
    excludeCardIds: z.array(z.string()).max(5000).default([]).describe('Previously seen card IDs to avoid repeating during a quiz.')
})

export const imageInputSchema = z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/) })

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type ToolResult = { content: Content[]; isError?: boolean }

// Leave room for JSON metadata and the MCP envelope within a serverless response.
const maxImageResponseBytes = 3_000_000
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

export function createAnkiTools(readApprovedIds: () => Promise<string[]> = getApprovedCardIds) {
    async function approvedCatalog() {
        const [catalog, ids] = await Promise.all([getCatalog(), readApprovedIds()])
        const approved = new Set(ids)
        return { catalog, cards: catalog.cards.filter((card) => approved.has(card.id)) }
    }

    async function getRandomQuestions(input: z.input<typeof randomQuestionsSchema>): Promise<ToolResult> {
        const parsed = randomQuestionsSchema.safeParse(input)
        if (!parsed.success) return toolError('Provide an integer count from 1 to 10 and optional excludeCardIds.')
        try {
            const { cards: approved } = await approvedCatalog()
            if (!approved.length)
                return toolError('No approved questions yet. Study a question on the website, reveal its answer, then approve it for agent practice.')
            const { count, excludeCardIds } = parsed.data
            const excluded = new Set(excludeCardIds)
            const availableCount = approved.filter((card) => !excluded.has(card.id)).length
            if (count > availableCount)
                return toolError(`Only ${availableCount} approved questions remain after exclusions. Request fewer questions or reset excludeCardIds.`)
            return { content: [{ type: 'text', text: JSON.stringify({ cards: sampleCards(approved, count, excludeCardIds).map(toQuizCard) }) }] }
        } catch (error) {
            console.error('Unable to load approved Anki cards:', error)
            return toolError('Unable to verify approved questions right now. Try again later; unapproved questions will not be returned.')
        }
    }

    async function getAnkiImage(input: z.input<typeof imageInputSchema>): Promise<ToolResult> {
        const parsed = imageInputSchema.safeParse(input)
        if (!parsed.success) return toolError('Provide an image ID returned by get_random_questions.')
        try {
            const { catalog, cards } = await approvedCatalog()
            const { imageId } = parsed.data
            const eligible = cards.some((card) => card.question.imageIds.includes(imageId) || card.answer.imageIds.includes(imageId))
            if (!eligible) return toolError('Image is not available from an approved question. Use an image ID from get_random_questions.')
            return { content: await imageContent(catalog, imageId) }
        } catch (error) {
            console.error('Unable to load approved Anki image:', error)
            return toolError('Unable to verify or load this approved image right now. Try again later.')
        }
    }
    return { getRandomQuestions, getAnkiImage }
}

export const { getRandomQuestions, getAnkiImage } = createAnkiTools()
