import { fetchQuery } from 'convex/nextjs'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
export async function convexQuery<Query extends FunctionReference<'query'>>(query: Query, args: FunctionArgs<Query>): Promise<FunctionReturnType<Query>> {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    if (!url) throw new Error('Convex is not configured')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            fetchQuery(query, args, { url }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Convex request timed out')), 5000)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}
