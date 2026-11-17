import { cardIdSchema, getLibrary, studyError } from '@/lib/study-server'

export async function GET(_request: Request, context: RouteContext<'/api/questions/[cardId]'>) {
    const { cardId } = await context.params
    if (!cardIdSchema.safeParse(cardId).success) return Response.json({ error: 'Question not found.' }, { status: 404 })
    try {
        const card = (await getLibrary()).cards.find((item) => item.id === cardId)
        return card ? Response.json({ card }) : Response.json({ error: 'Question not found.' }, { status: 404 })
    } catch (error) {
        return studyError(error)
    }
}
