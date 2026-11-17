import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import type { BankCard } from './bank-types'
import { convexQuery } from './convex-server'

// Only immutable, published bank versions are cached. Approval/due state never is.
const versions = new Map<string, Promise<BankCard[]>>()
async function readVersion(importId: Id<'imports'>): Promise<BankCard[]> {
    let pending = versions.get(importId)
    if (!pending) {
        pending = (async () => {
            const cards: BankCard[] = []
            let cursor: string | null = null
            for (;;) {
                const page: { page: BankCard[]; isDone: boolean; continueCursor: string } = await convexQuery(api.library.page, {
                    importId,
                    paginationOpts: { numItems: 20, cursor }
                })
                cards.push(...page.page)
                if (page.isDone) return cards
                cursor = page.continueCursor
            }
        })().catch((error) => {
            versions.delete(importId)
            throw error
        })
        if (versions.size >= 8) versions.delete(versions.keys().next().value!)
        versions.set(importId, pending)
    }
    return pending
}
export async function getCatalog() {
    const collections = await convexQuery(api.library.collections, {})
    const cards = (await Promise.all(collections.filter((c) => c.activeImportId).map((c) => readVersion(c.activeImportId!)))).flat()
    return { cards, collections }
}
export async function getStoredImage(hash: string) {
    return convexQuery(api.library.image, { hash })
}
