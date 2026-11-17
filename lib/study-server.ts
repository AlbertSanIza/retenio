import { z } from 'zod'
import { getApprovedCardIds } from './approvals'
import { getCatalog } from './catalog'
import { toQuizCard } from './quiz'
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
let libraryPromise: Promise<{ cards: LibraryCard[]; collections: ReturnType<typeof buildCollections> }> | undefined

export function getLibrary() {
    libraryPromise ??= getCatalog()
        .then((catalog) => {
            const cards = catalog.cards.map((card) => ({ ...toQuizCard(card), collectionId: card.collectionId }))
            return { cards, collections: buildCollections(cards) }
        })
        .catch((error) => {
            libraryPromise = undefined
            throw error
        })
    return libraryPromise
}

export async function scopedQuestions(scope: z.infer<typeof scopeSchema>) {
    const library = await getLibrary()
    const approved = scope.status === 'all' ? new Set<string>() : new Set(await getApprovedCardIds())
    return { ...library, filtered: filterQuestions(library.cards, scope, approved) }
}

export function studyError(error: unknown) {
    console.error('Study request failed:', error)
    return Response.json({ error: 'We could not load your library. Please try again.' }, { status: 503 })
}
