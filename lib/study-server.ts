import { z } from 'zod'
import { getReviewStates } from './approvals'
import { getCatalog } from './catalog'
import { buildCollections, filterQuestions, type LibraryCard } from './study'
export const scopeSchema = z.object({
    collection: z.string().max(100).optional(),
    category: z.array(z.string().min(1).max(300)).max(20).default([]),
    search: z.string().max(200).default(''),
    status: z.enum(['all', 'new', 'approved']).default('all')
})
export const cardIdSchema = z
    .string()
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[1-9][0-9]*$/)
export async function getLibrary() {
    const [{ cards: imported, collections: names }, reviews] = await Promise.all([getCatalog(), getReviewStates()])
    const byId = new Map(reviews.map((r) => [r.cardId, r]))
    const cards: LibraryCard[] = imported.map(({ id, collectionId, categories, question, answer }) => ({
        id,
        collectionId,
        categories,
        question,
        answer,
        ...(byId.get(id)?.dueAt !== undefined && { dueAt: byId.get(id)!.dueAt })
    }))
    const collections = buildCollections(cards).map((c) => ({ ...c, name: names.find((n) => n.key === c.id)?.name ?? c.name }))
    return { cards, collections, reviews }
}
export async function scopedQuestions(scope: z.infer<typeof scopeSchema>) {
    const library = await getLibrary()
    const approved = new Set(library.reviews.filter((r) => r.approved).map((r) => r.cardId))
    return { ...library, filtered: filterQuestions(library.cards, scope, approved) }
}
export function studyError(error: unknown) {
    console.error('Study request failed:', error)
    return Response.json(
        {
            error: process.env.NEXT_PUBLIC_CONVEX_URL
                ? 'We could not load your library. Please try again.'
                : 'Connect Convex to upload a question bank and start studying.'
        },
        { status: 503 }
    )
}
