import { sampleCards } from '@/lib/anki'
import { scopeSchema, scopedQuestions, studyError } from '@/lib/study-server'
import { z } from 'zod'

export async function POST(request: Request) {
    const body = await request.json().catch(() => null)
    const input = scopeSchema.extend({ excludeCardIds: z.array(z.string().max(200)).max(5000).default([]) }).safeParse(body)
    if (!input.success) return Response.json({ error: 'Invalid study selection.' }, { status: 400 })
    try {
        const { filtered } = await scopedQuestions(input.data)
        if (!filtered.length) return Response.json({ error: 'No questions match this selection. Try another topic or clear your filters.' }, { status: 404 })
        const excluded = new Set(input.data.excludeCardIds)
        const available = filtered.filter((card) => !excluded.has(card.id))
        if (!available.length) return Response.json({ error: 'You have explored every question in this selection.', code: 'ROUND_COMPLETE' }, { status: 409 })
        return Response.json({ card: sampleCards(available, 1)[0] }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
        return studyError(error)
    }
}
