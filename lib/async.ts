/** A timeout stops waiting, not the operation: mutations must remain safe to retry. */
export async function withTimeout<T>(operation: Promise<T>, milliseconds = 12000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Request timed out')), milliseconds)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string }
export async function readAllPages<T>(read: (cursor: string | null) => Promise<Page<T>>): Promise<T[]> {
    const items: T[] = []
    let cursor: string | null = null
    for (;;) {
        const result = await read(cursor)
        items.push(...result.page)
        if (result.isDone) return items
        cursor = result.continueCursor
    }
}
