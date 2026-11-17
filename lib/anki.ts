import { createHash, randomInt } from 'node:crypto'
import { z } from 'zod'
import { getReviewStates } from './approvals'
import type { BankCard } from './bank-types'
import { getCatalog, getStoredImage } from './catalog'
import { isDue, type ReviewState } from './review-schedule'

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

type Dependencies = {
    reviews: () => Promise<ReviewState[]>
    catalog: () => Promise<{ cards: BankCard[] }>
    image: typeof getStoredImage
    fetch: (url: string, init?: RequestInit) => Promise<Response>
    now: () => number
}
const defaults: Dependencies = { reviews: getReviewStates, catalog: getCatalog, image: getStoredImage, fetch, now: Date.now }
export function createAnkiTools(dependencies: Partial<Dependencies> = {}) {
    const deps = { ...defaults, ...dependencies }
    async function approvedCatalog() {
        const [catalog, reviews] = await Promise.all([deps.catalog(), deps.reviews()])
        const approved = new Set(reviews.filter((r) => r.approved && isDue(r.dueAt, deps.now())).map((r) => r.cardId))
        return catalog.cards.filter((card) => approved.has(card.id))
    }
    async function getRandomQuestions(input: z.input<typeof randomQuestionsSchema>): Promise<ToolResult> {
        const parsed = randomQuestionsSchema.safeParse(input)
        if (!parsed.success) return toolError('Provide an integer count from 1 to 10 and optional excludeCardIds.')
        try {
            const approved = await approvedCatalog()
            if (!approved.length) return toolError('No practice questions are due. Study and rate questions on the website, or wait until their next review.')
            const { count, excludeCardIds } = parsed.data
            const excluded = new Set(excludeCardIds)
            const availableCount = approved.filter((card) => !excluded.has(card.id)).length
            if (count > availableCount)
                return toolError(`Only ${availableCount} due practice questions remain after exclusions. Request fewer questions or reset excludeCardIds.`)
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            cards: sampleCards(approved, count, excludeCardIds).map(({ id, categories, question, answer }) => ({
                                id,
                                categories,
                                question: { text: question.text, ...(question.imageIds.length && { imageIds: question.imageIds }) },
                                answer: { text: answer.text, ...(answer.imageIds.length && { imageIds: answer.imageIds }) }
                            }))
                        })
                    }
                ]
            }
        } catch (error) {
            console.error('Unable to load approved Anki cards:', error)
            return toolError('Unable to verify approved questions right now. Try again later; unapproved questions will not be returned.')
        }
    }

    async function getAnkiImage(input: z.input<typeof imageInputSchema>): Promise<ToolResult> {
        const parsed = imageInputSchema.safeParse(input)
        if (!parsed.success) return toolError('Provide an image ID returned by get_random_questions.')
        try {
            const cards = await approvedCatalog()
            const { imageId } = parsed.data
            const eligible = cards.some((card) => card.question.imageIds.includes(imageId) || card.answer.imageIds.includes(imageId))
            if (!eligible) return toolError('Image is not available from an approved question. Use an image ID from get_random_questions.')
            const image = await deps.image(imageId)
            if (!image) throw new Error('Unknown image')
            if (Math.ceil(image.bytes / 3) * 4 > maxImageResponseBytes) throw new Error('Image is too large for an MCP response')
            const response = await deps.fetch(image.url, { signal: AbortSignal.timeout(5000) })
            if (!response.ok) throw new Error('Image download failed')
            const reader = response.body?.getReader()
            if (!reader) throw new Error('Missing image body')
            const chunks: Uint8Array[] = []
            let bytes = 0
            try {
                for (;;) {
                    const part = await reader.read()
                    if (part.done) break
                    bytes += part.value.length
                    if (bytes > image.bytes) throw new Error('Image exceeds metadata size')
                    chunks.push(part.value)
                }
            } finally {
                await reader.cancel()
            }
            const data = Buffer.concat(chunks)
            if (data.length !== image.bytes || createHash('sha256').update(data).digest('hex') !== imageId) throw new Error('Image integrity check failed')
            return { content: [{ type: 'image', mimeType: image.mimeType, data: data.toString('base64') }] }
        } catch (error) {
            console.error('Unable to load approved Anki image:', error)
            return toolError('Unable to verify or load this approved image right now. Try again later.')
        }
    }
    return { getRandomQuestions, getAnkiImage }
}

export const { getRandomQuestions, getAnkiImage } = createAnkiTools()
