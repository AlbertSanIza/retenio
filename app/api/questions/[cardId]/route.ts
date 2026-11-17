import { isDue } from '@/lib/review-schedule'
import { cardIdSchema, getLibrary, studyError } from '@/lib/study-server'

export async function GET(_request: Request, context: RouteContext<'/api/questions/[cardId]'>) {
    const { cardId } = await context.params
    if (!cardIdSchema.safeParse(cardId).success) return Response.json({ error: 'Question not found.' }, { status: 404 })
    try {
        const card = (await getLibrary()).cards.find((item) => item.id === cardId)
        if (card && !isDue(card.dueAt, Date.now()))
            return Response.json(
                { error: 'This question is resting until its next review.', code: 'NOT_DUE', nextDueAt: card.dueAt },
                { status: 409, headers: { 'Cache-Control': 'no-store' } }
            )
        return card ? Response.json({ card }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Question not found.' }, { status: 404 })
    } catch (error) {
        return studyError(error)
    }
}
