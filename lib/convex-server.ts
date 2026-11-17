import { fetchMutation, fetchQuery } from 'convex/nextjs'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
async function convexCall<T>(call: (url: string) => Promise<T>): Promise<T> {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    if (!url) throw new Error('Convex is not configured')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            call(url),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Convex request timed out')), 5000)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}

export function convexQuery<Query extends FunctionReference<'query'>>(query: Query, args: FunctionArgs<Query>): Promise<FunctionReturnType<Query>> {
    return convexCall((url) => fetchQuery(query, args, { url }))
}
export function convexMutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>
): Promise<FunctionReturnType<Mutation>> {
    return convexCall((url) => fetchMutation(mutation, args, { url }))
}
