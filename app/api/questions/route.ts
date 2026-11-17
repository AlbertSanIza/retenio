import { scopeSchema, scopedQuestions, studyError } from '@/lib/study-server'
import { z } from 'zod'

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams
    const input = scopeSchema.extend({ page: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse({
        collection: params.get('collection') ?? undefined,
        category: params.getAll('category'),
        search: params.get('search') ?? '',
        status: params.get('status') ?? 'all',
        page: params.get('page') ?? 1
    })
    if (!input.success) return Response.json({ error: 'Invalid library filters.' }, { status: 400 })
    try {
        const { filtered, cards, collections } = await scopedQuestions(input.data)
        const pageSize = 24
        const page = Math.min(input.data.page, Math.max(1, Math.ceil(filtered.length / pageSize)))
        const questions = filtered
            .slice((page - 1) * pageSize, page * pageSize)
            .map(({ id, collectionId, categories, question }) => ({ id, collectionId, categories, question }))
        return Response.json(
            { questions, total: filtered.length, page, pageSize, totalQuestions: cards.length, catalogCardIds: cards.map((card) => card.id), collections },
            { headers: { 'Cache-Control': 'no-store' } }
        )
    } catch (error) {
        return studyError(error)
    }
}
