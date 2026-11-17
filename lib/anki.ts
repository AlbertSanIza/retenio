import { api } from '@/convex/_generated/api'
import { ConvexError } from 'convex/values'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getReviewStates } from './approvals'
import type { BankCard } from './bank-types'
import { getCatalog, getStoredImage } from './catalog'
import { convexMutation } from './convex-server'
import { isDue, type ReviewState } from './review-schedule'

export const randomQuestionsSchema = z.object({
    count: z.number().int().min(1).max(10).describe('Number of distinct random cards to return (1–10).'),
    excludeCardIds: z.array(z.string()).max(5000).default([]).describe('Previously seen card IDs to avoid repeating during a quiz.')
})

export const rateQuestionSchema = z.object({
    sessionId: z.string().min(1).max(100).describe('Session ID returned by get_random_questions.'),
    cardId: z.string().min(1).max(200).describe('Question ID from that session.'),
    rating: z
        .enum(['again', 'hard', 'good', 'easy'])
        .describe('The learner’s chosen rating: again = 1 minute, hard = 6 minutes, good = 10 minutes, easy = 10 days.')
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
    record: (cardIds: string[], requestId: string) => Promise<{ sessionId: string; cards: BankCard[] }>
    rate: (input: z.infer<typeof rateQuestionSchema>) => Promise<{ rating: string; dueAt: number; alreadyReviewed: boolean }>
}
const defaults: Dependencies = {
    reviews: getReviewStates,
    catalog: getCatalog,
    image: getStoredImage,
    fetch,
    now: Date.now,
    record: (cardIds, requestId) => convexMutation(api.sessions.record, { cardIds, requestId }),
    rate: (input) => convexMutation(api.sessions.rate, input)
}
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
            const session = await deps.record(
                sampleCards(approved, count, excludeCardIds).map((card) => card.id),
                randomUUID()
            )
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            sessionId: session.sessionId,
                            cards: session.cards.map(({ id, categories, question, answer }) => ({
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
            return toolError(
                error instanceof ConvexError && typeof error.data === 'string'
                    ? error.data
                    : 'Unable to save this practice session right now. Try again later; no unverified questions will be returned.'
            )
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
    async function rateQuestion(input: z.input<typeof rateQuestionSchema>): Promise<ToolResult> {
        const parsed = rateQuestionSchema.safeParse(input)
        if (!parsed.success) return toolError('Provide a sessionId, cardId, and the learner’s rating: again, hard, good, or easy.')
        try {
            const result = await deps.rate(parsed.data)
            return { content: [{ type: 'text', text: JSON.stringify({ ...result, dueAt: new Date(result.dueAt).toISOString() }) }] }
        } catch (error) {
            if (error instanceof ConvexError) {
                const detail = error.data
                if (typeof detail === 'string') return toolError(detail)
                if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return toolError(detail.message)
            }
            console.error('Unable to save agent review:', error)
            return toolError('Could not confirm this review. Retry with the same sessionId and cardId; it will only be saved once.')
        }
    }
    return { getRandomQuestions, getAnkiImage, rateQuestion }
}

export const { getRandomQuestions, getAnkiImage, rateQuestion } = createAnkiTools()
