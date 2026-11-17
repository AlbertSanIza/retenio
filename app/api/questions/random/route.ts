import { sampleCards } from '@/lib/anki'
import { isDue } from '@/lib/review-schedule'
import { scopeSchema, scopedQuestions, studyError } from '@/lib/study-server'

export async function POST(request: Request) {
    const body = await request.json().catch(() => null)
    const input = scopeSchema.safeParse(body)
    if (!input.success) return Response.json({ error: 'Invalid study selection.' }, { status: 400 })
    try {
        const { filtered } = await scopedQuestions(input.data)
        if (!filtered.length) return Response.json({ error: 'No questions match this selection. Try another topic or clear your filters.' }, { status: 404 })
        const due = filtered.filter((card) => isDue(card.dueAt, Date.now()))
        if (!due.length)
            return Response.json(
                {
                    error: 'You are caught up. These questions are resting until their next review.',
                    code: 'NOT_DUE',
                    nextDueAt: filtered.reduce((earliest, card) => Math.min(earliest, card.dueAt!), Infinity)
                },
                { status: 409, headers: { 'Cache-Control': 'no-store' } }
            )
        return Response.json({ card: sampleCards(due, 1)[0] }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
        return studyError(error)
    }
}
